# Spec Técnico — Sistema de Reembolsos Multi-Procesador (ToursRed)

**Fecha:** 17 de julio 2026 (actualizado)
**Autor:** Axel Álvarez / Claude (diagnóstico vía Supabase MCP)
**Estado:** Listo para desglosar en épicas y pasar a Bolt/Codex
**Proyecto Supabase:** `huzsedewwzjywcpbkjkm`

## 0. Alcance de Fase 1 (actualizado tras revisión del flujo real)

Confirmado con Axel: la Fase 1 **solo** vive en `admin/bookings` (panel de administración). El viajero **no** elige método de reembolso todavía — eso es Fase 2, y probablemente arranque solo con extranjeros.

Ya se identificó el punto de entrada real:
- **Edge Function:** `admin-cancel-booking` (v6) — dispara desde el modal "Cancelar Reserva" en `admin/bookings`.
- **Tabla de registro:** `admin_booking_cancellations` — hoy con `refund_method CHECK (refund_method = ANY (ARRAY['none','toursred_cash','bank_transfer']))`.
- El modal ya tiene dos botones de método: **"ToursRed Cash"** y **"Transferencia"**. Falta agregar un tercer botón: **"Método de pago original"**.

Esto **reemplaza** el alcance de la Épica 5 original (que asumía tocar el flujo self-service del viajero). Las Épicas 1-4 (esquema de datos, servicio de reembolso, webhooks, contabilidad) siguen siendo necesarias tal cual, porque son la infraestructura que va a usar tanto el admin hoy como el viajero en Fase 2 — construirlas bien una vez evita rehacerlas cuando se abra al viajero.

---

## 1. Diagnóstico actual (confirmado en base de datos y Edge Functions)

Hoy el flujo de reembolso vive **exclusivamente** en la función `process-traveler-cancellation` y solo sabe hacer una cosa: acreditar el monto a `toursred_cash_wallets` vía `toursred_cash_transactions`. No existe ninguna ruta de código que reembolse a un método de pago original.

Huecos concretos encontrados:

| Componente | Estado actual | Hueco |
|---|---|---|
| `payment_transactions` | Solo tiene `stripe_payment_intent_id` | No guarda `paypal_capture_id` ni `mercadopago_payment_id`. No hay campo `payment_processor` explícito. |
| `booking_cancellations` / `booking_partial_cancellations` | Tienen `refund_amount_to_traveler`, `refund_processed` (bool), `toursred_cash_transaction_id` | No distinguen método de reembolso (cash vs. original). No hay referencia a un reembolso de procesador. |
| Tabla `payment_refunds` | **No existe** | No hay dónde trackear `refund_id` del procesador, su estado, ni la comisión perdida. |
| Edge Functions de reembolso | Solo `process-traveler-cancellation` (cash) y `process-agency-booking-cancellation` | No existe `process-payment-refund` (orquestador multi-procesador). |
| Webhook Stripe | `stripe-webhook` (v157) — activo, maneja checkout/subscriptions | Falta confirmar/agregar manejo de `charge.refunded`, `refund.updated`, `refund.failed`. |
| Webhook PayPal | **No existe ningún `paypal-webhook`** | Hoy PayPal se maneja solo síncronamente vía `create-paypal-order` / `capture-paypal-order`. Sin webhook, un reembolso fallido o revertido por el banco del viajero nunca se refleja en tu base. |
| Webhook MercadoPago | `mercadopago-webhook` (v34) — activo | Falta confirmar que procese el evento de reembolso (status `refunded` / `partially_refunded`), no solo `approved`/`rejected`. |
| Contabilidad (mini-ERP) | `chart_of_accounts`, `accounting_entries`, `accounting_entry_lines`, función `create_accounting_entry_for_cancellation` | No registra la comisión de Stripe/PayPal que se pierde en cada reembolso a método original. |

**Conclusión:** esto no es "agregar una opción" — es construir un subsistema nuevo que hoy no existe en absoluto, en paralelo al de Cash que ya funciona.

---

## 2. Reglas de negocio (confirmadas con Axel el 17-jul-2026)

