# Pendientes al cierre — 25 de agosto 2026

> Contexto: sesión larga arreglando el flujo de pago del wizard de reservas
> (wallet, puntos, anticipo, plan de pagos) que destapó una cadena de bugs
> preexistentes en comisiones, contabilidad y CFDI. 5 commits, 7 migraciones,
> 6 Edge Functions ya en producción (sandbox). PR abierto:
> fix/wizard-wallet-points-regression → main.

## 🔴 Autorizado el 25-ago y NO entregado — hacer primero

**Etiqueta de método de pago (BookingSuccessPage.tsx)**
- `:110-117` — el mapa de métodos de pago no conoce Openpay, cae al literal "Tarjeta"
- `:522, 526, 530` — 3 ocurrencias de "Stripe" hardcodeado en el desglose de pago
- `openpay-webhook` escribe `payment_method` en `booking_optional_services` pero
  nunca en `bookings` — por eso queda NULL y se ve mal en pantalla
- Es cosmético (no afecta cobros ni CFDI), pero era trabajo ya comprometido.

## ✅ RESUELTO (25-ago, tarde) — 8 funciones de CFDI sin guard

Cerrado en commit `e20787b`, desplegado y verificado en producción. Guard
compartido en `_shared/cfdiAuth.ts`. Verificación en vivo con la llave
publicable: 401 en las 4 que validan antes de cargar la entidad, y 401 también
con un `booking_id` real en `generate-cancellation-commission-cfdi`.

Detalle del criterio aplicado (no es el mismo en todas — son 4 identificadores
y 3 tipos de entidad):
- service role │ `bookings.user_id` │ admin: installment, supplement, cancellation
- service role │ `agencies.user_id` │ admin: featured-slot
- service role │ admin (SIN rama de dueño): commission, optional-service,
  post-booking-insurance, membership — porque reciben el monto a facturar por
  el body y el dueño podría timbrarse importes inventados.

Excepción encontrada: `AdminPayouts.tsx:834` sí invoca `generate-commission-cfdi`
con JWT de usuario desde una ruta restringida a admin, así que esa lleva rama de
admin. Contradice la nota del commit de ayer que decía que ninguna pantalla
invocaba funciones de CFDI.

Lista original (ya resuelta):

- `generate-booking-installment-cfdi`
- `generate-cancellation-commission-cfdi`
- `generate-commission-cfdi`
- `generate-featured-slot-cfdi`
- `generate-membership-cfdi`
- `generate-optional-service-cfdi`
- `generate-post-booking-insurance-cfdi`
- `generate-supplement-cfdi`

Solo `generate-manual-cfdi` y `generate-executive-commission-cfdi` tienen algo
de protección. Recomendación: mismo patrón que ya se aplicó (service role para
los 10 llamadores internos conocidos, dueño/admin para el resto) — revisar
llamadores de cada una antes de escribir el guard, no asumir que son iguales.

## ⏸️ B — Sustitución de F-63 (a medias, por diseño — necesita credencial admin)

| Paso | Estado |
|---|---|
| Capacidad desplegada (parámetro `replaces_cfdi_invoice_id`, solo admin) | ✅ commit 424b2ad |
| Paso 1 — emitir F-65 (sustituto, $5,206.84, reserva TRG-OQ13VAWCIKL) | ✅ 26-ago 02:37 — `uuid 10B069FE-FAB2-41F0-9657-5ADAD9524C9A`, `tipo_relacion 04` |
| Paso 2 — revisar PDF del sustituto | pendiente (Axel) |
| Paso 3 — cancelar F-63 motivo 01 + UUID del sustituto | pendiente |

**Al ejecutar el Paso 1 por primera vez salieron dos bugs de la capacidad del
25-ago, que estaba desplegada pero nunca se había ejercitado:**

1. `uq_cfdi_booking` (índice único a nivel de tabla) rechazaba el sustituto. El
   diseño del 25-ago solo contempló saltarse `claim_cfdi_stamping_slot`, pero la
   protección anti-duplicado también vivía en un índice. Resuelto partiéndolo en
   dos índices parciales disjuntos por `related_cfdi_invoice_id IS NULL/NOT NULL`
   (migración `20260826011500`).
2. FacturAPI respondía `400 unknown_field` en `related_documents.0.cfdi_uuids`:
   `cfdi_uuids` es el nombre interno y el PAC espera `documents`. El código del
   25-ago pasaba el objeto sin traducir. `substitute-cfdi-for-partial-cancellation:114`
   y `generate-credit-note-for-item-cancellation:112` sí hacen ese mapeo.

