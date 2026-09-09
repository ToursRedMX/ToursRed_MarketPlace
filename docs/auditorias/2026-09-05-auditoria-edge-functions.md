# Auditoría de Edge Functions — 05 de septiembre de 2026

**Alcance:** las 171 Edge Functions de `supabase/functions/` (~69,600 líneas) más
`supabase/config.toml` y los módulos de `_shared/`.
**Tipo de trabajo:** solo revisión y documentación. **No se modificó código.**
**Método:** barrido sistemático cruzando `verify_jwt` de `config.toml` contra la
autorización real dentro de cada función, más lectura manual de los caminos de
dinero, webhooks y correo.

**Fuera de alcance (no auditado en esta pasada):** frontend (`src/`), políticas RLS,
migraciones SQL, funciones de Netlify, y la superficie de `_shared/contractDocDefinition.ts`
(8,327 líneas, plantilla de contrato).

---

## Estado de la remediación (actualizado 09-sep-2026)

Este documento nació como solo-lectura. Después se atacaron los hallazgos, y **tres cosas
cambiaron respecto de lo que se escribió el 05-sep**: A-3 resultó falso positivo, C-1
resultó bastante más grande de lo documentado, y A-1 resultó a la vez más chico (5 de las
44 sí tenían guard) y más grande (hay 7 funciones `send-*` más, con `verify_jwt = true`,
igual de alcanzables). Las tres correcciones están abajo, en su sección, con la evidencia.

| Hallazgo | Estado | Dónde |
|---|---|---|
| C-1 | **Cerrado, las dos mitades** — el checkout ya no acepta el monto del cliente (`a90237d`), y el webhook ya no confirma sin mirar cuánto entró (`edc5016`) | `a90237d`, `edc5016` |
| C-2 | **Corregido** — el webhook falla cerrado | `bed5563` |
| A-1 | **Corregido** (y corregido el conteo: eran 39 de 44 sin control, y hay 7 más igual de expuestas con `verify_jwt = true`) | ver más abajo |
| A-2 | **Corregido** — exige dueño/agencia/staff/admin o service role | `bed5563` |
| A-3 | **FALSO POSITIVO** — retirado del conteo | — |
| M-1 | **Corregido y desplegado** (`send-contact-email` v82); la confirmación que faltaba —que `TURNSTILE_SECRET_KEY` existe— ya está hecha | ver más abajo |
| M-2 | **Corregido** — el helper falla cerrado, y el hallazgo se quedó corto: los toggles de MFA están **encendidos** en producción, así que era un bypass vivo, no latente | ver más abajo |
| M-6 | **Corregido en código** — y el hallazgo se quedó corto por partida doble: 6 de los sitios eran correctos, y en los otros 20 el `catch` ni siquiera era el problema | ver más abajo |
| M-3 | **Cerrado como decisión** — OpenPay no ofrece firma ni Basic auth para webhooks; la mitigación existente es la defensa disponible | ver más abajo |
| M-5 | **Corregido** — y el hallazgo se quedó corto: la cabecera CORS valía poco, pero 9 funciones armaban la URL de retorno del pago con el `Origin` del atacante | ver más abajo |
| M-4 | **Corregido** — guard de service role en los dos crons | `bed5563` |

**Conteo corregido: 10 hallazgos reales en este documento** (2 críticos, 2 altos,
6 medios), no 11. Sumando las otras dos auditorías, **21 en total, no 22.**

### Marcador global de las tres auditorías (09-sep-2026)

Las otras dos tienen ahora su propia tabla de estado, verificada contra el código.

| Auditoría | Cerrados | Abiertos | Total |
|---|---|---|---|
| Edge functions (este documento) | C-1, C-2, A-1, A-2, M-1, M-2, M-4, M-5, M-6 | — | **10 / 10** |
| — de esos, M-3 se cierra como decisión: el panel de OpenPay no ofrece ni firma ni Basic auth; la re-consulta del cargo es la defensa disponible | | | |
| Postgres | A-1, M-1, M-2, M-3, M-4, **y C-1**, un crítico que no estaba en la auditoría: `confirm_booking_paid_with_wallet` confirmaba reservas sin cobrarlas. Lo destapó la guardia de autorización de este documento | — | **5 / 5 + 1** |
| Frontend | F-1, F-2, F-3, F-4, F-5, F-6 | — | **6 / 6** |
| — F-1 pasó de 262 sitios a **0**, y `scripts/check-supabase-errors.mjs` quedó con la línea base en cero: cualquier consulta nueva que ignore su error rompe CI | | | |
| **Total** | **21** | **0** | **21** |

> Este total se calcula sumando las filas de arriba, no de memoria. El 08-sep-2026
> estuvo mal (decía 14/7) porque se incrementó a mano sin recontar; las filas ya
> sumaban uno menos.

Durante la remediación aparecieron hallazgos nuevos que no estaban en esta auditoría;
se documentan al final, en *Hallazgos surgidos durante la remediación*.

---

## Nota metodológica importante: qué significa `verify_jwt = true`

Esto es la clave para leer todo lo que sigue, y ya está bien entendido en el repo
—`_shared/cfdiAuth.ts` lo documenta explícitamente—, pero conviene repetirlo porque
determina la severidad de varios hallazgos:

> `verify_jwt = true` **no** significa "solo usuarios autenticados". Significa
> "trae un JWT firmado por este proyecto". **La llave publicable (anon key) es
> exactamente eso**, y va en el bundle del front, o sea que es pública.

Por lo tanto, una función con `verify_jwt = true` y sin validación interna es, en la
práctica, **tan pública como una con `verify_jwt = false`**. La única diferencia es que
el atacante tiene que copiar una llave del bundle de JavaScript.

**Números del barrido:**

| | Funciones |
|---|---|
| Total | 171 |
| `verify_jwt = false` declarado | 74 |
| `verify_jwt = true` (default) | 97 |
| `verify_jwt = true` **sin** autorización interna | 7 |
| **Alcanzables sin cuenta de usuario** (suma efectiva) | **~81** |

---

## Resumen ejecutivo

Lo bueno primero, porque es real y no es poco: hay trabajo de endurecimiento serio y
bien pensado. `_shared/cfdiAuth.ts` centraliza correctamente la autorización de timbrado
y razona el modelo de amenazas por escrito. `process-payment-refund` y
`process-payment-plan-tour-deadline` exigen service role de forma explícita.
`capture-paypal-order` valida pagos parciales. Conekta verifica firma RSA y PayPal
verifica contra la API de PayPal. **No hay ni un secreto hardcodeado** en las 171
funciones. La idempotencia está pensada en los webhooks de OpenPay y en las llamadas
a wallet/puntos.

Dicho eso, encontré **2 hallazgos críticos, 3 altos y 6 medios**. (Corrección posterior:
A-3 resultó falso positivo, así que el conteo real de este documento es **2 críticos,
2 altos y 6 medios = 10**.) El patrón de fondo
que los conecta: **la autorización se resolvió función por función, y quedó desigual.**
Los caminos que alguien revisó a conciencia están sólidos; los que nadie revisó están
completamente abiertos. No hay un guard compartido que se aplique por defecto, así que
la seguridad de cada endpoint depende de si a alguien se le ocurrió ponérselo.

El hallazgo #1 es el que atendería antes del lanzamiento del 21 de septiembre: **el
camino de Stripe —el procesador principal— acepta el monto a cobrar desde el cliente
y lo confirma sin validarlo contra el precio guardado.**

> **Corrección del 07-sep-2026, al arreglarlo.** Esa frase se quedó corta. `amount` no
> era la única palanca ni la más directa: `create-checkout-session` tampoco verificaba
> la identidad de quien llamaba (leía la cabecera `Authorization` solo para comprobar
> que existiera), y aceptaba `toursRedCashUsed` y `pointsUsed` del cuerpo como descuento
> directo sobre el cobro, sin contrastarlos contra el saldo real. Ver C-1.

---

# CRÍTICOS

## C-1. El monto a pagar lo decide el cliente en el camino de Stripe

**Archivos:** `supabase/functions/create-checkout-session/index.ts`,
`supabase/functions/stripe-webhook/index.ts`

**Qué pasa.** `create-checkout-session` recibe `amount` y `bookingId` del cuerpo de la
petición (`index.ts:31,42`). Valida únicamente que `amount` no sea nulo y que sea mayor
a 0 (`index.ts:44,57`). Después lee la reserva de la base (`index.ts:104-113`,
trae `deposit_amount`, `service_charge`, `travel_insurance_cost`) y construye las
líneas de Stripe a partir de esos datos correctos.

Y entonces hace justo lo contrario de validar:

```ts
// index.ts:487-500
// Safety: verify sum matches `amount`; if drift, adjust the deposit line to compensate
const linesSum = lineItems.reduce((s, li) => s + (li.price_data.unit_amount / 100), 0);
const drift = Math.round((amount - linesSum) * 100) / 100;
if (Math.abs(drift) >= 0.01) {
  const depositLi = lineItems.find((li) => li.metadata?.type === 'deposit');
  if (depositLi) {
    depositLi.price_data.unit_amount = Math.round((Number(depositLi.price_data.unit_amount) / 100 + drift) * 100);
  }
  ...
}
```

El comentario dice "safety" y la intención era absorber centavos de redondeo, pero el
código **no acota el ajuste**: toma la diferencia entre lo que calculó desde la base y
lo que mandó el cliente, y **modifica las líneas para que el total sea el del cliente.**
`drift` puede ser de miles de pesos y se aplica igual. No existe en toda la función una
comparación de `amount` contra el total calculado que rechace la petición (verificado:
las únicas comparaciones sobre `amount` en el archivo son las de las líneas 44 y 57).

**Por qué esto sí llega a cobrarse mal.** Podría no importar si el webhook validara al
confirmar. No lo hace. En `stripe-webhook`, `payment_intent.succeeded` marca la reserva
como pagada y confirmada sin mirar cuánto entró:

```ts
// stripe-webhook/index.ts:1785-1793
if (bookingId) {
  const { error: bookingError } = await supabase
    .from('bookings')
    .update({
      payment_status: 'succeeded',
      payment_intent_id: paymentIntent.id,
      paid_at: new Date().toISOString(),
      status: 'confirmed',
      payment_method: paymentMethodType
    })
    .eq('id', bookingId);
```