1. **Default:** ToursRed Cash (como ya está en Cláusula 16). El viajero, en su flujo self-service, **solo** puede elegir wallet — no ve la opción de método original.
2. **Reembolso a método original = exclusivo de admin.** Solo se activa vía panel `admin/bookings` cuando el caso escala por soporte o por una exigencia PROFECO. Son casos extraordinarios, no la ruta normal. (Esto ya quedó reflejado en el alcance de Fase 1, sección 0.)
3. El monto a reembolsar se sigue calculando exactamente igual (misma lógica de `process-traveler-cancellation`: 100%/50%/no-refund según días antes del tour). Lo único que cambia es el **destino** del dinero.
4. Reembolsos parciales (servicios opcionales, seguro, etc.) deben poder ir al mismo destino elegido — no se puede mandar la mitad a Cash y la mitad a tarjeta salvo que el admin lo decida explícitamente.
5. **Pérdida de comisión — DECISIÓN: ToursRed la absorbe completa, no se deduce del monto al viajero.** Motivo: no modificar el Contrato de Adhesión que ya está en revisión ante PROFECO, y el volumen de estos casos será bajo por ser exclusivamente admin. Esto significa que `processor_fee_lost` en `payment_refunds` es solo para tracking contable interno (sección 6) — **nunca** se resta de `requested_amount` al calcular lo que recibe el viajero.
6. Un reembolso a método original **no puede exceder** el monto originalmente cobrado por ese medio (obvio, pero hay que validarlo server-side).
7. Extranjeros: no hay lógica especial de negocio, pero es un caso de uso frecuente a monitorear — probablemente la mayoría de las solicitudes de "método original" vendrán de tarjetas internacionales vía Stripe/PayPal, no MercadoPago.
8. **Alertas automáticas a ops — DECISIÓN: sí, obligatorias.** Cuando un `payment_refund` cae en `status = 'failed'`, se debe notificar de inmediato (no revisión periódica manual). Ver Épica 6 (nueva).
9. **Este sistema es bloqueante total para el lanzamiento del 11 de agosto.** No hay MVP reducido — se construye completo (Épicas 1-6) antes del launch.

---

## 3. Modelo de datos

### 3.1 Nueva tabla: `payment_refunds`

```sql
CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id uuid NOT NULL REFERENCES bookings(id),
  cancellation_id uuid REFERENCES booking_cancellations(id),
  partial_cancellation_id uuid REFERENCES booking_partial_cancellations(id),
  payment_transaction_id uuid REFERENCES payment_transactions(id),

  refund_method text NOT NULL CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  requested_by text NOT NULL DEFAULT 'traveler_default'
    CHECK (requested_by IN ('traveler_default', 'traveler_profeco_request', 'admin_override')),

  payment_processor text CHECK (payment_processor IN ('stripe', 'paypal', 'mercadopago')),
  processor_refund_id text,          -- re_xxx (Stripe) / refund id (PayPal) / refund id (MP)
  processor_original_reference text, -- payment_intent_id / capture_id / mp payment_id

  requested_amount numeric(10,2) NOT NULL CHECK (requested_amount >= 0),
  processor_fee_lost numeric(10,2) NOT NULL DEFAULT 0,
  net_cost_to_toursred numeric(10,2) GENERATED ALWAYS AS (requested_amount + processor_fee_lost) STORED,

  currency text NOT NULL DEFAULT 'mxn',

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','succeeded','failed','requires_action','cancelled')),
  failure_reason text,

  idempotency_key text UNIQUE NOT NULL,

  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  confirmed_at timestamptz,

  webhook_last_event text,
  webhook_last_payload jsonb,

  created_by_user_id uuid,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_refunds_booking ON payment_refunds(booking_id);
CREATE INDEX idx_payment_refunds_status ON payment_refunds(status);
CREATE INDEX idx_payment_refunds_processor_refund_id ON payment_refunds(processor_refund_id);
```

**Por qué `idempotency_key` es `NOT NULL UNIQUE`:** es tu seguro contra doble clic / doble ejecución de Bolt. Genera esta clave del lado del cliente/orquestador como `booking_id + cancellation_id + timestamp_intent` antes de llamar a cualquier API de procesador.

### 3.2 Extender `payment_transactions`