Notas para cuando esto se haga en producción (hoy fue contra sandbox):
- El `payment_form: "04"` (tarjeta de crédito) **no está respaldado por datos**:
  el único `payment_transactions` de la reserva trae `payment_method_type = NULL`
  y solo consta que el procesador fue Openpay. Confirmar con Openpay antes.
- La serie final la asigna el PAC, no `platform_settings.cfdi_serie_booking`.

F-63 sigue `stamped` por $5,664.45 contra $5,206.84 realmente cobrados.
Comando listo, guardado en la sesión anterior — pedirle a Claude Code que lo
reconstruya con:
```
booking_id: e5fd92df-42f0-4d99-b142-2f05c871d1c1
replaces_cfdi_invoice_id: 5a6b4db2-bb5b-43be-a1b1-2f72b9e745d3
payment_form: "04"
```

## ✅ RESUELTO (26-ago) — C: doble consumo de la exención de membresía

**El diagnóstico original de esta pieza estaba invertido.** Decía que el cargo
BASE se exentaba dos veces (`create_booking_atomic` + `stripe-webhook:1121`) y
que PayPal/MercadoPago/approve-booking "quedan igual por ahora". Al verificar
los 18 sitios (no 10) uno por uno:

- `stripe-webhook:1121` y `:1705` y `approve-booking:244` exentan el cargo base
  y **ya estaban guardados** por `!booking.used_membership_benefit`, bandera que
  `create_booking_atomic:604` escribe al aplicar la exención. **No duplicaban.**
- Los que duplicaban eran los **bucles de extras**, que quedaban fuera de ese
  guard: `stripe-webhook:1168`, `capture-paypal-order:269`,
  `mercadopago-webhook:722` y `approve-booking:282`. Este último estaba guardado
  solo por `!autoConfirm`, que significa "no cubierto del todo con monedero", no
  "ya exentado".
- `openpay-webhook:317` ya lo evitaba **a propósito**, con un comentario que
  nombraba a Stripe y PayPal como los que sí lo hacían. Nunca se propagó.
- `conekta-webhook` nunca llamó la RPC.

Arreglado replicando el precedente de Openpay: los 4 bucles dejan de llamar la
RPC y solo marcan `paid_at`, usando el `service_charge` neto que
`create_booking_atomic:348` ya calculó. Sin tabla nueva y sin tocar
`create_booking_atomic` por cuarta vez.

Cuantificado en ROLLBACK contra la BD real: base(100) → 100.00,
extras(5) → 105.00, duplicado(5) → **110.00**.

**No hizo falta backfill ni reset del contador:** `membership_exemption_used`
estaba en 0.00 en todos los extras de ambos socios (son dos, no uno), porque
cuando los bucles corrieron el tope ya estaba agotado y la RPC devolvía 0. El
bug era real en código pero no llegó a corromper datos.

## ⏸️ A — Libro mayor de exenciones (defensa en profundidad, no urgente)

Era el diseño original de la pieza C y sigue siendo válido como mejora, pero ya
no es necesario para el bug: la opción C lo resolvió tocando mucho menos.

Tabla `membership_exemption_consumptions` con `UNIQUE(booking_id, scope)` y
parámetros opcionales `p_booking_id` / `p_scope` en la RPC (firma aditiva). Haría
imposible el doble consumo por construcción, en vez de depender de que cada
llamador recuerde no repetir — que es exactamente cómo nació este bug.

Obstáculo conocido: en `create_booking_atomic` la exención se aplica en las
líneas 344/348 y el `INSERT INTO bookings` ocurre en la 529 (`RETURNING id` en la
607), así que no hay `booking_id` todavía. Habría que generar el UUID por
adelantado con `gen_random_uuid()`. Es la cuarta modificación a esa función:
merece sesión dedicada.

## ⏸️ C-viejo — texto original (conservado como referencia)

Bug: `apply_membership_service_fee_exemption` se llama dos veces para la misma
reserva en pagos con Stripe/PayPal/MercadoPago (una vez en `create_booking_atomic`,
otra en el webhook de confirmación), consumiendo el tope mensual del socio dos
veces. Contenido hoy porque solo hay un socio de prueba y su tope ya está agotado
— no está sangrando activamente, pero es un bug real.

