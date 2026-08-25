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

## 🟠 Hallazgo grave sin resolver — mismo riesgo que ya cerramos hoy

**8 funciones de CFDI sin guard de autorización**, mismo hueco que cerramos
en `generate-booking-cfdi` (cualquiera con la llave publicable del front puede
invocarlas pasando solo un `booking_id`):

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
| Paso 1 — emitir F-65 (sustituto, $5,206.84, reserva TRG-OQ13VAWCIKL) | ⏸️ requiere Bearer token de admin o service role key |
| Paso 2 — revisar PDF del sustituto | pendiente (Axel) |
| Paso 3 — cancelar F-63 motivo 01 + UUID del sustituto | pendiente |

F-63 sigue `stamped` por $5,664.45 contra $5,206.84 realmente cobrados.
Comando listo, guardado en la sesión anterior — pedirle a Claude Code que lo
reconstruya con:
```
booking_id: e5fd92df-42f0-4d99-b142-2f05c871d1c1
replaces_cfdi_invoice_id: 5a6b4db2-bb5b-43be-a1b1-2f72b9e745d3
payment_form: "04"
```

## ⏸️ C — Idempotencia de exención de membresía (diseñado, no implementado)

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

## 🟡 Deuda técnica documentada (no urgente)

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