```sql
ALTER TABLE public.payment_transactions
  ADD COLUMN payment_processor text CHECK (payment_processor IN ('stripe','paypal','mercadopago')),
  ADD COLUMN paypal_capture_id text,
  ADD COLUMN mercadopago_payment_id text,
  ADD COLUMN processor_fee numeric(10,2) DEFAULT 0;

-- Backfill de datos existentes (1 fila hoy, pero por completitud):
UPDATE public.payment_transactions
SET payment_processor = 'stripe', processor_fee = stripe_fee
WHERE stripe_payment_intent_id IS NOT NULL AND payment_processor IS NULL;
```

> **Nota importante:** aquí es donde probablemente tengas el hueco más grave y silencioso — si hoy no estás guardando `paypal_capture_id` ni `mercadopago_payment_id` en cada pago exitoso, **ningún reembolso a método original va a poder ejecutarse retroactivamente** para pagos ya hechos antes de este cambio. Hay que revisar `create-paypal-order`/`capture-paypal-order` y `create-mercadopago-preference`/`process-mercadopago-brick-payment` para confirmar si esos IDs ya se guardan en algún lado (aunque sea en `metadata jsonb`) y migrarlos a las columnas nuevas.

### 3.3 Extender `booking_cancellations` y `booking_partial_cancellations`

```sql
ALTER TABLE public.booking_cancellations
  ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash'
    CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id);

ALTER TABLE public.booking_partial_cancellations
  ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash'
    CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id);
```

---

## 4. Arquitectura de servicio

### 4.1 Orquestador: nueva Edge Function `process-payment-refund`

Reemplaza (o se antepone a) la lógica de reembolso hoy embebida en `process-traveler-cancellation`. Responsabilidades:

1. Recibe `{ booking_id, cancellation_id | partial_cancellation_id, amount, refund_method, requested_by }`.
2. Si `refund_method = 'toursred_cash'` → ejecuta exactamente la lógica actual (wallet + `toursred_cash_transactions`). **No tocar esto, ya funciona.**
3. Si `refund_method = 'original_payment_method'`:
   a. Busca en `payment_transactions` el registro asociado al `booking_id` y determina `payment_processor`.
   b. Crea el registro en `payment_refunds` con `status = 'pending'` y el `idempotency_key`.
   c. Llama al adapter correspondiente (4.2).
   d. Actualiza `payment_refunds.status` según la respuesta síncrona de la API (`processing` si el procesador lo confirma de inmediato, o deja `pending` si es async).
   e. El estado **final** (`succeeded`/`failed`) lo confirma el webhook, no esta función — nunca marques como `succeeded` solo por la respuesta HTTP 200 de creación del reembolso.
4. Genera el registro contable de la comisión perdida (sección 6).

### 4.2 Adapters por procesador (dentro de la misma función o como funciones auxiliares)

**Stripe:**
```ts
const refund = await stripe.refunds.create({
  payment_intent: paymentTransaction.stripe_payment_intent_id,
  amount: Math.round(amountMXN * 100), // centavos
  reason: 'requested_by_customer',
  metadata: { booking_id, cancellation_id, toursred_refund_id }
});
// refund.id -> processor_refund_id
// refund.status -> 'pending' | 'succeeded' | 'failed'
```

**PayPal:**
```ts
// POST /v2/payments/captures/{capture_id}/refund
const refund = await paypalClient.post(
  `/v2/payments/captures/${paymentTransaction.paypal_capture_id}/refund`,
  { amount: { value: amountMXN.toFixed(2), currency_code: 'MXN' }, note_to_payer: 'Reembolso ToursRed' }
);
// refund.id -> processor_refund_id
// refund.status -> 'COMPLETED' | 'PENDING' | 'FAILED'
```

**MercadoPago:**
```ts
// POST /v1/payments/{payment_id}/refunds
const refund = await mpClient.post(
  `/v1/payments/${paymentTransaction.mercadopago_payment_id}/refunds`,
  { amount: amountMXN }
);
// refund.id -> processor_refund_id
// status se confirma vía webhook del payment original
```

### 4.3 Cálculo de `processor_fee_lost`

- Stripe: `payment_transactions.processor_fee` (ya lo tienes guardado por transacción) × (monto reembolsado / monto original) si es parcial.
- PayPal: mismo criterio, usando el fee que PayPal reportó en la captura original (si no lo estás guardando hoy, hay que empezar a guardarlo desde `capture-paypal-order`).
- MercadoPago: **siempre 0** — MP bonifica la comisión completa.