No hay comparación contra `deposit_amount` ni contra `total_price` en ninguna de las dos
ramas que confirman reservas (`:1018-1027` y `:1785-1793`).

**El contraste que lo confirma como bug y no como diseño.** Los otros dos procesadores
hacen lo correcto, cada uno por su lado:

- `create-paypal-order/index.ts:88-174` **deriva el monto del servidor**: lo lee de
  `gift_cards.amount`, de `booking_supplements.total_paid`, o de
  `bookings.amount_due_now / deposit_amount`. Nunca confía en `bodyAmount` salvo en el
  camino de suplementos, y aun ahí lo contrasta.
- `capture-paypal-order/index.ts:116-131` **valida el pago parcial**: suma lo ya pagado,
  lo compara contra `requiredAmount = deposit_amount` y, si no alcanza, deja la reserva
  en `processing` en vez de confirmarla.

O sea: la lógica correcta ya existe en el repo, escrita para PayPal, y no se replicó en
el camino de Stripe, que es el principal.

**Impacto.** Un atacante con una reserva propia (o con cualquier `bookingId` válido)
puede pedir una sesión de checkout por $1 MXN sobre un tour de $30,000 y la reserva
queda `confirmed` / `payment_status: succeeded`. Se dispara todo el flujo posterior:
CFDI, contabilidad, correo de confirmación y asiento de comisión de la agencia. La
pérdida no la absorbe solo ToursRed: se le confirma a la agencia una venta que no se
cobró.

**Cómo verificarlo sin arreglarlo:** en staging, `POST` a
`/functions/v1/create-checkout-session` con el `bookingId` de una reserva real y
`amount: 1`, completar el pago con tarjeta de prueba y ver el estado final de la reserva.

---

### Corrección del 07-sep-2026: eran cuatro palancas, no una — CORREGIDO en `a90237d`

Al abrir el archivo para arreglarlo, `amount` resultó ser **la menos directa** de las
vías para pagar de menos. Lo que este hallazgo debió decir desde el principio:

| # | Problema | Estado antes |
|---|---|---|
| 1 | **Sin verificación de identidad** | `:87` leía la cabecera `Authorization` solo para comprobar que existiera. **Nunca llamaba `getUser()`.** Con `verify_jwt` puesto, la llave publicable ya es un JWT válido del proyecto (ver la nota metodológica al inicio), así que **cualquiera con un `bookingId` podía abrir un cobro sobre la reserva de otra persona** |
| 2 | `toursRedCashUsed` del cliente | `buildDesgloseLineItems` lo resta directo de las líneas de Stripe, **sin contrastarlo contra el saldo real** |
| 3 | `pointsUsed` del cliente | Igual, a razón de 100 puntos = 1 MXN, sin contrastar |
| 4 | `amount` del cliente | El bloque rotulado "Safety" descrito arriba |

**Lo que cierra el círculo, y que no vi en la primera pasada:** `update_wallet_balance`
**sí** lanza `Insufficient balance` cuando el saldo no alcanza (verificado en
`20260831031430_revert_null_check_and_lockdown_partial_cancel_points.sql:263`). Pero el
webhook captura esa excepción, la manda a `console.error` (`stripe-webhook:1260`) y
**confirma la reserva de todos modos.**

O sea: con `toursRedCashUsed: 30000` sobre un tour de $30,000, Stripe cobraba ~nada, el
descuento de billetera fallaba en silencio, y la reserva quedaba `confirmed`. **Sin tocar
`amount`.** La palanca #2 era más simple de explotar que la que documenté como principal.

Y el equivalente en puntos ni siquiera falla: `deduct_points_for_booking` hace
`p_points_to_deduct := LEAST(p_points_to_deduct, v_current_balance)`, o sea **recorta en
silencio** — el descuento ya se dio en Stripe y no hay error que ver.

**Qué se hizo (`a90237d`):**

1. `getUser()` real con la llave anon + el header entrante; se exige dueño de la reserva
   o admin, o 403. Verificado antes de aplicarlo que los tres llamadores del front
   (`BookingFlowStep4`, `TravelersInfoPage`, `TravelerBookings`) mandan el `access_token`
   del usuario y que **no hay ningún llamador interno con service role**.
2. Saldo y puntos se leen de `toursred_cash_wallets` / `toursred_points_wallets`; si se
   pide más de lo disponible, 400. La metadata que viaja a Stripe lleva los valores
   validados, no los crudos.
3. **Se eliminó el ajuste por drift.** Las líneas ya se derivaban de la base; `amount`
   solo servía para deformarlas. Ahora se cobra siempre el total del servidor.
4. `amount` queda como *tripwire*: se compara contra el desglose y se rechaza si difiere
   más de `TOLERANCIA_MONTO_MXN` ($1). Entre 1 centavo y $1 se cobra el del servidor y se
   deja un `console.warn`.

**Matiz importante para quien lea esto después:** el hueco lo cierran los puntos 1–3.
El punto 4 es una alarma para detectar bugs propios del front, **no** la defensa. Si
algún día estorba, se puede subir la tolerancia o quitarlo sin reabrir nada.

### La segunda mitad de C-1 — cerrada el 09-sep-2026 (`edc5016`, PR #178)

Faltaba que el webhook comparara lo cobrado contra el anticipo antes de confirmar. Con la
primera mitad arreglada ya no era explotable desde fuera (habría que fabricar la sesión de
Stripe, lo que exige la secret key), así que esta capa protege contra bugs propios — que es
exactamente como falló la primera vez.

**No se copió la regla de `capture-paypal-order:116-131`, aunque este documento lo proponía.**
Copiarla literal rompe confirmaciones legítimas, y eso no es una opinión: se simuló contra
las **26 reservas confirmadas que no son de PayPal** (07-jul a 05-sep-2026).

- La regla de PayPal (`totalPaid < deposit_amount - 0.5`) no suma puntos ni ToursRed Cash.
  En **TRG-E5BGCYW29XY** el viajero pagó 4,706.84 con tarjeta y 562.61 en puntos sobre un
  anticipo de 5,149.50: la habría dejado sin confirmar.
- La alternativa "obvia" —exigir `amount_due_now`— tampoco sirve: incluye `membership_cost`,
  que se cobra por otra vía, e incluye los extras completos cuando el checkout sólo cobra
  los que siguen sin pagar. Habría bloqueado **2 de las 6** confirmaciones de Stripe.

Lo que quedó, en `_shared/coberturaDePago.ts`, son dos reglas separadas:

- **Bloquea** si `pagado + puntos/100 + cash < deposit_amount - 0.5`. El anticipo es el piso,
  corregido por billetera porque `deposit_amount` es bruto y lo que cobra el procesador ya
  viene neto. Simulada contra las 26, sólo marca **TRG-PZKEAXWBZIV** (07-jul), que está
  `confirmed` / `succeeded` con cero transacciones y sin `payment_intent`. O sea, marca justo
  lo que se busca.
- **Avisa** (pero confirma) si `pagado < amount_due_now - membership_cost - 0.5`. El dinero ya
  entró; negarse a confirmar sería peor. Queda el rastro en `audit_errors`.

Detalles que no se ven en el diff y conviene no perder:

- El helper recibe el `payment_intent` de este cobro para **no contarlo dos veces** cuando
  Stripe reintenta el webhook. Sin eso, en el reintento la fila del intento anterior ya está
  en `payment_transactions` y se sumaría además del monto del evento: un cobro corto pasaría.
- El filtro de esa fila va en JS y **no con `.neq()`**: en PostgREST, `neq` sobre una columna
  NULL descarta la fila, y los cobros de OpenPay, MercadoPago o Conekta tienen
  `stripe_payment_intent_id` en NULL. Con `.neq()` se perderían y el total quedaría por debajo
  del real — justo la dirección que bloquea reservas legítimas.
- Si no se puede leer la reserva, **confirma igual** y marca `noVerificable`. El cobro ya se
  hizo; dejar una reserva pagada sin confirmar por un parpadeo de la base es peor.

Cuando bloquea, el webhook registra la transacción (idempotente), deja la reserva en
`processing` y anota `stripe-webhook/cobertura-insuficiente` en `audit_errors`.

**Verificación:** `node scripts/test-cobertura-pago.mjs` — 13 casos, todos con números reales
de reservas del proyecto, no inventados. Se probó por mutación: romper el piso hace fallar la
suite. **Desplegado** en `stripe-webhook` (v246/247), byte a byte igual a `main`.

**Durante el UAT conviene mirar esto:**

```sql
select attempted_at, error_message, raw_payload from public.audit_errors
where error_message like 'stripe-webhook/cobertura%'
   or error_message like 'stripe-webhook/cobro-menor%';
```

**Nota de alcance:** no revisé si alguna política RLS o algún trigger en `bookings`
frena esto aguas abajo. Lo dudo por cómo está escrito el webhook (usa service role, que
salta RLS), pero conviene confirmarlo antes de dimensionar el arreglo.

---

## C-2. El webhook de Stripe procesa eventos sin firma si falta la variable de entorno

**Archivo:** `supabase/functions/stripe-webhook/index.ts:239-242`

```ts
if (!endpointSecret) {
  console.warn("⚠️ No STRIPE_WEBHOOK_SECRET configured - skipping signature verification");
  event = JSON.parse(body);
}
```

**Qué pasa.** Si `STRIPE_WEBHOOK_SECRET` no está configurada, la función **no rechaza la
petición: la procesa confiando en el cuerpo tal cual llegó.** Es un *fail-open* en el
punto donde entra el dinero. La función tiene `verify_jwt = false` (necesario, porque
Stripe no manda JWT), así que en ese estado el endpoint acepta eventos de cualquiera.

Cualquiera que conozca la URL —que es predecible: `<proyecto>.supabase.co/functions/v1/stripe-webhook`—
podría mandar un `payment_intent.succeeded` fabricado con el `bookingId` que quiera y
confirmar reservas sin pagar, emitir CFDIs y generar asientos contables.

**Severidad condicionada, y por eso hay que verificarla, no asumirla.** Esto es crítico
**solo si la variable falta** en algún ambiente. En producción es muy probable que esté
puesta —si no, los pagos legítimos ya habrían fallado de otras formas—, pero:

1. **No lo pude verificar desde el repo.** Los secretos viven en el dashboard de Supabase,
   no en el código. Hay que mirarlo ambiente por ambiente (dev / staging / producción).
