# Prompts para Bolt/Codex — Sistema de Reembolsos Multi-Procesador

Basado en: `spec_sistema_reembolsos_multiprocesador.md`
Bloqueante para lanzamiento 11 de agosto 2026.

**Regla de proceso (recordatorio para ti, Axel, no para pegar en Bolt):** cada prompt de abajo debe ejecutarse y luego **verificarse tú mismo vía Supabase MCP** antes de marcarlo como hecho — no confíes en que Bolt reporte "implementado" sin confirmarlo con una consulta directa a la tabla o función correspondiente.

---

## PROMPT 1 — Esquema de datos

```
Necesito que crees la infraestructura de datos para un sistema de reembolsos multi-procesador (Stripe, PayPal, MercadoPago) en ToursRed. Este es el proyecto Supabase huzsedewwzjywcpbkjkm.

1. Crea una nueva tabla `payment_refunds` con esta estructura exacta:

CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  cancellation_id uuid REFERENCES booking_cancellations(id),
  partial_cancellation_id uuid REFERENCES booking_partial_cancellations(id),
  payment_transaction_id uuid REFERENCES payment_transactions(id),
  refund_method text NOT NULL CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  requested_by text NOT NULL DEFAULT 'admin_override' CHECK (requested_by IN ('traveler_default', 'traveler_profeco_request', 'admin_override')),
  payment_processor text CHECK (payment_processor IN ('stripe', 'paypal', 'mercadopago')),
  processor_refund_id text,
  processor_original_reference text,
  requested_amount numeric(10,2) NOT NULL CHECK (requested_amount >= 0),
  processor_fee_lost numeric(10,2) NOT NULL DEFAULT 0,
  net_cost_to_toursred numeric(10,2) GENERATED ALWAYS AS (requested_amount + processor_fee_lost) STORED,
  currency text NOT NULL DEFAULT 'mxn',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','requires_action','cancelled')),
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

Aplica RLS: el viajero solo puede leer (SELECT) sus propios registros (join contra bookings.user_id = auth.uid()), nunca insertar/actualizar directamente. Todo INSERT/UPDATE debe venir de service role (Edge Functions).

2. Extiende `payment_transactions`:

ALTER TABLE public.payment_transactions
  ADD COLUMN payment_processor text CHECK (payment_processor IN ('stripe','paypal','mercadopago')),
  ADD COLUMN paypal_capture_id text,
  ADD COLUMN mercadopago_payment_id text,
  ADD COLUMN processor_fee numeric(10,2) DEFAULT 0;

UPDATE public.payment_transactions
SET payment_processor = 'stripe', processor_fee = stripe_fee
WHERE stripe_payment_intent_id IS NOT NULL AND payment_processor IS NULL;

3. Extiende `booking_cancellations` y `booking_partial_cancellations`:

ALTER TABLE public.booking_cancellations
  ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash' CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id);

ALTER TABLE public.booking_partial_cancellations
  ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash' CHECK (refund_method IN ('toursred_cash', 'original_payment_method')),
  ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id);

4. Extiende `admin_booking_cancellations` — HOY tiene este constraint:
   CHECK ((refund_method = ANY (ARRAY['none'::text, 'toursred_cash'::text, 'bank_transfer'::text])))
   Reemplázalo por:

ALTER TABLE public.admin_booking_cancellations DROP CONSTRAINT admin_booking_cancellations_refund_method_check;
ALTER TABLE public.admin_booking_cancellations ADD CONSTRAINT admin_booking_cancellations_refund_method_check
  CHECK (refund_method = ANY (ARRAY['none'::text,'toursred_cash'::text,'bank_transfer'::text,'original_payment_method'::text]));
ALTER TABLE public.admin_booking_cancellations ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id);

5. IMPORTANTE — antes de dar esto por terminado, revisa el código de las Edge Functions `create-paypal-order`, `capture-paypal-order`, `create-mercadopago-preference`, y `process-mercadopago-brick-payment`. Confírmame explícitamente por escrito: ¿ya están guardando el `capture_id` de PayPal y el `payment_id` de MercadoPago en algún lado (aunque sea en un campo `metadata` jsonb) para pagos ya procesados? Si no lo están guardando en ningún lado, dime cuántos registros de `payment_transactions` con processor paypal/mercadopago no tendrían forma de vincularse — eso me dice cuántos pagos viejos quedarían sin poder reembolsarse a método original.

Todas las migraciones deben aplicarse con nombres descriptivos en snake_case y quedar en el historial de migraciones de Supabase, no como cambios directos sin registro.
```