---

## 5. Webhooks — qué falta

### 5.1 Stripe (`stripe-webhook`, extender)
Agregar manejo de:
- `charge.refunded` → marcar `payment_refunds.status = 'succeeded'`, `confirmed_at = now()`
- `refund.updated` → sincronizar estado intermedio
- `refund.failed` → `status = 'failed'`, guardar `failure_reason`

### 5.2 PayPal (`paypal-webhook`, **crear desde cero**)
Esta es la pieza que hoy no existe en absoluto. Necesitas:
- Registrar el webhook en el Developer Dashboard de PayPal apuntando a la nueva función.
- Verificar la firma del webhook (`PAYPAL-TRANSMISSION-SIG` + `verify-webhook-signature` API) — **crítico**, sin esto cualquiera podría falsificar confirmaciones de reembolso.
- Eventos a escuchar:
  - `PAYMENT.CAPTURE.REFUNDED` → `status = 'succeeded'`
  - `PAYMENT.CAPTURE.REVERSED` → caso especial, revisar manualmente
  - (De una vez, ya que vas a crear este webhook: agrega `PAYMENT.CAPTURE.COMPLETED` y los eventos de disputa que ya tenías en el backlog pendiente — `CUSTOMER.DISPUTE.CREATED/RESOLVED` — para no tener que volver a tocar esto en unas semanas.)

### 5.3 MercadoPago (`mercadopago-webhook`, extender)
- Confirmar que además de escuchar el `topic=payment` para pagos nuevos, procese correctamente cuando el `status` de un pago existente cambia a `refunded` o `partially_refunded` — MP no manda un evento distinto para refund, reutiliza la notificación de `payment` con el mismo `id`. Hay que revisar el código actual para confirmar si ya lo contempla o si hoy lo ignora silenciosamente.

---

## 6. Integración contable (mini-ERP interno)

Cuando `payment_refunds.status = 'succeeded'` y `processor_fee_lost > 0`, generar una entrada en `accounting_entries` + `accounting_entry_lines`:

```
Cargo (debit):  Gasto por comisión no recuperable   → processor_fee_lost
Abono (credit): Banco / Cuenta del procesador        → processor_fee_lost
```

Esto se conecta con tu función existente `create_accounting_entry_for_cancellation` — hay que extenderla (o crear `create_accounting_entry_for_refund`) para que dispare automáticamente cuando el webhook confirma el reembolso, usando `source_type = 'payment_refund'`, `source_id = payment_refunds.id` (mismo patrón que ya usa `accounting_entries.source_type`/`source_id`).

Necesitarás un `account_code` nuevo en `chart_of_accounts` tipo "Comisiones de procesamiento no recuperables" si no existe ya uno equivalente — revisar antes de crear uno duplicado.

---

## 7. Flujo end-to-end

```
Viajero solicita cancelación
        │
        ▼
¿Elige método de reembolso? ── Cash (default) ──► process-traveler-cancellation
        │                                          (lógica actual, sin cambios)
        └── Método original ──► process-payment-refund
                                        │
                                        ▼
                          Busca payment_transactions
                          determina processor (stripe/paypal/mp)
                                        │
                                        ▼
                          Crea payment_refunds (status=pending)
                                        │
                                        ▼
                          Llama API del procesador correspondiente
                                        │
                                        ▼
                          status=processing (esperando confirmación)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
     stripe-webhook            paypal-webhook              mercadopago-webhook
     (extender)                (crear nuevo)                (extender)
              │                         │                         │
              └─────────────────────────┴─────────────────────────┘
                                        │
                                        ▼
                    payment_refunds.status = succeeded/failed
                                        │
                                        ▼
                    Si succeeded y processor_fee_lost > 0:
                    generar entrada contable automática
```

---

## 8. Seguridad e idempotencia

- **Nunca** confiar en la respuesta HTTP inmediata de Stripe/PayPal/MP como confirmación final — siempre esperar webhook.
- Verificar firma de **los tres** webhooks (ya lo haces para Stripe presumiblemente; falta PayPal; confirmar MP).
- `idempotency_key` obligatorio en `payment_refunds` y pasado también como `Idempotency-Key` header a Stripe (Stripe lo soporta nativo) para evitar reembolsos duplicados si Bolt reintenta la llamada.
- Validar server-side que `requested_amount <= (monto original - reembolsos previos ya ejecutados sobre esa misma transacción)`.
- RLS: `payment_refunds` no debe ser visible/editable por el viajero directamente — solo lectura de su propio registro, escritura solo vía service role desde las Edge Functions.