2. **Staging es el riesgo real.** Es donde más fácil se olvida una variable, y comparte
   la forma de la URL.
3. El fallo es silencioso: un `console.warn` que nadie lee, exactamente el mismo patrón
   que `claude.md` ya identificó en `snapshot_booking_tax`.

**El contraste, otra vez, está en el propio repo.** `paypal-webhook/index.ts:105-110` hace
lo correcto y hasta documenta por qué:

```ts
// CRITICAL: Reject all events if PAYPAL_WEBHOOK_ID is not configured.
// This forces the correct deployment order: [...]
```

PayPal falla cerrado. Stripe falla abierto. Es la misma decisión tomada al revés en la
función que más dinero mueve.

**Acción de verificación inmediata (no requiere tocar código):** confirmar que
`STRIPE_WEBHOOK_SECRET` existe en los tres ambientes.

---

# ALTOS

## A-1. ~44 funciones de correo son un relay abierto con contenido controlado por quien llame

**Archivos:** las funciones `send-*` declaradas con `verify_jwt = false` en
`supabase/config.toml`.

**Qué pasa.** Verifiqué que en estas funciones **la única coincidencia con la palabra
`Authorization` es la línea de CORS**. No hay `auth.getUser()`, ni comparación contra
service role, ni secreto compartido, ni rate limiting. Todas: (a) son alcanzables sin
credenciales, (b) leen su contenido de `await req.json()`, (c) mandan correo con el
SMTP y el dominio de ToursRed.

Ejemplo textual, `send-agency-credentials/index.ts:30-55`:

```ts
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { ... }
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { email, contactFirstName, contactLastName, agencyName,
            password, executiveEmail, executiveName } = await req.json();
    if (!email || !contactFirstName || !agencyName || !password || !executiveEmail) {
      return ... 400 ...
    }
    // → arma el HTML y manda el correo. No hay más validación.
```

Entre `OPTIONS` y el envío no hay un solo control de acceso.

**Las peores de la lista** (no por el mecanismo, que es el mismo, sino por el contenido
que permiten fabricar):

| Función | Por qué duele |
|---|---|
| `send-agency-credentials` | Manda un correo con **contraseña** y nombre de agencia, ambos elegidos por quien llama, desde el dominio real |
| `send-executive-credentials` | Igual, para ejecutivos |
| `send-password-reset` | Correo de "restablece tu contraseña" desde el dominio legítimo |
| `send-agency-approval` / `send-agency-welcome` | "Tu agencia fue aprobada" a cualquier destinatario |
| `send-payout-notification` | "Te pagamos $X" con monto arbitrario |
| `send-cfdi-email` | Adjunta/enlaza comprobantes fiscales |

**Impacto.** Tres cosas distintas, todas malas:

1. **Phishing con remitente auténtico.** No es un dominio parecido: es SPF/DKIM válidos
   de ToursRed. Es el peor tipo de phishing porque pasa todos los filtros y el usuario
   hace bien en confiar.
2. **Reputación de envío.** Cualquiera puede quemar el dominio mandando spam desde él.
   Recuperar reputación SMTP toma semanas, y mientras tanto los correos legítimos
   —confirmaciones de reserva— caen en spam.
3. **Cuota y costo.** Envío ilimitado contra la cuenta SMTP.

**Por qué está así (contexto, no excusa).** El diseño es coherente: estas funciones se
pensaron para llamarse *internamente* desde otras Edge Functions con service role
—se ve el patrón en `capture-paypal-order/index.ts:91-100`, que las invoca con
`Authorization: Bearer ${SERVICE_ROLE_KEY}`—. El problema es que **se les puso
`verify_jwt = false` para permitir esa llamada interna, y nadie agregó la verificación
del bearer del lado receptor.** El guard correcto ya existe en el repo y es de seis
líneas: `process-payment-plan-tour-deadline/index.ts:81-91`.

**Nota honesta:** no verifiqué cuáles de estas 44 son además llamadas desde el
frontend con sesión de usuario. Si alguna lo es, cerrarla con "solo service role" la
rompería, y hay que decidir caso por caso. Ese inventario es el primer paso del arreglo.

### Corrección del 08-sep-2026: el inventario cambió el hallazgo — CORREGIDO

La *Nota honesta* de arriba decía que el inventario de llamadores era el primer paso.
Se hizo, y cambió tres cosas del hallazgo tal como estaba escrito.

**1. No eran 44 sin ningún control: eran 39 de esas 44** (y 42 contando las 7 del punto
siguiente). Cinco de las 44 sí tenían guard y la
frase "la única coincidencia con `Authorization` es la línea de CORS" era falsa para
ellas: `send-booking-confirmation` (getUser + comparación contra service role),
`send-gift-card-email` (getUser + rol + propiedad + tope de 3 reenvíos en 24 h),
`send-verification-email`, `send-welcome-email` y `send-contact-email` (Turnstile,
aunque opcional — eso es M-1).

**2. Faltaban 7.** El filtro de la auditoría fue `verify_jwt = false`, pero eso no es
lo que determina si una función es alcanzable — es justo lo que dice la *Nota
metodológica* de este mismo documento. Hay 7 funciones `send-*` con `verify_jwt = true`
y la llave publicable las alcanza igual: `send-membership-payment-failed`,
`send-newsletter-broadcast`, `send-partial-cancellation-notification-admin`,
`send-partial-cancellation-notification-traveler`, `send-payout-confirmation`,
`send-staff-invitation`, `send-tour-mass-message`. De ellas, 4 ya tenían guard.

**3. "Cerrarlas con solo service role" habría roto seis caminos vivos.** El inventario
(grep sobre `src/`, `supabase/functions/` y `supabase/migrations/`, mirando la cabecera
real de cada llamada, no el nombre de la función) encontró:

| Lo que se encontró | Dónde |
|---|---|
| 5 llamadas edge→edge **sin ninguna cabecera `Authorization`** | `resend-agency-credentials`, `fix-agency-email`, `convert-lead-to-agency`, `create-executive-user`, `manage-membership-subscription` |
| 3 llamadas edge→edge con la **anon key** | `process-receptivo-slot-cancellation` (×2), `process-slot-reschedule-request` |
| 3 crons de Postgres que mandan el service role en el header **`apikey`**, no en `Authorization` | `process_expired_slot_reschedules`, `process_membership_renewal_reminders` |
| 1 trigger de Postgres que manda la **publishable key** | `notify_executive_by_email` |
| 4 llamadas del front sin sesión (llave publicable o nada) a funciones de admin | `AdminAgencies.tsx`, `AdminTicketDetail.tsx` (×3) |
| 4 funciones llamadas desde el front **cuando todavía no hay sesión** | contacto, cotizaciones, recuperar contraseña, alta con código de referido |

**Cómo quedaron.** Cuatro grupos:

- **Solo service role (31 funciones).** `requireServiceRole` de `_shared/auth.ts`. El
  guard se extendió para aceptar el service role también en el header `apikey`, porque
  es como lo mandan los crons de Postgres desde la migración `20260821212354`.
- **Usuario autenticado o admin (8 funciones).** `requireUser` / `requireAdmin`. Las 3
  llamadas del front que mandaban la llave publicable ahora mandan la sesión.
- **Llamadores arreglados (12 sitios en 9 archivos).** Los edge que llamaban sin
  cabecera o con anon key ahora mandan el `SERVICE_ROLE_KEY`; los 4 del front mandan la
  sesión del admin.
- **Públicas de verdad (4 funciones).** No pueden exigir autenticación porque se llaman
  antes de que exista sesión. Se acotaron de otra forma:
  - `send-contact-email`: el destinatario es el buzón propio de ToursRed
    (`email_settings.contact_email`). **No es un relay**; su pendiente es M-1.
  - `send-password-reset`: el destinatario debe existir en `users` y el contenido es un
    código generado por la función. **No es un relay**; se le puso tope de 3 códigos por
    correo por hora, después de la respuesta genérica anti-enumeración para no filtrar
    qué correos existen.
  - `send-referral-signup-notification`: **sí era un relay** — `referrerEmail` y
    `referrerName` venían en el cuerpo. Ahora el destinatario sale de `referral_codes`
    → `users` a partir del código; si el código no existe, no se manda nada.
  - `send-inquiry-email`: **sí era un relay** — manda copia de confirmación a la
    dirección del cuerpo. Es un formulario público de landing y no se puede cerrar sin
    Turnstile (M-1); mientras tanto, tope de 3 cotizaciones por correo por hora.

**Tres bugs encontrados de paso, todos en `send-gift-card-email`.** Sí tenía guard,
pero:

1. Hacía `getUser(token)` con el token recibido, y los 5 webhooks de pago la llaman con
   el `SERVICE_ROLE_KEY`, que no tiene usuario detrás. **El correo de una tarjeta de
   regalo pagada nunca salía** — respondía 401. Corregido aceptando al llamador interno.
2. **El comprador invitado quedaba fuera.** Se puede comprar una tarjeta sin cuenta
   (`GiftCardsPage` solo exige sesión para el código de descuento), pero al volver a
   `/gift-card/success` el navegador manda la llave publicable, que no identifica a
   nadie: el reenvío contestaba 401 y el invitado no tenía forma de recuperar su código.
   Ahora se acepta al llamador anónimo con dos condiciones: la tarjeta debe estar
   **pagada** y respetar el enfriamiento del punto 3. No elige destinatario ni contenido
   —todo sale de la fila—, así que lo peor que puede hacer quien tenga el enlace es
   reenviarle el correo a su dueño legítimo. Es el mismo criterio que ya rige
   `get-gift-card-status`, que es pública y responde por `gift_card_id`.
3. **El límite de reenvíos no limitaba nada.** Decía "máx. 3 correos en 24 h" pero
   contaba filas de `gift_cards` con ese id y `email_sent_at` reciente: como mucho hay
   UNA fila, así que la condición `>= 3` nunca se cumplía. La tabla no lleva contador,
   sólo un timestamp, así que el límite real que se puede poner sin migración es un
   enfriamiento de 5 minutos entre envíos. No aplica al service role: los webhooks son
   el camino principal y nunca deben quedarse sin mandar el correo de una compra.