Diseño propuesto:
1. Tabla `membership_exemption_consumptions` (libro mayor, `UNIQUE(booking_id, scope)`)
2. Parámetros nuevos opcionales en la función: `p_booking_id`, `p_scope` — firma
   aditiva, no rompe los 10 sitios que ya la llaman con 2 argumentos
3. Actualizar solo los sitios que duplican: `create_booking_atomic` (×2, requiere
   generar el UUID de la reserva por adelantado porque hoy se llama antes del
   INSERT) y `stripe-webhook:1121`. Los otros 7 sitios quedan igual por ahora.

Decisión pendiente: ¿backfillear el libro mayor con datos históricos, o
resetear el contador del socio actual recalculándolo desde
`bookings.membership_service_fee_saved`?

Es la pieza más delicada — toca `create_booking_atomic` una cuarta vez.
Dejar para una sesión dedicada, con calma.

## ⏸️ F — `executive_commissions` guarda la URL privada del PAC como único id

Salió al hacer la búsqueda global del paso 2 del arreglo de correos, y **casi
rompo el flujo de ejecutivos** por no haberla hecho antes: iba a anular
`cfdi_xml_url` / `cfdi_pdf_url` en esa tabla, como se hizo en `cfdi_invoices`.

**Por qué ahí NO se puede.** `executive_commissions` no tiene `pac_invoice_id`
—sus únicas columnas de CFDI son `cfdi_xml_url`, `cfdi_pdf_url`, `cfdi_total`,
`cfdi_uuid_fiscal`, `cfdi_uploaded_at`— y `download-executive-cfdi:108-116`
**extrae el id de la factura parseando la URL guardada**:

```js
const storedUrl = fileType === "pdf" ? commission.cfdi_pdf_url : commission.cfdi_xml_url;
const match = storedUrl.match(/\/invoices\/([^\/]+)\//);
const invoiceId = match[1];
```

Es decir: en esa tabla la URL no es un campo vestigial, es el **único lugar**
donde vive el id de Facturapi. Anularla deja esa función en 404 para todos los
CFDIs de ejecutivos. Lo contrario de `cfdi_invoices`, donde `pac_invoice_id`
existe y `download-cfdi:127` deriva de él.

**Segundo motivo, independiente:** `ExecutiveComisiones.tsx:239` guarda ahí una
**URL pública de Supabase Storage** cuando el ejecutivo sube su CFDI a mano, y
`:413` la renderiza directo. La columna tiene dos semánticas distintas y una de
ellas funciona bien.

**El arreglo, cuando se haga:**
1. Migración: agregar `pac_invoice_id` a `executive_commissions`.
2. Backfill: extraer el id de las URLs existentes con el mismo regex, para no
   perder los que ya están.
3. `generate-executive-commission-cfdi`: escribir `pac_invoice_id` y dejar de
   guardar la URL privada.
4. `download-executive-cfdi`: derivar de `pac_invoice_id`, igual que
   `download-cfdi` con la tabla de reservas.
5. Distinguir el caso de subida manual: ahí la URL de Storage es legítima y debe
   seguir funcionando. Probablemente convenga separarla en su propia columna en
   vez de mezclar dos significados en una.

Requiere migración y merece revisión con calma. No es de la rama de hoy.

## ⏸️ E — Typecheck en el pipeline (medido el 25-ago, no iniciado)

**El punto ciego:** `npm run build` (Vite) **no ejecuta `tsc`**, así que un
identificador inexistente pasa el build sin ruido. Y `tsc -p tsconfig.json`
**tampoco sirve**: ese archivo es solo referencias (`"files": []`) y devuelve
exit 0 siempre. Hay que usar **`tsc --noEmit -p tsconfig.app.json`**.

Así sobrevivieron meses tres identificadores fuera de scope en `AdminBookings`
(`selectedRealTotalPaid` desde el 30-jul, `load` y `AlertCircle` desde el
22-jul), que tronaban en rutas poco visitadas. Se descubrieron abriendo la
pantalla, no revisando código.

**Medición del 25-ago: 501 errores en 126 archivos.** Por clase de riesgo:

| Clase | Errores | Riesgo en runtime |
|---|---|---|
| Declarado y no usado (`TS6133/6196/6192`) | **239** (48%) | Ninguno |
| Propiedad inexistente (`TS2339`) | 124 | Huecos de tipado sobre respuestas de Supabase |
| Tipos incompatibles (`TS2345/2322/…`) | 106 | Caso por caso |
| **Posible crash** (`TS2304/18047/18048`) | **32** en 14 archivos | Real |