---

## 9. Épicas para Bolt/Codex

**Épica 1 — Esquema de datos**
- Task 1.1: Migración `payment_refunds` (sección 3.1)
- Task 1.2: Migración `payment_transactions` + backfill (sección 3.2)
- Task 1.3: Migración `booking_cancellations` / `booking_partial_cancellations` (sección 3.3)
- Task 1.4: Auditar `create-paypal-order`, `capture-paypal-order`, `create-mercadopago-preference`, `process-mercadopago-brick-payment` para confirmar si ya guardan `capture_id`/`payment_id` en algún campo (aunque sea `metadata`), y migrar a las columnas nuevas si es necesario.

**Épica 2 — Servicio de reembolso**
- Task 2.1: Crear `process-payment-refund` (orquestador, sección 4.1)
- Task 2.2: Adapter Stripe (`stripe.refunds.create`)
- Task 2.3: Adapter PayPal (`/v2/payments/captures/{id}/refund`)
- Task 2.4: Adapter MercadoPago (`/v1/payments/{id}/refunds`)
- Task 2.5: Modificar `process-traveler-cancellation` para que reciba `refund_method` y delegue a `process-payment-refund` cuando sea `original_payment_method`, en vez de ejecutar directo la lógica de Cash.

**Épica 3 — Webhooks**
- Task 3.1: Extender `stripe-webhook` con eventos de refund (sección 5.1)
- Task 3.2: Crear `paypal-webhook` desde cero, con verificación de firma (sección 5.2)
- Task 3.3: Auditar y extender `mercadopago-webhook` para refunds (sección 5.3)
- Task 3.4: Registrar el nuevo webhook de PayPal en su Developer Dashboard (esto es manual, no de código — Axel lo hace directo en PayPal)

**Épica 4 — Contabilidad**
- Task 4.1: Confirmar/crear cuenta contable para "comisión no recuperable" en `chart_of_accounts`
- Task 4.2: Extender lógica de generación de pólizas para disparar con `payment_refunds.status = succeeded`

**Épica 5 — Admin panel (`admin/bookings`) — ESTE es el alcance real de Fase 1**

Ya se identificó el código exacto a modificar:

- Task 5.1: Migración de `admin_booking_cancellations.refund_method` — agregar `'original_payment_method'` al CHECK constraint:
  ```sql
  ALTER TABLE public.admin_booking_cancellations DROP CONSTRAINT admin_booking_cancellations_refund_method_check;
  ALTER TABLE public.admin_booking_cancellations ADD CONSTRAINT admin_booking_cancellations_refund_method_check
    CHECK (refund_method = ANY (ARRAY['none','toursred_cash','bank_transfer','original_payment_method']));
  ```
  Agregar también `payment_refund_id uuid REFERENCES payment_refunds(id)` a esta tabla, mismo patrón que en `booking_cancellations`.

- Task 5.2: Modificar `admin-cancel-booking` (Edge Function) — hoy valida `refund_method` contra `["none", "toursred_cash", "bank_transfer"]` (línea con `if (!["none", "toursred_cash", "bank_transfer"].includes(refund_method))`). Agregar `"original_payment_method"` a esa lista, y un nuevo bloque `if (refund_method === "original_payment_method" && Number(refund_amount) > 0) { ... }` que:
  1. Busca en `payment_transactions` el registro del `booking_id` para determinar `payment_processor`.
  2. Si no encuentra `payment_processor` o falta el ID de referencia (`paypal_capture_id`/`mercadopago_payment_id` para pagos viejos) → **rechaza con error claro** ("Esta reserva no tiene una referencia de pago válida para reembolso a método original, usa Transferencia o ToursRed Cash") en vez de fallar silenciosamente.
  3. Llama a `process-payment-refund` (el orquestador nuevo de la Épica 2) de forma síncrona (igual que ya hace con `toursred_cash`), y guarda el `payment_refund_id` retornado en `admin_booking_cancellations` y `booking_cancellations`.
  4. El resto de la función (deducción de puntos, cancelación de opcionales/suplementos, notificaciones) **no cambia** — ya está desacoplado del método de reembolso.