Del lado del front, `GiftCardSuccessPage` le mostraba al invitado **"Pago en proceso"
aunque el pago estuviera confirmado**, porque la política RLS de `gift_cards` es
`TO authenticated` y su `select` devolvía vacío. Ahora cae a `get-gift-card-status`
—pública y que a propósito **no** devuelve `code`— y muestra la compra confirmada, el
monto y el botón de reenvío. **El código sigue sin mostrarse en pantalla a quien no
tiene cuenta**: va por correo. Esa decisión ya estaba tomada en
`get-gift-card-status` y no se cambia aquí; si se quiere mostrar, es una decisión de
producto aparte, porque el `gift_card_id` viaja en la URL y el código es dinero.

De paso, ni `sendEmailBackup` ni `handleResendEmail` miraban el `error` que devuelve
`functions.invoke` (que **no lanza** en respuestas != 2xx): un 403 o un 429 se
mostraban como "El correo ha sido reenviado exitosamente".

### El lado de Postgres — APLICADO el 08-sep-2026

Tres funciones de Postgres llaman Edge Functions por `pg_net` y quedaban descolgadas del
guard. Se arreglaron con dos migraciones **ya aplicadas** (con autorización explícita):

| Migración | Qué hace |
|---|---|
| `20260908043951_notify_executive_by_email_usa_service_key.sql` | `notify_executive_by_email` mandaba la **publishable key**, que no autoriza nada. Ahora manda el `service_role_key` del Vault. |
| `20260908044815_pg_net_crons_mandan_authorization_ademas_de_apikey.sql` | `process_membership_renewal_reminders` y `process_expired_slot_reschedules` mandaban la credencial **sólo en `apikey`**. Ahora también en `Authorization`. |

**Lo que se comprobó antes de aplicarlas**, porque el guard compara contra
`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` y si el valor del Vault no coincidiera se
caerían los crons en silencio:

- `vault.decrypted_secrets['service_role_key']` es hoy una llave del **formato nuevo**
  (`sb_secret_…`, 41 chars), no el JWT legacy.
- Los crons `expire-supplement-approvals` y `process-incremental-payment-deadlines`
  mandan esa misma llave en `Authorization: Bearer` y sus funciones **ya tienen
  `requireServiceRole` desplegado**: 8 corridas cada uno, 19 respuestas 200 en
  `net._http_response`, **ningún 401**.

De ahí salen dos conclusiones. El valor del Vault **sí** coincide con el del edge
runtime. Y el comentario de la migración `20260821212354` —"el gateway rechaza el
formato nuevo en `Authorization: Bearer`"— **hoy no se cumple**.

Queda una sola suposición sin comprobar: si el gateway **reenvía** el header `apikey`
hasta la función. No se puede comprobar hasta desplegar el guard, y por eso las tres
funciones mandan ahora **las dos cabeceras**: si `apikey` no llega, `Authorization`
cubre.

La segunda migración no reescribe las funciones a mano: lee su definición viva con
`pg_get_functiondef`, inserta la cabecera con `regexp_replace` y la reejecuta, fallando
si el patrón no aparece. `process_expired_slot_reschedules` tiene 7,581 caracteres y
lógica de reembolsos; copiarla para cambiar dos líneas es como se introducen errores que
nadie nota. La verificación posterior fue por longitud: **+90 caracteres** en esa función
(2 × 45) y **+43** en la de membresías (1 × 43), que cuadra al carácter con las
inserciones y prueba que no se movió nada más.

---

## A-2. `generate-booking-qr-token` emite el token de check-in de cualquier reserva, sin autenticación

**Archivo:** `supabase/functions/generate-booking-qr-token/index.ts`

`verify_jwt = false`, service role, y el cuerpo entero de la lógica es:

```ts
const { booking_id } = await req.json();          // :31
if (!booking_id) return 400;                       // :33
// busca token existente → si existe, lo DEVUELVE                  :41-52
// si no existe, lee la reserva, CREA el token y lo devuelve       :54-88
```

No hay `auth.getUser()`. No hay verificación de dueño. Ninguna.

**Impacto, dimensionado con honestidad.** Aquí quiero ser preciso porque es fácil
sobrevender esto:

- **Lo que NO permite:** hacer check-in de una reserva ajena. Verifiqué
  `confirm-booking-checkin/index.ts:114-146` y está **bien hecho**: exige autenticación,
  y luego que el llamante sea dueño de la agencia, admin, o staff con permiso
  `can_scan_checkin`. El token solo no basta. Lo mismo aplica a
  `get-booking-checkin-details/index.ts:121-127`, que también valida.
- **Lo que SÍ permite:**
  1. **Escritura en la base sin autenticar.** Cualquiera inserta filas en
     `booking_checkin_tokens` para reservas ajenas, en volumen.
  2. **Oráculo de enumeración.** Devuelve 404 si el `booking_id` no existe y 200 si sí.
     Los IDs son UUID, así que no se pueden adivinar por fuerza bruta, pero cualquier
     `booking_id` que se filtre (URL, correo, captura de pantalla, staff de agencia)
     se confirma como válido.
  3. **Fuga del token.** Que hoy no alcance para el check-in depende enteramente de que
     los dos consumidores validen bien. Es un secreto operativo circulando de más, y
     cualquier consumidor futuro que confíe solo en el token hereda el agujero.

**Severidad: alta, no crítica.** Lo califico alto por la escritura sin autenticar y
porque la defensa depende de que *otros* dos endpoints sigan validando bien para siempre.

---

## A-3. ~~`capture-paypal-order` no ata la orden de PayPal a la reserva que se le pasa~~ — FALSO POSITIVO

> **Retirado el 07-sep-2026.** Este hallazgo es incorrecto y no cuenta en el total.
> Al ir a arreglarlo, las dos llamadas a `confirmBooking` en el contexto de reserva ya
> pasaban el `referenceId` que viene de la respuesta de PayPal
> (`purchase_units[0].reference_id`), **no el `bookingId` del cliente**. El `bookingId`
> del cuerpo nunca se usaba para confirmar: se destructuraba y se ignoraba, que es
> exactamente lo que lo hacía parecer un agujero al leerlo por encima.
>
> El error de método fue mío: vi el destructuring de la línea 31 y las llamadas a
> `confirmBooking`, y **asumí** que una alimentaba a la otra sin seguir la variable hasta
> su uso. Es el mismo sesgo que ya anoté abajo con `process-payment-refund`.
>
> Lo único que se hizo en `bed5563` fue limpieza: dejar de destructurar los campos que no
> se leen (`bookingId`, `giftCardId`, `slotId`) y anotar por qué, para que el próximo que
> lea el archivo no repita mi conclusión.
>
> **El texto original se conserva abajo sin editar, como registro de la equivocación.**
> Léelo sabiendo que su conclusión es falsa.


**Archivo:** `supabase/functions/capture-paypal-order/index.ts:31`

```ts
const { orderId, bookingId, context, giftCardId, slotId } = await req.json();
```

`orderId` y `bookingId` llegan **como dos campos independientes del cliente**. La función
captura la orden en PayPal (`:73`) y luego llama `confirmBooking(supabase, bookingId, ...)`
(`:103`) usando el `bookingId` que mandó el cliente, **sin comprobar que la orden
capturada pertenezca a esa reserva**.

El dato para comprobarlo existe y está a mano: `create-paypal-order/index.ts:243` graba
`reference_id: bookingId` en la orden. Y `capture-paypal-order` **sí lo lee** —pero solo
en los contextos de suplemento, servicio opcional y seguro (`:541`, `:636`, `:678`,
`:704`, `:728`). **En el contexto de reserva, que es el principal, no se compara nunca.**

**Impacto, acotado.** El daño está limitado por la validación de montos de
`:116-131`: si lo capturado no cubre `deposit_amount`, la reserva queda en `processing`.
Así que no permite confirmar una reserva cara con una orden barata. Lo que sí permite es
**dirigir el pago a una reserva distinta de aquella para la que se creó la orden**
(por ejemplo, aplicar un pago a la reserva de otra persona), y desalinea la
trazabilidad contable entre `payment_transactions` y la orden real de PayPal.

**El arreglo es una línea:** comparar `captureData.purchase_units[0].reference_id`
contra `bookingId` antes de confirmar, igual que ya se hace en los otros tres contextos.

---

# MEDIOS

## M-1. El Turnstile de `send-contact-email` es opcional, y su rate limit se salta solo

**Archivo:** `supabase/functions/send-contact-email/index.ts:52-83`

Dos problemas encadenados:

```ts
// Rate limit: max 3 submissions per email in 1 hour
const { count: recentSubmissions } = await supabase
  .from('contact_form_submissions')
  .select('id', { count: 'exact', head: true })
  .eq('email', email)          // ← 'email' viene del atacante
  .gte('created_at', oneHourAgo);
```

1. **El rate limit se aplica sobre el `email` que manda quien llama.** Cambiar una letra
   lo reinicia. La IP sí se registra (`:86`) pero **no se usa para limitar**, solo se
   guarda.

```ts
// Verify Turnstile token if provided
if (turnstile_token) {          // ← si no lo mandas, no se verifica nada
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (turnstileSecret) { ... }
}
```

2. **El captcha se omite simplemente no mandando el token.** Es un *fail-open*: la
   protección solo actúa contra quien decide someterse a ella, es decir, contra el
   navegador legítimo y contra nadie más.

**Relación con el backlog.** `claude.md` ya documenta un problema distinto con Turnstile
(el token de un solo uso que no se resetea, en los 6 consumidores del front). **Este es
otro, del lado del servidor**, y no está en el backlog. Vale la pena atenderlos juntos.

### Corregido el 08-sep-2026 — y estaba activo de verdad

Lo primero que comprobé antes de tocar nada:

```sql
select turnstile_auth_enabled from platform_settings;  -- true
```

**El captcha está encendido en producción.** O sea que el front sí lo exige y el
servidor no, que es literalmente el fail-open descrito. No era un riesgo para "cuando lo
activen".

#### Los dos problemas del hallazgo, y un tercero que apareció leyendo el código

**1. El captcha se saltaba no mandándolo.** `if (turnstile_token) { ... }` hacía que la
protección actuara sólo contra quien decidía someterse a ella. Ahora **la decisión la
toma el servidor**, leyendo la misma palanca que lee el front
(`platform_settings.turnstile_auth_enabled`, vía `useTurnstileEnabled`). La presencia del
token ya no decide nada.