---

## PROMPT 2 — Servicio de reembolso (orquestador + adapters)

```
Ahora necesito el servicio que ejecuta reembolsos a método de pago original. Este reembolso SOLO se dispara desde el panel de administración (admin/bookings) — no desde el flujo self-service del viajero, así que no necesitas tocar `process-traveler-cancellation`.

Contexto: ya existe `admin-cancel-booking` (Edge Function) que hoy soporta refund_method = 'none' | 'toursred_cash' | 'bank_transfer'. Voy a pedirte en un prompt aparte que la extiendas — en este prompt solo construye el servicio de reembolso en sí, como una función reutilizable/nueva Edge Function llamada `process-payment-refund`.

Reglas de negocio importantes:
- ToursRed SIEMPRE absorbe la comisión del procesador perdida (Stripe/PayPal no la regresan, MercadoPago sí). El viajero SIEMPRE recibe el `requested_amount` completo — NUNCA se le descuenta la comisión perdida. La comisión perdida (`processor_fee_lost`) es solo para registro contable interno, ver Prompt 4.
- El reembolso NUNCA se marca como `succeeded` solo por la respuesta HTTP inmediata del procesador — el estado final SIEMPRE lo confirma el webhook correspondiente (ver Prompt 3). Si la creación síncrona fue exitosa pero el procesador es asíncrono, el estado queda en `processing`, no en `succeeded`.

Crea la Edge Function `process-payment-refund` que:

1. Recibe: { booking_id, cancellation_id (opcional), partial_cancellation_id (opcional), payment_transaction_id, amount, currency }
2. Genera un `idempotency_key` determinístico (ej: `refund_${booking_id}_${Date.now()}`) y lo usa para verificar que no exista ya un `payment_refunds` con ese booking_id en estado pending/processing/succeeded antes de proceder — si existe, rechaza con error claro de duplicado.
3. Inserta un registro en `payment_refunds` con status='pending'.
4. Según `payment_transactions.payment_processor`, llama al adapter correspondiente:

   STRIPE:
   const refund = await stripe.refunds.create({
     payment_intent: paymentTransaction.stripe_payment_intent_id,
     amount: Math.round(amount * 100),
     reason: 'requested_by_customer',
     metadata: { booking_id, toursred_refund_id: paymentRefundRecord.id }
   }, { idempotencyKey: paymentRefundRecord.idempotency_key });

   PAYPAL:
   POST https://api-m.paypal.com/v2/payments/captures/{paypal_capture_id}/refund
   Body: { amount: { value: amount.toFixed(2), currency_code: 'MXN' }, note_to_payer: 'Reembolso ToursRed' }

   MERCADOPAGO:
   POST https://api.mercadopago.com/v1/payments/{mercadopago_payment_id}/refunds
   Body: { amount: amount }

5. Calcula `processor_fee_lost`:
   - Stripe/PayPal: proporcional al `processor_fee` guardado en `payment_transactions`, según (amount / monto_original_de_la_transaccion)
   - MercadoPago: siempre 0
6. Actualiza `payment_refunds` con `processor_refund_id`, `payment_processor`, `processor_fee_lost`, y status='processing' (o 'succeeded' SOLO si el procesador confirma síncronamente, como puede pasar en algunos casos de MercadoPago — revisa su documentación de refunds para confirmar si su API es síncrona o no).
7. Si la llamada al procesador falla inmediatamente (error 4xx/5xx), marca status='failed', guarda failure_reason, y dispara la alerta a ops (la función de alertas la construyo en el Prompt 5, por ahora deja un TODO con un console.error claro y un placeholder de invocación a una función `notify-ops-refund-failed` que construiré después).
8. Valida SIEMPRE server-side que `amount` no exceda el monto disponible para reembolso de esa transacción (monto original menos reembolsos previos ya succeeded sobre la misma payment_transaction_id).

Devuelve { success, payment_refund_id, status, processor_refund_id }.
```