- Task 5.3: Frontend del modal (React) — agregar un tercer botón junto a "ToursRed Cash" y "Transferencia": **"Método de pago original"**. Al seleccionarlo:
  - Ocultar el campo de subida de comprobante (`receipt_base64`/`receipt_filename`) que hoy es obligatorio solo para Transferencia.
  - Mostrar el procesador detectado (ej. "Se reembolsará vía Stripe a la tarjeta terminación ****1234") si el frontend puede consultarlo, o al menos un texto genérico "Se reembolsará al método de pago original usado en la reserva."
  - Si la reserva no tiene processor/referencia válida (pago viejo sin migrar), deshabilitar el botón con tooltip explicativo — mejor bloquear en UI que dejar que el usuario lo intente y falle en backend.

- Task 5.4 (nice-to-have, no bloqueante): Panel simple para ver `payment_refunds` en estado `pending`/`failed` y poder reintentar — útil para que soporte no tenga que ir directo a Supabase cuando algo se atora.

---

## 10. Casos de prueba clave (para tu matriz UAT)

1. Reembolso 100% a Cash — ya cubierto, no debe romperse con este cambio (regresión).
2. Reembolso 100% a tarjeta original vía Stripe (mexicano) — verificar `processor_fee_lost` calculado y póliza contable generada.
3. Reembolso 100% a tarjeta original vía Stripe (extranjero, tarjeta USD) — verificar conversión/moneda correcta.
4. Reembolso 100% vía PayPal — verificar que el webhook nuevo dispare correctamente.
5. Reembolso 100% vía MercadoPago — verificar `processor_fee_lost = 0`.
6. Reembolso parcial (50%, zona 7-14 días) a método original — verificar cálculo proporcional de comisión.
7. Intento de reembolso duplicado con mismo `idempotency_key` — debe rechazarse.
8. Webhook llega antes que la función orquestadora termine (race condition) — verificar que no se sobreescriba estado incorrectamente.
9. Reembolso falla en el procesador (tarjeta vencida, cuenta cerrada) — verificar que quede en `failed` con `failure_reason` legible para soporte, y que se notifique al admin.
10. Reembolso a método original de una transacción vieja que **no tiene** `paypal_capture_id`/`mercadopago_payment_id` guardado (dato faltante pre-migración) — debe fallar con mensaje claro, no silenciosamente.

---

## 11. Decisiones confirmadas (17-jul-2026)

Ya no son preguntas abiertas — quedaron resueltas y reflejadas en la sección 2:

1. Selector de método → **solo admin**, viajero self-service siempre ve Cash únicamente.
2. Comisión perdida → **ToursRed la absorbe completa**, no se toca el Contrato de Adhesión.
3. Reembolsos fallidos → **alertas automáticas a ops** (ver Épica 6).
4. Bloqueante para 11 de agosto → **sí, confirmado, sin MVP reducido.**

## 12. Épica 6 — Alertas a ops (nueva, por decisión de Axel)

- Task 6.1: Cuando `payment_refunds.status` cambia a `'failed'` (ya sea porque el procesador rechazó la creación del reembolso, o porque el webhook confirma un fallo posterior), disparar notificación inmediata — no esperar a revisión periódica.
- Task 6.2: Canal de la alerta — definir si es email a `contacto@toursred.com` (reutilizando el patrón ya existente de `send-cancellation-notification-admin`), Slack, o ambos. Recomendación: email inmediato como mínimo viable, ya que ya tienes la infraestructura de envío de correos (Resend/similar) montada y probada en otras funciones.
- Task 6.3: El mensaje de alerta debe incluir: `booking_id`, `payment_refund_id`, `payment_processor`, `requested_amount`, `failure_reason`, y un link directo al registro en `admin/bookings` para que ops pueda actuar sin tener que buscar manualmente.
- Task 6.4: Esta función se dispara desde dos lugares: (a) el orquestador `process-payment-refund` si la llamada síncrona al procesador falla de inmediato, y (b) el webhook correspondiente (`stripe-webhook`, `paypal-webhook`, `mercadopago-webhook`) si el fallo llega de forma asíncrona.