Y si esa consulta falla, se **exige** el captcha. Lo contrario sería el mismo fail-open
con otro disfraz: bastaría con tumbar esa lectura.

**2. El rate limit se reiniciaba cambiando una letra del email.** Ahora limita por las
dos cosas: 3 por email y 10 por IP en una hora. El límite por IP es más holgado a
propósito — una oficina, una universidad o una red móvil comparten IP, y no se trata de
castigar a quien está detrás de un NAT. La IP ya se registraba en la tabla; simplemente
no se usaba.

**3. (No estaba en el hallazgo) El cuerpo de la petición a Cloudflare se armaba
concatenando cadenas:**

```ts
body: `secret=${turnstileSecret}&response=${turnstile_token}`,
```

El token viene del cliente. Un `&` dentro de él permitía inyectar parámetros en la
petición a Cloudflare. Se cambió a `URLSearchParams`, que escapa, y de paso se añade
`remoteip`, que Cloudflare recomienda.

#### Qué pasa si Cloudflare no responde

No se deja pasar. Mismo criterio que el helper de AAL2 tras M-2: si no se puede
verificar, se bloquea.

#### Lo que había que confirmar antes de desplegar — confirmado el 09-sep-2026

Si `turnstile_auth_enabled` está en `true` y **`TURNSTILE_SECRET_KEY` no está
configurado** en los secretos de Edge Functions, esta versión devuelve **503** y el
formulario de contacto deja de funcionar. Es el comportamiento correcto —la palanca está
encendida y no hay con qué verificar—, pero había que saberlo antes, no después.

No se puede leer un secreto de Edge Functions por API, pero **no hace falta el panel**: la
propia función lo delata. Llamada sin token, `send-contact-email` (v82, desplegada)
devuelve **403 `CAPTCHA_REQUERIDO`**. Si el secreto faltara devolvería **503
`CAPTCHA_NO_CONFIGURADO`**. O sea: el secreto está puesto y el fail-open está cerrado.

El mismo truco sirve para `STRIPE_WEBHOOK_SECRET` (C-2): el webhook responde **400** por
falta de firma; si el secreto no existiera, el código devuelve **500** antes de llegar a
mirar la firma. Vale más que una captura del panel, porque mide lo que corre.

La *site key* (`0x4AAAAAAEPafX7zzdCsVdYB`) está hardcodeada en `TurnstileWidget.tsx`, y
**eso está bien**: las site keys de Turnstile son públicas por diseño, viajan en el HTML.
No es un hallazgo.

#### Lo que NO cubría esto — cerrado aparte el 09-sep-2026 (PR #180)

`claude.md` documentaba un problema distinto y del lado del cliente: el token de un solo
uso que no se resetea, en los 6 consumidores del front (`LoginPage`, `SignupPage`,
`AgencySignupFormBody`, `ChangePasswordSection`, `MaintenanceAdminPage`, `ContactPage`).

**Axel lo reprodujo en producción el 09-sep**: con la contraseña equivocada al primer
intento, el segundo intento —ya con la contraseña correcta— era rechazado por el captcha.
Los tokens de Turnstile son de un solo uso, y Supabase los manda a `siteverify` **antes**
de mirar las credenciales; el intento fallido quemaba el token y el reintento reenviaba el
mismo. En el preview de #180 ya no pasa. El detalle está en la auditoría de frontend.

## M-2. `aal2Check` falla abierto: si no puede verificar el MFA, deja pasar

**Archivo:** `supabase/functions/_shared/aal2Check.ts:34-37,63-65`

```ts
const { data, error } = await supabase.rpc("requires_aal2_check");
if (error) {
  // If we can't determine, allow the request (fail-open for availability)
  return { allowed: true };
}
...
} catch {
  // Fail-open for availability
  return { allowed: true };
}
```

Está **documentado como decisión deliberada** ("fail-open for availability"), así que lo
reporto como observación, no como error: si la RPC falla o lanza, la acción sensible
procede sin MFA. El punto a discutir es que un atacante que logre provocar el error
—o una caída transitoria de la base— desactiva el segundo factor por completo.

Vale contrastarlo con `stepUpCheck.ts:32-36`, del mismo directorio, que ante el mismo
tipo de error **falla cerrado** (`return { verified: false }`). Dos helpers hermanos con
criterios opuestos: convendría que la diferencia sea una decisión consciente y escrita,
no una divergencia accidental.

### Corregido el 08-sep-2026 — y el hallazgo se quedó corto

Lo reporté como "observación, no error", porque el código lo documentaba como decisión
deliberada. **Eso fue demasiado generoso.** Al ir a corregirlo aparecieron cuatro cosas
que cambian la severidad, y ninguna se ve leyendo sólo este archivo:

**1. Los toggles de MFA están ENCENDIDOS en producción.** Consultado antes de tocar nada:

```sql
select mfa_required_for_admins, mfa_required_for_accountant from platform_settings;
-- mfa_required_for_admins = true, mfa_required_for_accountant = true
```

O sea que el camino feliz sí exige MFA hoy. La rama de error no era un riesgo latente
para "el día que se active": era un **bypass vivo**.

**2. Son 12 funciones, y son las que mueven dinero.** El hallazgo no las enumeraba:
`process-agency-payout`, `admin-credit-wallet-topup`, `admin-cancel-booking`,
`admin-finalize-cancellation`, `create-admin-user`, `create-executive-user`,
`delete-auth-user`, `generate-manual-cfdi`, `generate-accounting-entries`,
`approve-agency-documents`, `reject-agency-permanently`, `reverse-agency-rejection`.

**3. La capa de RLS ya fallaba cerrada; ésta era la única que dejaba pasar.** Las
políticas de `20260818031526` usan `(NOT requires_aal2_check() OR has_aal2())`: si esa
función lanza, la sentencia aborta. Pero **las funciones de pago no pasan por RLS** —
llaman a `process_agency_payout_atomic` y compañía con el cliente de service role, que
la salta. Para ese camino, el helper de Edge era la única puerta.

**4. La incoherencia ya estaba dentro del propio archivo.** El error de `has_aal2()`
(segunda RPC) *siempre* falló cerrado; sólo el de `requires_aal2_check()` (primera RPC)
fallaba abierto. Dos ramas hermanas con criterios opuestos a diez líneas de distancia se
lee como descuido, no como decisión de disponibilidad.

#### El arreglo

Las tres ramas de error devuelven ahora `{ allowed: false }`, con `console.error` para
que dejen rastro en los logs —antes eran mudas, que es justo lo que las hacía útiles a un
atacante— y con un código nuevo, `MFA_CHECK_FAILED`, servido con **HTTP 503** en vez de
403: decirle *"necesitas MFA"* a un admin que sí lo tiene activado manda a soporte por el
camino equivocado. `MFA_REQUIRED` y su 403 no cambian.

#### El costo de disponibilidad, medido

Era el argumento del `fail-open`, así que se midió en vez de suponerlo. En producción hay
dos cuentas admin:

| Cuenta | MFA | Último acceso |
|---|---|---|
| `admin@toursred.com` | verificado | 03-sep-2026 |
| `contacto@toursred.com` | **sin MFA** | 27-jun-2026 |

La cuenta sin MFA **ya está bloqueada hoy** por el camino normal (toggle encendido y sin
AAL2), así que este cambio no le quita nada. Y si la base está tan mal que esta RPC falla,
la RPC que de verdad mueve el dinero tampoco va a completarse: cerrar no cuesta ninguna
operación que de otro modo hubiera funcionado.

#### Verificación

Se compiló el helper real a JS y se ejecutaron los siete escenarios. Los tres normales se
comportan igual que antes; los tres de fallo cambiaron de `PASA (sin MFA)` a `BLOQUEA`,
contrastados ejecutando **el archivo anterior y el nuevo lado a lado**. `eslint`: 38
problemas antes y 38 después en los 13 archivos tocados, cero agregados.

## M-3. `openpay-webhook` no verifica firma (mitigado, pero conviene saberlo)

**Archivo:** `supabase/functions/openpay-webhook/index.ts`

No hay verificación de firma ni de origen. **Está razonablemente mitigado** y lo hace a
propósito: en vez de confiar en el payload, **re-consulta el cargo contra la API de
OpenPay** (`:170-181`, vía `getCharge` / `getChargeMerchant`), valida que el estado sea
`completed`/`success` (`:196`), y toma los montos de la respuesta de la API, no del
webhook (`:208-215`). Además tiene control de idempotencia real (`:225-245`). El comentario
del código lo explica bien.

Es un patrón defendible —verificación por consulta en vez de por firma—. Lo dejo en
medios por dos razones: (a) el atacante puede **forzar consultas arbitrarias a la API de
OpenPay** enviando webhooks falsos, y escribir libremente en la tabla de log
`openpay_webhook_events`; (b) depende de que *todos* los caminos futuros re-consulten,
sin nada que lo imponga. Si OpenPay ofrece firma, agregarla es defensa en profundidad barata.

### Cerrado el 08-sep-2026 — OpenPay no ofrece con qué firmar

Se revisó el panel de OpenPay donde está dado de alta el webhook. La pantalla de
configuración tiene **sólo URL, identificador y eventos asociados**: no hay campos de
usuario y contraseña, ni secreto de firma, ni nada equivalente al `whsec_` de Stripe.

El `verification_code` que la función ya maneja (`:76`) **no es una firma por petición**:
es el código de un solo uso del alta del webhook, que OpenPay manda una vez para
verificar que la URL es tuya.

Conclusión: **no hay un mecanismo de autenticación de webhooks que activar.** Lo que el
hallazgo pedía —"si OpenPay ofrece firma, agregarla es defensa en profundidad barata"—
resulta que no existe.

Eso convierte la mitigación que ya está escrita en la defensa correcta, no en un parche:
la función **re-consulta el cargo contra la API de OpenPay** (`:170-181`) en vez de creerle
al payload, valida el estado (`:196`), toma los importes de la respuesta de la API
(`:208-215`) y tiene control de idempotencia (`:225-245`). Un webhook falsificado no
puede inventar un cobro que la API de OpenPay no confirme.

#### Los dos endurecimientos que sí quedan disponibles

Ninguno es urgente, y los dos requieren tocar el panel de OpenPay, no el código:

| Opción | Qué cierra |
|---|---|
| **Secreto en la URL** — registrar el webhook como `.../openpay-webhook?k=<secreto-largo>` y rechazar lo que no lo traiga | El ruido de terceros que descubran el endpoint, y la escritura libre en `openpay_webhook_events` |
| **Rechazar el ambiente equivocado** — el payload trae `payment_method.url` apuntando a `sandbox-api.openpay.mx` o al de producción | Que un cobro de pruebas confirme una reserva real |

#### Para la lista de lanzamiento (21-sep-2026)

Al revisar esto se midió el tráfico real: **55 webhooks recibidos**, y **41 traen
`sandbox`** en el payload. Eso es normal y esperado — hoy no existe ambiente productivo,
éste es el único que hay.

Pero el día que se conecte OpenPay productivo, si se sigue con un solo proyecto de
Supabase, la segunda opción de la tabla deja de ser opcional: se comprobó que un cobro de
prueba con la tarjeta de test de Amex (`345678XXXXX0007`) llegó a **confirmar una reserva,
registrar $5,206.84 como cobrado, crear una fila de comisión y timbrar CFDIs**. En pruebas
eso es exactamente lo que debe pasar; en producción, con un webhook de sandbox llegando
al mismo proyecto, no.

Los datos de prueba que quedan en la base —reservas confirmadas, `payment_transactions`,
comisiones y CFDIs de tarjetas de test— van a ensuciar los primeros reportes reales si no
se limpian o marcan antes de abrir.

## M-4. Dos crons son disparables por cualquiera

**Archivos:** `expire-supplement-approvals/index.ts`,
`process-incremental-payment-deadlines/index.ts`

Ambos con `verify_jwt = false` y sin ningún guard.

- `expire-supplement-approvals` ejecuta la RPC `expire_supplement_approvals()` a
  demanda de quien sea. Impacto acotado (la RPC decide qué vence por fecha), pero es
  ejecución arbitraria de lógica de negocio.
- `process-incremental-payment-deadlines` recorre reservas con pago incompleto y
  **manda recordatorios**. Dispararlo repetidamente puede bombardear a clientes reales
  con correos de cobranza. Aquí el daño es reputacional y directo al cliente final.

De nuevo, el guard correcto ya está escrito en
`process-payment-plan-tour-deadline/index.ts:81-91`, que valida el bearer contra el
service role y hasta documenta cómo probarlo desde SQL. Es copiar seis líneas.

## M-5. CORS `*` en 171 de 171 funciones, sin una sola allowlist

Verificado: las 171 funciones usan `"Access-Control-Allow-Origin": "*"`, y **cero**
implementan validación de origen.

Con `*` el navegador no manda cookies, así que **no es un CSRF clásico** y por sí solo
no es explotable. Lo reporto por dos motivos: (a) cualquier página web puede invocar
directamente los endpoints abiertos de A-1 y A-4 desde el navegador de la víctima; (b) es
el punto donde una allowlist de orígenes daría defensa en profundidad barata y uniforme.

Como es un valor idéntico copiado 171 veces, es también el ejemplo más claro del
problema estructural: **no hay un módulo compartido de CORS**, igual que no hay uno de auth.

### M-5, corregido el 08-sep-2026 — el hallazgo apuntaba al síntoma barato y se le escapó el caro

El hallazgo tiene razón en el hecho y se queda corto en la consecuencia. Al ir a
implementar la allowlist salió una cosa que no estaba reportada y que sí es explotable.

**Lo que el hallazgo dice, y por qué vale poco.** Cambiar la cabecera
`Access-Control-Allow-Origin` de `*` a una lista es defensa en profundidad honesta, pero
casi no cierra nada: con `*` el navegador no manda cookies, y el JWT de Supabase vive en
`localStorage`, que un origen ajeno no puede leer. Una web maliciosa sólo consigue hacer
peticiones **sin autenticar**, que es exactamente lo que ya puede hacer desde cualquier
servidor sin pasar por el navegador de nadie. El agujero real de A-1/A-4 era la falta de
guard, y eso ya se cerró.

**Lo que no dice, y sí es un agujero.** Nueve funciones armaban las URLs de retorno del
pago con el header `Origin`:

```ts
success_url: `${req.headers.get("origin")}/booking-success?booking_id=${bookingId}`,
```

`Origin` lo pone quien llama. Con `curl -H "Origin: https://falso.com"` se crea una sesión
de Stripe/PayPal/Conekta/Openpay cuya pantalla de "gracias por tu compra" vive en el
dominio del atacante. **El cobro es real y la confirmación es falsa.** Es un redirect
abierto metido dentro del flujo de pago.

Cinco de esas nueve tenían además un fallback a `Referer`, que es peor: mismo control del
atacante, y recortado con `.split("/").slice(0, 3)`, que no valida absolutamente nada.

Y `create-checkout-session` aceptaba `success_url` y `cancel_url` **directamente del
cuerpo de la petición**, sin mirarlos siquiera.

#### El arreglo

`_shared/cors.ts` — el módulo compartido que el hallazgo pedía, pero sirviendo a los dos
usos:

| | |
|---|---|
| `origenPermitido(origen)` | devuelve el origen si está en la lista, si no `null` |
| `corsHeaders(req)` | eco del origen permitido + `Vary: Origin` |
| `origenParaRedirigir(req)` | **nunca devuelve un valor del atacante**: o uno de la lista, o `https://toursred.com` |
| `urlDeRetornoSegura(url)` | valida una URL que vino en el cuerpo; `null` si no cuelga de un origen permitido |

Dos detalles que no son adorno:

- **`Vary: Origin` es obligatorio** con una allowlist de eco. Sin él, cualquier caché
  intermedia puede servirle a un origen la respuesta generada para otro, y la lista deja
  de servir para nada.

- **La comparación se hace sobre `new URL(x).origin`, no con `startsWith`.**
  `https://toursred.com.evil.io` empieza igual que el dominio bueno.

**Orígenes permitidos** (los definió Axel el 08-sep-2026):
`toursred.com`, `toursred.com.mx`, `toursredmx.netlify.app`. Se añadieron además las
variantes `www.` de los dos dominios propios y el patrón de previews de Netlify
(`deploy-preview-N--toursredmx.netlify.app`, sólo de este proyecto), porque sin ellos se
rompen la www y el flujo de revisar un PR contra el backend real. Quitar cualquiera de los
dos grupos son unas líneas en `_shared/cors.ts`.

#### Lo que se cambió y lo que no

Se cambiaron las **9 funciones que arman URLs de retorno de pago**:
`create-checkout-session`, `create-paypal-order`, `create-conekta-order`,
`purchase-gift-card`, `create-membership-subscription`, `purchase-post-booking-extras`,
`process-supplement-payment`, `process-payment-plan-installment`,
`test-openpay-3ds-charge`.

**No se tocó la cabecera CORS de las 171 funciones**, y es una decisión, no un olvido: el
valor de seguridad es casi nulo (arriba), mientras que una allowlist equivocada en la
cabecera **rompe funcionalidad de golpe** —la función responde y el navegador tira la
respuesta—. Equivocarse en la lista de redirección, en cambio, sólo manda al viajero al
dominio principal. Redesplegar 106 funciones llamadas desde navegador a dos semanas de las
UAT, por una defensa en profundidad, es mala relación riesgo/beneficio. Queda para después
de las UAT, con la lista ya confirmada contra la realidad.

#### La guardia

`scripts/check-origin-header.mjs`, dentro del job `lint` (que ya es check requerido, así
que no se agrega un check nuevo que pueda quedarse en *Waiting for status*). Bloquea
cualquier lectura cruda de `Origin`/`Referer` en `supabase/functions/`. **Nace en 0**
—medido sobre 181 archivos—, así que bloquea de verdad; no es un contador como el de F-1.
Escape explícito: marcar la línea con `origen-crudo-ok`.

La guardia se ganó el sueldo el mismo día que se escribió: encontró
`test-openpay-3ds-charge`, que se le escapó al grep manual porque escribía `Origin` y
`Referer` con mayúscula. Eran 9, no 8.

## M-6. Errores tragados en silencio en el camino fiscal y de pagos

Al menos 15 funciones tienen `catch` vacíos o `.catch(() => {})`, concentrados
precisamente donde peor duele: `generate-booking-cfdi`, `generate-membership-cfdi`,
`generate-commission-cfdi`, `generate-supplement-cfdi`,
`generate-credit-note-for-item-cancellation`, `process-supplement-payment`,
`purchase-post-booking-extras`, `create-conekta-order`, entre otras.

Es **exactamente la misma categoría** que `claude.md` ya documenta para
`snapshot_booking_tax`: el error se pierde, el flujo continúa, y el problema se descubre
después —cuando ya se cobró o ya se timbró—. La observación que hace el backlog aplica
igual aquí: la pregunta no es "fallar o no fallar", sino **qué se hace visible en el
momento**.

### M-6, corregido el 08-sep-2026 — el hallazgo se quedó corto por partida doble

**1. Seis de los sitios que conté estaban bien.** Son `try { JSON.parse(errorBody) } catch {}`
alrededor del cuerpo de error de una API de pagos, y en todos el error ya fue a
`console.error` y hay un mensaje de respaldo. Que el parseo falle sólo significa "usa el
mensaje genérico". Ahí tragar es lo correcto y se dejaron intactos:
`create-conekta-order`, `create-conekta-tokenization-checkout`, `process-supplement-payment`,
`purchase-post-booking-extras`, `process-payment-plan-installment`, `capture-paypal-order`.

**2. En los otros 20, el `catch` ni siquiera era el problema.** Y esto es peor que lo que
describí:

```ts
EdgeRuntime.waitUntil(
  supabase.functions.invoke("send-cfdi-email", { ... }).catch(() => {})
);
```

**Ni `fetch()` ni `functions.invoke()` rechazan la promesa cuando la respuesta es 4xx o
5xx.** `fetch` sólo rechaza si falla la red; `invoke` resuelve con `{ data, error }` y
nunca lanza.

O sea que ese `.catch(() => {})` no estaba tragando el error: **el error nunca llegaba
ahí**. Si `send-cfdi-email` devolvía 500 —el viajero no recibió su CFDI—, la promesa se
resolvía correctamente y nadie miraba el resultado. El `catch` era decorativo y el camino
de fallo que importa no se comprobaba en absoluto.