---

## PROMPT 3 — Webhooks

```
Necesito que confirmes y extiendas el manejo de webhooks para que los reembolsos creados por `process-payment-refund` se confirmen correctamente. Recuerda: el estado final de un reembolso SIEMPRE lo confirma el webhook, nunca la respuesta síncrona de creación.

1. STRIPE — extiende la Edge Function existente `stripe-webhook`. Primero muéstrame qué eventos maneja actualmente (quiero confirmarlo antes de que agregues nada). Después agrega manejo de:
   - charge.refunded → busca en payment_refunds por processor_refund_id o por metadata.toursred_refund_id, actualiza status='succeeded', confirmed_at=now()
   - refund.updated → sincroniza estado intermedio si status cambió
   - refund.failed → status='failed', guarda failure_reason del evento, dispara alerta a ops

2. PAYPAL — esta Edge Function NO EXISTE, créala desde cero: `paypal-webhook`.
   - IMPORTANTE: debe verificar la firma del webhook usando la API de verificación de PayPal (POST a /v1/notifications/verify-webhook-signature) antes de procesar cualquier evento. Sin esto cualquiera podría falsificar una confirmación de reembolso.
   - Eventos a manejar: PAYMENT.CAPTURE.REFUNDED (status='succeeded'), PAYMENT.CAPTURE.REVERSED (marca para revisión manual, no succeeded automático).
   - Ya que la estás creando, agrega también el manejo de PAYMENT.CAPTURE.COMPLETED y CUSTOMER.DISPUTE.CREATED / CUSTOMER.DISPUTE.RESOLVED — estos ya estaban pendientes en el backlog técnico y aprovechamos que estás tocando este archivo.
   - Después de crearla, dime exactamente qué URL debo registrar en el Developer Dashboard de PayPal — yo lo hago manualmente, es configuración fuera de código.

3. MERCADOPAGO — revisa el código actual de `mercadopago-webhook` y dime explícitamente: ¿ya procesa correctamente cuando el status de un payment existente cambia a 'refunded' o 'partially_refunded'? MercadoPago no manda un evento distinto para refund, reutiliza la notificación de topic=payment con el mismo id. Si hoy lo ignora, agrega el manejo para actualizar payment_refunds cuando detecte ese cambio de estado.
```

---

## PROMPT 4 — Contabilidad (comisión perdida)

```
Cuando un payment_refund pasa a status='succeeded' y tiene processor_fee_lost > 0, necesito que se genere automáticamente una entrada contable en el mini-ERP interno (chart_of_accounts, accounting_entries, accounting_entry_lines).

1. Revisa chart_of_accounts y dime si ya existe una cuenta para "comisión de procesamiento no recuperable" o equivalente. Si no existe, créala con el código apropiado siguiendo la nomenclatura que ya usan las demás cuentas de gasto.

2. Extiende (o crea, si es más limpio) la función de generación de pólizas — ya existe create_accounting_entry_for_cancellation como referencia de patrón — para que dispare cuando payment_refunds.status cambia a 'succeeded' y processor_fee_lost > 0:

   Cargo (debit):  [cuenta de gasto por comisión no recuperable]  → processor_fee_lost
   Abono (credit): [cuenta de banco/procesador correspondiente]   → processor_fee_lost

   Usa source_type = 'payment_refund', source_id = payment_refunds.id, mismo patrón que ya usa accounting_entries.source_type/source_id en otros lados.

3. Este disparo debe ocurrir desde el webhook que confirma el reembolso (Prompt 3), no desde process-payment-refund directamente, porque solo se contabiliza cuando el reembolso está confirmado, no cuando solo se solicitó.

RECORDATORIO IMPORTANTE: el mini-ERP interno (chart_of_accounts, accounting_entries, accounting_entry_lines, accounting_sync_log) es el único sistema contable real. Las integraciones con Zoho Books y Odoo están deprecadas — su código sigue en el repo pero NO debe usarse ni probarse. No conectes esta nueva lógica a Zoho/Odoo bajo ninguna circunstancia.
```

