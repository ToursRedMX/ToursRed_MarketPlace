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

Dicho eso, encontré **2 hallazgos críticos, 3 altos y 6 medios**. El patrón de fondo
que los conecta: **la autorización se resolvió función por función, y quedó desigual.**
Los caminos que alguien revisó a conciencia están sólidos; los que nadie revisó están
completamente abiertos. No hay un guard compartido que se aplique por defecto, así que
la seguridad de cada endpoint depende de si a alguien se le ocurrió ponérselo.

El hallazgo #1 es el que atendería antes del lanzamiento del 21 de septiembre: **el
camino de Stripe —el procesador principal— acepta el monto a cobrar desde el cliente
y lo confirma sin validarlo contra el precio guardado.**

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

## A-3. `capture-paypal-order` no ata la orden de PayPal a la reserva que se le pasa

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
| 1 | **C-2** — verificar que `STRIPE_WEBHOOK_SECRET` esté en los 3 ambientes | Crítico | **minutos, sin tocar código** |
| 2 | **C-1** — validar `amount` contra el precio guardado (y/o en el webhook) | Crítico | medio |
| 3 | **C-2** — hacer que el webhook de Stripe falle cerrado, como el de PayPal | Crítico | trivial (copiar el patrón) |
| 4 | **A-1** — inventariar las ~44 `send-*` y cerrarlas con el guard de service role | Alto | medio (el inventario es el trabajo) |
| 5 | **A-3** — comparar `reference_id` contra `bookingId` en el capture de PayPal | Alto | trivial |
| 6 | **A-2** — exigir dueño/agencia/admin en `generate-booking-qr-token` | Alto | bajo |
| 7 | **M-1** — Turnstile obligatorio y rate limit por IP en el formulario de contacto | Medio | bajo |
| 8 | **M-4** — guard de service role en los dos crons abiertos | Medio | trivial |
| 9 | **M-2, M-3, M-5, M-6** — decisiones de arquitectura, no parches sueltos | Medio | a discutir |

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

Parchar los 11 hallazgos uno por uno deja el mecanismo intacto: la función número 172 va
a nacer con el mismo problema. Es el mismo tipo de conclusión a la que ya se llegó con el
desfase de migraciones —"distingue detectar de prevenir"—: aquí también hay que decidir
si se corrigen los síntomas o se cierra la llave.

Lo que cerraría la llave, en orden de rendimiento:

1. **Un `_shared/auth.ts`** con `requireServiceRole()`, `requireUser()`,
   `requireAdmin()`, `requireOwnerOrAdmin()`, siguiendo el molde de `cfdiAuth.ts`.
   Que llamar al guard sea más fácil que escribirlo a mano.
2. **Un `_shared/cors.ts`**, para que el header no se copie 171 veces.
3. **Un check en CI** que falle si una función nueva no invoca ningún guard. El repo ya
   tiene el precedente exacto y funcionando: `scripts/check-edge-types.mjs` con línea
   base, que falla solo ante errores *nuevos*. La misma técnica sirve aquí: línea base de
   las ~81 funciones abiertas de hoy, y que no crezca.

Ese tercer punto es el que convierte esta auditoría en algo que no hay que repetir en seis
meses.

---

## Verificación y límites de esta auditoría

**Verificado leyendo el código:** los 11 hallazgos citan archivo y línea, y todas las
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

**Corrección de una hipótesis propia:** durante el barrido marqué inicialmente
`process-payment-refund`, `admin-send-broadcast-message` y `process-agency-payout` como
"sin autorización". Al leerlas resultó falso: `process-payment-refund` exige service role
en `:27-36`. Mi grep buscaba `role === 'admin'` y no reconocía la comparación contra el
bearer. Lo anoto porque el mismo sesgo puede afectar a otras funciones que di por buenas:
**una ausencia en un barrido automático no es evidencia de un agujero hasta que se lee el
archivo.**