Es la misma trampa que ya mordió a este repo en `c968c1d`, donde `.rpc().catch()`
reventaba los 5 webhooks de pago porque `PostgrestFilterBuilder` es *thenable* pero no es
una `Promise`. Tercera vez que aparece la misma familia de error.

#### El arreglo

`_shared/falloSilencioso.ts`, con tres funciones que **no lanzan nunca** (se usan dentro
de `EdgeRuntime.waitUntil`, donde una excepción no la recoge nadie):

| | |
|---|---|
| `vigilarRespuesta(res, ctx)` | mira `res.ok` — lo que faltaba tras un `fetch` |
| `vigilarResultado(r, ctx)` | mira `r.error` — lo que faltaba tras un `invoke` |
| `registrarFallo(ctx, e)` | `console.error` + una fila en `public.audit_errors` |

Se diseñó para **encadenar y no para envolver**, de modo que aplicarlo a los 20 sitios
fuera un cambio de una línea en cada uno y no una reestructuración de 20 bloques.

El rastro en `audit_errors` es el mismo criterio que se aplicó del lado de SQL en M-4:
no se trata de fallar o no fallar, sino de que el fallo se haga visible en el momento. Y
`registrarFallo` escribe vía REST con su propio `try/catch`, así que dejar el rastro nunca
puede romper el flujo que se intentaba salvar.

#### Alcance y verificación

20 sitios en 15 funciones. `eslint`: **78 problemas antes y 78 después** en los archivos
tocados, cero agregados —hubo que corregir dos cosas para llegar ahí: importar en cada
función sólo los helpers que usa, y tipar los parámetros de los lambdas, que si no
entraban como `implicit any`.

**Al mergear hay que desplegar las 15 funciones**, más `send-contact-email` por M-1.

> **Desplegadas.** Verificado el 09-sep-2026 contra la lista de versiones de Supabase: de
> las 126 funciones que tocó la remediación, **ninguna quedó por detrás de su último
> cambio**. Ojo al comparar fechas a mano: `f190ce9` es un *squash* cuyo asunto dice "Merge
> pull request #40", y por ahí entraron al repo muchos de estos archivos, así que un
> `git log -1` sobre ellos da una fecha engañosa y produce falsos "sin desplegar".

---

# Lo que está bien hecho

Vale documentarlo, porque son los patrones a replicar y ya están escritos en este repo:

- **`_shared/cfdiAuth.ts`** — el mejor código de seguridad del proyecto. Centraliza la
  autorización de timbrado, distingue service role / admin / dueño, y **documenta el
  modelo de amenazas por escrito**, incluido el punto de que la llave publicable pasa
  `verify_jwt`. Es el molde de lo que le falta al resto.
- **`paypal-webhook`** — verifica firma contra la API de PayPal y **falla cerrado** si
  `PAYPAL_WEBHOOK_ID` no está configurado, con el razonamiento escrito en el código.
- **`conekta-webhook`** — verificación de firma RSA (RSASSA-PKCS1-v1_5 / SHA-256)
  implementada a mano y correctamente contra el cuerpo crudo.
- **`process-payment-refund`** y **`process-payment-plan-tour-deadline`** — exigen service
  role explícitamente. El segundo incluso documenta cómo reproducir la llamada del cron
  desde SQL para probarlo.
- **`create-paypal-order`** — deriva los montos del servidor. Es justo lo que le falta a
  `create-checkout-session`.
- **`confirm-booking-checkin`** — autorización granular bien hecha: dueño de agencia,
  admin, o staff con el permiso específico `can_scan_checkin`; más bloqueo por disputa
  de pago abierta.
- **Cero secretos hardcodeados** en 171 funciones y ~69,600 líneas. Todo por
  `Deno.env.get()` o por tablas de configuración. Esto no es lo normal y habla bien de la disciplina del equipo.
- **Idempotencia pensada** en OpenPay (`:225-245`) y en las RPC de wallet/puntos
  (`p_idempotency_key`).

---

# Priorización sugerida

El orden es por riesgo sobre el lanzamiento del 21 de septiembre, no por dificultad.

| # | Hallazgo | Severidad | Esfuerzo estimado |
|---|---|---|---|
| 1 | **C-2** — verificar que `STRIPE_WEBHOOK_SECRET` esté en los 3 ambientes | Crítico | ✅ resuelto: hoy hay un solo ambiente y la variable existe |
| 2 | **C-1** — que el servidor fije el precio | Crítico | ✅ `a90237d` (checkout) + `edc5016` (el webhook ya no confirma sin mirar cuánto entró) |
| 3 | **C-2** — hacer que el webhook de Stripe falle cerrado, como el de PayPal | Crítico | ✅ `bed5563` |
| 4 | **A-1** — inventariar las ~44 `send-*` y cerrarlas con el guard de service role | Alto | **hecho 08-sep-2026** — el inventario era, en efecto, el trabajo |
| 5 | ~~**A-3**~~ | ~~Alto~~ | ❌ falso positivo, retirado |
| 6 | **A-2** — exigir dueño/agencia/admin en `generate-booking-qr-token` | Alto | ✅ `bed5563` |
| 7 | **M-1** — Turnstile obligatorio y rate limit por IP en el formulario de contacto | Medio | ✅ corregido y **desplegado** (v82); `TURNSTILE_SECRET_KEY` confirmado por el 403 de la propia función |
| 8 | **M-4** — guard de service role en los dos crons abiertos | Medio | ✅ `bed5563` |
| 9 | **M-2** — el helper de AAL2 falla cerrado | Medio | **hecho** (08-sep-2026) |
| 10 | **M-3, M-5, M-6** — decisiones de arquitectura, no parches sueltos | Medio | **cerrados** — M-3 como decisión (OpenPay no ofrece firma), M-5 y M-6 con módulo compartido y guardia en CI |

**El punto 1 va primero por relación costo/beneficio:** es una consulta al dashboard, no
un cambio de código, y descarta (o confirma) el peor escenario de todos.

---

# La conclusión de fondo

Los hallazgos individuales son sintomáticos de **una sola causa raíz: no existe un guard
de autorización compartido, así que cada función reimplementa —o se olvida de— su propio
control de acceso.**

La evidencia de que es un problema estructural y no una serie de descuidos:

- La lógica correcta **ya está escrita en este repo**, varias veces, por gente que
  entendió bien el problema (`cfdiAuth.ts`, `paypal-webhook`, `create-paypal-order`,
  `process-payment-plan-tour-deadline`).
- Los agujeros están **justo donde nadie replicó esa lógica**.
- El mismo par de decisiones opuestas aparece dos veces: PayPal falla cerrado / Stripe
  falla abierto; `stepUpCheck` falla cerrado / `aal2Check` falla abierto.

Parchar los 10 hallazgos uno por uno deja el mecanismo intacto: la función número 172 va
a nacer con el mismo problema. Es el mismo tipo de conclusión a la que ya se llegó con el
desfase de migraciones —"distingue detectar de prevenir"—: aquí también hay que decidir
si se corrigen los síntomas o se cierra la llave.

Lo que cerraría la llave, en orden de rendimiento:

1. **Un `_shared/auth.ts`** con `requireServiceRole()`, `requireUser()`,
   `requireAdmin()`, `requireOwnerOrAdmin()`, siguiendo el molde de `cfdiAuth.ts`.
   Que llamar al guard sea más fácil que escribirlo a mano.
   → **Hecho en `98fee3f`.** Adoptado solo en los dos crons de M-4, a propósito: son el
   caso más simple y sus guards se escribieron en `bed5563`, así que se sabe exactamente
   qué deben hacer. **No** se tocaron los guards recién verificados de
   `generate-booking-qr-token` ni `create-checkout-session` — sustituir un guard que hoy
   funciona por uno nuevo sin volver a comprobar sus llamadores es justo como se rompen
   los caminos de pago. El resto se adopta función por función.
2. **Un `_shared/cors.ts`**, para que el header no se copie 171 veces. → **Hecho el 08-sep-2026**
   con M-5, aunque sirviendo sobre todo al otro uso: validar el origen con el que se arman
   las URLs de retorno de pago.
3. **Un check en CI** que falle si una función nueva no invoca ningún guard. El repo ya
   tiene el precedente exacto y funcionando: `scripts/check-edge-types.mjs` con línea
   base, que falla solo ante errores *nuevos*. La misma técnica sirve aquí: línea base de
   las ~81 funciones abiertas de hoy, y que no crezca. → **Hecho el 09-sep-2026** en
   `scripts/check-edge-guards.mjs` + `scripts/edge-guards-linea-base.json`, dentro del
   job `lint`.

Ese tercer punto es el que convierte esta auditoría en algo que no hay que repetir en seis
meses. Los puntos 1 y 2 bajan el costo de ponerse el guard; solo el 3 impide que la
función 172 nazca sin él.

### La guardia del punto 3, y lo que encontró al nacer (09-sep-2026)

**El número de "~81 funciones abiertas" de este documento no se sostuvo al medirlo.**
Salía de contar funciones sin `verify_jwt` o sin helper compartido; medido contra el
código, **158 de las 171 toman alguna decisión de autorización** y solo 13 no. La
diferencia es que en este repo el guard está escrito de tres formas distintas y todas
valen: los helpers de `_shared/auth.ts`, la comparación del bearer a mano
(`notify-ops-refund-failed`, `process-payment-refund`,
`process-payment-plan-tour-deadline`, `facturapi-webhook`), y controles que no son de
sesión pero sí de autorización — la firma del webhook, el captcha de Turnstile, o la
re-consulta del cargo contra la API de OpenPay, que fue la decisión de M-3.

**Lo que la guardia NO comprueba, y conviene que esté escrito:** que el guard sea
*correcto*. Detecta que la función mira quién llama, no que decida bien. Un
`auth.getUser()` cuyo resultado se ignora cuenta como guard aquí. Es un piso, no un techo.

**La línea base lleva un motivo por entrada, y no es cosmético.** Nueve de las trece son
públicas a propósito (recuperación de contraseña, alta y baja del boletín, validación de
código de referido, consulta de gift card, `check-login-risk`, y
`send-referral-signup-notification`, que sí valida el código, escapa el HTML y saca el
destinatario de la base). Una lista pelada las mezclaría con las otras cuatro, que son
huecos de verdad y que la guardia imprime en voz alta en cada corrida:

| función | `verify_jwt` | qué permite hoy |
|---|---|---|
| `generate-credit-note-for-item-cancellation` | `true` | cualquier usuario logueado emite una nota de crédito |
| `substitute-cfdi-for-partial-cancellation` | `true` | cualquier usuario logueado sustituye un CFDI |
| `sync-booking-to-accounting` | `false` | **cualquiera**, sin sesión, escribe asientos contables |
| `send-inquiry-email` | `false` | manda correo a una dirección tomada del cuerpo; es la categoría de A-1, con rate limit pero sin Turnstile |

Las dos primeras son las más limpias de cerrar: sus únicos llamadores reales
(`cancel-optional-service`, `cancel-individual-supplement`, `process-partial-cancellation`)
las invocan con service role, así que un `requireServiceRole` no rompe a nadie.
`sync-booking-to-accounting` no admite ese arreglo directo: además de cuatro webhooks la
llama `AdminContabilidad` desde el navegador con JWT de usuario, así que tiene que aceptar
service role **o** admin.

**Estos cuatro no estaban en la auditoría original.** Aparecieron al construir la línea
base, que es exactamente para lo que sirve el punto 3.

---

## Verificación y límites de esta auditoría

**Verificado leyendo el código:** los hallazgos citan archivo y línea, y todas las
citas se leyeron directamente del árbol en la rama auditada.

**Lo que NO pude verificar desde el repo, y por lo tanto no afirmo:**

- Si `STRIPE_WEBHOOK_SECRET` está configurada en cada ambiente (C-2). Vive en el
  dashboard de Supabase.
- Si alguna política RLS o trigger frena C-1 aguas abajo. Los webhooks usan service role,
  que salta RLS, así que lo dudo — pero no lo comprobé.
- Cuáles de las ~44 funciones `send-*` se llaman también desde el frontend con sesión de
  usuario. Ese inventario hay que hacerlo antes de cerrarlas.
- **Nada se probó en ejecución.** Toda la auditoría es lectura estática. C-1 y C-2 tienen
  arriba un procedimiento concreto para confirmarlos en staging.

> **Al 09-sep-2026, tres de estos cuatro ya no aplican:**
>
> - `STRIPE_WEBHOOK_SECRET` **sí está configurada**, y no hizo falta el dashboard: el
>   webhook responde **400** por falta de firma, y si el secreto no existiera el código
>   devolvería **500** antes de llegar a mirarla. Lo mismo con `TURNSTILE_SECRET_KEY`, vía
>   el 403 de `send-contact-email` (ver M-1).
> - El inventario de las `send-*` **está hecho** — era, en efecto, el trabajo (ver A-1), y
>   `scripts/check-edge-guards.mjs` lo mantiene: hoy reporta **0 huecos**.
> - Ya no todo es lectura estática: la segunda mitad de C-1 se midió contra las 26 reservas
>   confirmadas reales y tiene suite (`scripts/test-cobertura-pago.mjs`), y el token
>   quemado de Turnstile se reprodujo en producción antes de arreglarlo.
>
> **Sigue sin comprobarse** si alguna política RLS o algún trigger en `bookings` frena C-1
> aguas abajo.

**Correcciones de hipótesis propias.** Van dos, y las dos son del mismo tipo.

*La segunda, del 07-sep-2026:* **A-3 era falso positivo** (ver su sección). Lo reporté
como "alto" por leer el destructuring del cuerpo y las llamadas a `confirmBooking` sin
seguir la variable hasta su uso real. Refuerza justo lo que digo abajo: una lectura
parcial produce hallazgos falsos con la misma facilidad con la que un grep produce falsos
negativos. **Un hallazgo no está confirmado hasta que se sigue el dato de punta a punta.**

*La primera, del barrido original:* durante el barrido marqué inicialmente
`process-payment-refund`, `admin-send-broadcast-message` y `process-agency-payout` como
"sin autorización". Al leerlas resultó falso: `process-payment-refund` exige service role
en `:27-36`. Mi grep buscaba `role === 'admin'` y no reconocía la comparación contra el
bearer. Lo anoto porque el mismo sesgo puede afectar a otras funciones que di por buenas:
**una ausencia en un barrido automático no es evidencia de un agujero hasta que se lee el
archivo.**

---

# Hallazgos surgidos durante la remediación (07-sep-2026)

Cosas que **no** estaban en la auditoría del 05-sep y aparecieron al arreglar lo anterior.
Se documentan aquí porque el mecanismo por el que salieron a la luz es más instructivo que
los bugs en sí.

## R-1. Las membresías no se activaban ni se renovaban — CORREGIDO en `331a438`

**Archivo:** `supabase/functions/stripe-webhook/index.ts`, handlers de
`invoice.payment_succeeded` e `invoice.payment_failed`.

```ts
const subscriptionId = invoice.subscription;   // undefined, siempre
if (!subscriptionId) { console.log('sin suscripción, omitiendo'); break; }
```

Stripe **eliminó `Invoice.subscription` en la versión Basil (31-mar-2025)** y lo movió a
`parent.subscription_details.subscription`. Esta función declara
`apiVersion: "2026-06-24.dahlia"`, muchas versiones después, y Axel confirmó que **la
versión de API en Stripe es esa misma**. Así que el campo llegaba `undefined` y los dos
handlers se salían por su guard en cada evento.

**Efecto:** altas de membresía sin activar, renovaciones sin registrar, CFDI de membresía
sin timbrar, y la cobranza por pago fallido (dunning) que nunca corría.

**Lo que lo hacía invisible:** no dejaba error. Solo un `console.log` que dice
"omitiendo", que parece comportamiento normal.

**Arreglo:** `resolveInvoiceSubscriptionId()` lee la ubicación nueva y cae a la legacy —
las dos, porque el cuerpo del webhook se serializa con la versión configurada en el
endpoint, que no tiene por qué coincidir con la del SDK.

**Pendiente operativo, no de código:** revisar en Stripe qué invoices de suscripción se
cobraron mientras esto estuvo roto, y reconciliar contra las membresías de la base.

## R-2. Un `any` estaba apagando el type-check de todo el webhook de Stripe

Esta es la parte que vale la pena recordar. El código de C-2 era:

```ts
let event;                          // sin anotación de tipo
if (!endpointSecret) {
  event = JSON.parse(body);         // ← `any`
} else { ... constructEventAsync ... }
```

Esa asignación era **lo único** que le daba tipo `any` a `event`, y con `any` TypeScript
**dejaba de revisar las ~40 ramas del `switch`**. Al cerrar el hueco de seguridad la
línea desapareció, `event` pasó a ser `Stripe.Event` de verdad, y `deno check` destapó
6 errores latentes —entre ellos R-1 y R-3.

**El agujero de seguridad estaba, además, tapándole los ojos al compilador sobre el
archivo de pagos más crítico del repo.** Vale como argumento a favor de erradicar `any`
en los caminos de dinero, con más fuerza que cualquier regla de lint.

## R-3. `case 'oxxo_payment.expired'` era código muerto — RETIRADO en `331a438`

Stripe **no emite ese evento en ninguna versión de la API** (no está en la unión de 259
tipos de evento). El handler nunca corrió. Lo que Stripe sí manda cuando vence un voucher
OXXO es `payment_intent.payment_failed`, que ya se atiende en el mismo archivo y hace
estrictamente más: cancela la reserva, marca `stripe_orders` y además devuelve puntos y
ToursRed Cash. Borrarlo no perdió comportamiento.

## R-4. `check-edge-types.mjs` da falso verde si `deno` no puede bajar dependencias — CORREGIDO en `e8a2868`

**Archivo:** `scripts/check-edge-types.mjs`

Detectado al intentar correrlo en un entorno donde `jsr.io` estaba bloqueado. `deno check`
falló por no poder resolver el import, imprimió su error, y el script reportó:

```
Bloques de error ahora : 0   (deno reporta 0)
Sin errores nuevos en supabase/functions/.
```

…y salió con código **0**. El guard solo reconoce el string `error: Type checking failed`;
cualquier otro modo de fallo (red, 403 de un registry, registry caído) pasa por "limpio".

**Por qué importa:** es el mismo tipo de problema que el guard fue creado para prevenir —
un check que parece proteger y no protege. Un corte de red en CI convertiría `tipos-edge`,
que es un check **requerido**, en un sello de goma.

**Corregido en `e8a2868`.** La evidencia de que el chequeo corrió es ahora el código de
salida de `deno`, no un string en su salida: `0` = corrió limpio; `!= 0` exige además ver
errores de tipos reales, y si no los hay se sale con 2. También se cortan la muerte por
señal y el caso inconsistente (código 0 con errores reportados). Verificado con un `deno`
falso en los cuatro caminos: limpio → 0, error nuevo → 1, fallo de infra → 2,
inconsistente → 2.

## R-5. `lint` no es un check requerido — PARCIALMENTE CORREGIDO en `e8a2868`

`eslint` corre sobre `**/*.{ts,tsx}` —incluye `supabase/functions/`— pero **no está en la
lista de checks requeridos** del branch protection (que son `typecheck`,
`netlify/toursredmx/deploy-preview`, `guardia-desfase`, `guardia-fiscal` y `tipos-edge`).

`stripe-webhook/index.ts` acumula 30 errores de lint y `create-checkout-session/index.ts`
otros 15, sin que nada los frene. Es exactamente el hueco que describe F-4.

**Corregido a medias en `e8a2868`, y la mitad que falta no es de código.** `lint` ahora
**puede** salir rojo: `summarize-lint.mjs --strict` sale con 1 si los errores o warnings
suben sobre la línea base, y con 2 si el reporte no es utilizable. De paso se cerró el
mismo falso verde de R-4 en el camino de "ESLint reventó", que salía con `exit 0`.

No se exige cero: bloquear con ~2,400 errores heredados haría imposible mergear nada. Se
tolera lo viejo y se corta lo nuevo, igual que `tipos-edge`.

**Lo que falta lo tiene que hacer Axel en GitHub, no yo en el repo:** agregar `lint` a la
lista de checks requeridos en la protección de la rama. Mientras no esté ahí, sale rojo
pero no impide mergear.

Medición al hacerlo: 2,476 problemas (2,388 errores, 88 warnings) contra una base de
2,512 (2,423/89) — **36 por debajo**, así que el gate no puso nada en rojo. Bajar la base
al número real queda para un commit aparte, con el número que mida CI y no el de un
entorno local.