Los 239 de "no usado" vienen de `noUnusedLocals` y `noUnusedParameters`.
Apagarlos baja de 501 a 262 sin arreglar nada — es un atajo válido para tener
un checker utilizable, pero no es limpieza.

**El incendio ya está apagado:** queda **un solo `TS2304`**, y no es un crash —
`AdminSettings.tsx:182`, `useState<PlatformSecrets>` con el tipo sin importar.
Está en posición de tipo, y los tipos se borran al compilar. Los tres que sí
estaban en posición de valor eran los de `AdminBookings`, ya corregidos.

Tres pasos independientes, en orden de valor:

1. **Meter `tsc --noEmit -p tsconfig.app.json` al pipeline en modo informativo**
   — que corra y reporte sin bloquear. Barato, y desde ese momento ningún
   `TS2304` nuevo pasa desapercibido. Es lo único urgente de esta pieza.
2. **Atacar los 32 de clase crash** en 14 archivos. Acotado y con valor real.
3. **El resto**, limpieza de fondo sin fecha. Los archivos más cargados son
   `BookingSuccessPage` (45), `AgencyTours` (39), `TravelerBookings` (27).

No es trabajo de una sesión: son días, y toca archivos que ya se movieron el
25-ago.

## ✅ RESUELTO (25-ago, noche) — columnas de dinero sin escala

`agency_payouts.net_amount` y `.platform_commission_amount` estaban declaradas
`numeric` sin escala, a diferencia de `.amount` que es `numeric(12,2)`. Sin
escala Postgres guarda el residuo de punto flotante tal cual llega.

`PAY-1787694694` quedó con `net_amount = 78946.25999999998` mientras `amount`
—que recibe **el mismo valor** desde `AdminPayouts.tsx:800-801`— quedó en
`78946.26`. Esa diferencia entre dos columnas con la misma entrada descarta a la
RPC: el residuo llega ya formado desde el front.

Origen: `AdminPayouts.tsx:750-755` sumaba con `reduce()` en coma flotante. Los
sumandos están limpios y la suma exacta en Postgres da `78946.26`; reproducido
en Node, los 7 valores dan exactamente `78946.25999999998`. La suma flotante
depende del orden: esos mismos 7 números de comisión dan `13718.26`,
`13718.260000000002` o `13718.259999999998` según cómo se ordenen.

Arreglado en dos capas: las 6 columnas de dinero sin escala pasaron a
`numeric(12,2)` (incluida `cfdi_invoices.discount_amount`, que es fiscal y es
donde se asientan los puntos como descuento), y se añadió `round2()` en el
origen del cálculo. El `ALTER` redondeó la fila afectada sin necesidad de UPDATE.

## 🟡 Deuda técnica documentada (no urgente)

- **`config.toml` no refleja producción, pese a decir que sí** — el encabezado
  dice *"synchronized from the production project for DRP recovery"*, pero
  `generate-booking-cfdi` corre en producción con `verify_jwt = false` y no
  aparece en la lista del archivo. Hoy no abre ningún hueco (el guard rechaza
  el bearer vacío con 401), pero quien reconstruya el proyecto desde ese archivo
  le cambia el comportamiento. Vale la pena regenerarlo desde producción y
  revisar si hay más funciones desalineadas.

- **Dos convenciones para "super admin" en el mismo esquema** — `users.is_super_admin`
  (boolean, default false) es la marca real: la leen `is_super_admin()`,
  `create-admin-user:92`, `delete-auth-user:50`, `cleanup-orphan-agencies:62`,
  `admin-cancel-booking:87` y `AuthContext.tsx:438`, siempre como escalación
  *sobre* admin. En paralelo existe `role = 'super_admin'`, que consultan
  `is_admin_user()` y los guards de CFDI, y que **no matchea ninguna fila**:
  los únicos dos admins tienen `role='admin'` (uno de ellos además
  `is_super_admin = true`). Hoy no excluye a nadie porque la marca implica
  `role='admin'`, pero nada en la BD lo garantiza. Vale la pena unificar en
  una sola convención. No es de la rama de autorización de CFDI.