---

## PROMPT 5 — Alertas a ops

```
Necesito alertas automáticas e inmediatas cuando un reembolso falla — no revisión periódica manual, sino notificación al instante.

Crea la Edge Function `notify-ops-refund-failed` que:
1. Recibe { payment_refund_id }
2. Consulta payment_refunds + el booking relacionado para armar el contexto completo
3. Envía un email inmediato a contacto@toursred.com (reutiliza el mismo patrón/proveedor de envío que ya usa send-cancellation-notification-admin — revisa ese código como referencia de estilo y remitente)
4. El email debe incluir: booking_id, booking_code, payment_refund_id, payment_processor, requested_amount, failure_reason, y un link directo a la reserva en admin/bookings (formato de URL: revisa cómo se construyen los links en las notificaciones existentes para mantener consistencia)
5. Se invoca desde DOS lugares:
   - process-payment-refund (Prompt 2), cuando la llamada síncrona al procesador falla de inmediato
   - Los tres webhooks (Prompt 3), cuando el fallo se confirma de forma asíncrona (refund.failed de Stripe, evento equivalente de PayPal, o estado de fallo de MercadoPago)

Conecta las invocaciones donde dejé los TODOs en el Prompt 2 y agrega las invocaciones correspondientes en los tres webhooks del Prompt 3.
```

---

## PROMPT 6 — Admin panel (`admin/bookings`)

```
Ahora conecta todo lo anterior al panel de administración. Este es el ÚNICO lugar donde un usuario puede disparar un reembolso a método de pago original en esta fase — el viajero en su flujo self-service sigue viendo solo la opción de ToursRed Cash, eso no cambia.

1. Edge Function `admin-cancel-booking` — hoy valida:
   if (!["none", "toursred_cash", "bank_transfer"].includes(refund_method))

   Cámbialo a:
   if (!["none", "toursred_cash", "bank_transfer", "original_payment_method"].includes(refund_method))

   Y agrega un nuevo bloque (sigue el mismo patrón que el bloque existente de refund_method === "toursred_cash"):

   if (refund_method === "original_payment_method" && Number(refund_amount) > 0) {
     // 1. Busca en payment_transactions el registro de booking_id, obtén payment_processor
     // 2. Si no hay payment_processor o falta la referencia del procesador (paypal_capture_id / mercadopago_payment_id según corresponda), 
     //    devuelve err("Esta reserva no tiene una referencia de pago válida para reembolso a método original. Usa Transferencia o ToursRed Cash.")
     // 3. Llama a process-payment-refund (invocación interna vía fetch a supabase.functions, mismo patrón que usa esta función para llamar a send-cancellation-notification-*)
     // 4. Guarda el payment_refund_id retornado tanto en admin_booking_cancellations como en booking_cancellations
   }

   El resto de la función (deducción de puntos, cancelación de opcionales/suplementos, notificaciones) NO cambia.

2. Frontend del modal de cancelación en admin/bookings — agrega un tercer botón junto a "ToursRed Cash" y "Transferencia": "Método de pago original".
   - Al seleccionarlo, oculta el campo de subida de comprobante (que hoy es obligatorio solo para Transferencia).
   - Muestra un texto informativo: "Se reembolsará al método de pago original usado en la reserva (Stripe/PayPal/MercadoPago según corresponda)."
   - Si la reserva no tiene payment_processor detectado o le falta la referencia (pago viejo sin migrar), deshabilita este botón con un tooltip: "Esta reserva no tiene datos de pago suficientes para reembolso a método original."
   - Mantén el resto del modal (motivo para viajero, motivo para agencia, monto sugerido, puntos a descontar) exactamente igual.
```