- **`transaction_id` sin validar en `generate-booking-installment-cfdi:306`** —
  se carga por id sin verificar que la transacción pertenezca a esa parcialidad.
  Mismo patrón de cruce de entidades que sí se cerró el 25-ago en
  `generate-cancellation-commission-cfdi` (`cancellation_id` y
  `replaces_cfdi_invoice_id`). Se dejó fuera a propósito para no mezclarlo con
  el fix de autorización. El guard nuevo ya limita quién puede llegar ahí
  (service role, dueño de la reserva o admin), así que el riesgo bajó pero
  no está cerrado.

- **`user_payment` con 3 semánticas incompatibles**: monto a cobrar al crear,
  saldo restante (Conekta/Openpay lo decrementan), monto pagado
  (`process-incremental-payment-deadlines:75`). Solo no explota por un
  `.gt("user_payment", 0)` accidental. No tocar sin auditar los 3 usos primero.
- **`create-openpay-checkout` cuenta `alreadyPaid` distinto que MercadoPago/PayPal**
  — Openpay suma todas las transacciones del booking, los otros dos filtran
  también por `payment_processor`. Pagos mixtos con más de un procesador
  cuentan diferente según cuál se consulte.
- **Formas de pago mixtas con más de 2 medios en el CFDI** — hoy se comparan
  solo dos "cubetas" (monedero vs. procesador) para elegir la forma de pago
  mayoritaria (regla SAT 2.7.1.29). Con puntos + wallet + tarjeta a la vez,
  el CFDI sigue declarando una sola forma sin desglosar los tres importes.
- **`specific_date` en planes de pago cuenta como vencida si ya pasó** — es la
  regla que pediste, correcta para el negocio, pero implica que el anticipo
  se mueve con el calendario (ISLAS MARIAS cobra 50% hoy, habría cobrado 30%
  antes del 1-ago). Documentado, no es bug.
- **Planes en modo `free_form`** no definen un inicial — caen al
  `deposit_percentage` genérico del tour. Comportamiento actual, sin probar
  a fondo.
- **`getEffectiveDepositPct` no es pura** — lee `new Date()` internamente.
  Si algún día se escriben tests formales, hay que inyectar la fecha como
  parámetro.
- **`sync-booking-to-accounting` traga errores en silencio**
  (`waitUntil().catch(console.error)`) — así es como la contabilidad estuvo
  rota 11 días sin que nadie se enterara. Vale la pena agregar alguna alerta
  real (Sentry, email, lo que ya tengas) en vez de solo loguear a consola.

## 🟢 Datos de prueba por limpiar (antes de UAT, no antes)

- 9 asientos huérfanos (`booking_id NULL`, `status = 'reservado_online'`) en
  3 slots ya vencidos del 31-jul
- 3 extras de Openpay sin `paid_at` en reservas `pending`/`processing`
  (se resuelven solos si esas reservas llegan a pagarse; una — TRG-WST5O14MCFX —
  lleva rato en `processing`, revisar si quedó atorada)
- Reservas históricas con `points_used` en unidad 1:1 (antes del fix de hoy)
- 31 reservas con la semántica vieja de `total_price` (neto en vez de bruto)
- `claude.md` sigue sin trackear en git — falta `git add`

## ✅ Lo que sí quedó cerrado hoy

- 5 commits (`a952cdc` → `424b2ad`) en rama `fix/wizard-wallet-points-regression`,
  pusheada a GitHub, PR listo para abrir
- Tope de puntos (50%) y exención de cargo por servicio en pago 100% wallet
- Base bruta de `total_price` (corrige comisiones y doble conteo de extras)
- Tope de anticipo correcto, incluyendo planes de pago con parcialidades vencidas
- Columna `amount_due_now` — desbloquea checkouts y evita cobros de menos
  silenciosos en los webhooks de Openpay/Conekta
- Presentación del wizard unificada entre Step1 y Step4 (mismo % de anticipo)
- Contabilidad reparada: bug de `full_name` corregido + 19 asientos
  backfilleados (11 días sin generar ninguno, desde el 22-jul)
- `paid_at` de extras en Openpay corregido — la agencia recupera comisión
  sobre extras que antes no se contaban
- CFDI facturando el monto real cobrado (puntos como descuento, wallet con
  forma de pago 05, regla de "cantidad mayor" para pagos mixtos)
- Hueco de autorización cerrado en `generate-booking-cfdi` (verificado
  bloqueando con el mismo request que antes funcionaba)

---

*Para retomar: pedirle a Claude Code que lea este archivo completo antes de
continuar con cualquier pieza.*
