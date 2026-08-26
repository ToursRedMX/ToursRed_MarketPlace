# Pendientes al cierre — 26 de agosto 2026

> Contexto: continuación de la sesión del 25-ago. Arrancó retomando las piezas
> que quedaron abiertas (etiqueta de método de pago, sustitución de F-63,
> idempotencia de membresía) y terminó destapando cuatro huecos de autorización
> en la familia de CFDI, un flujo de payouts que nunca había funcionado, y un
> commit en `main` que desmantelaba tres capas de seguridad a la vez.
>
> 13 commits + 1 merge. PR #9 mergeado a `main` el 26-ago 06:46 UTC (commit
> `9a501cd`). Todo desplegado y verificado en producción (sandbox).

## ✅ Cerrado hoy

### Autorización — 4 hallazgos en la familia de CFDI

Los cuatro salieron de leer código por otro motivo, no de una revisión
sistemática. La auditoría posterior confirmó que no quedaban más.

1. **Las 8 funciones de emisión** (`e20787b`). Timbraban ante el SAT con el
   service role interno sin validar al llamador; `verify_jwt` acepta la llave
   publicable del front. Guard compartido en `_shared/cfdiAuth.ts`.
   El criterio **no es el mismo en todas** — son 4 identificadores y 3 tipos de
   entidad:
   - service role │ `bookings.user_id` │ admin: installment, supplement, cancellation
   - service role │ `agencies.user_id` │ admin: featured-slot
   - service role │ admin, **sin rama de dueño**: commission, optional-service,
     post-booking-insurance, membership — reciben el monto a facturar por el
     body, así que el dueño podría timbrarse importes inventados.

2. **`cancel-cfdi`** (`08d0778`). Sin guard alguno: lo que parecía uno solo
   extraía el user id para registrarlo en `requested_by`. Cualquiera con la
   llave publicable podía **cancelar ante el SAT el CFDI de cualquier cliente**.
   Más grave que el de emisión: emitir de más se corrige con una sustitución,
   cancelar no se deshace. Nueve llamadores internos verificados uno por uno
   (todos service role) y dos pantallas de admin, no una.

3. **`send-cfdi-email`** (`e173225`). `verify_jwt = false` y sin guard: se podía
   disparar correos a los clientes en bucle sin autenticación alguna.

4. **`retry-failed-cfdi`** (`6c25460`). Sin guard, y era **puerta trasera a las
   otras**: reinvoca `generate-booking-cfdi`, `-commission-` y `-featured-slot-`
   **con service role**, saltándose los guards recién puestos.

**Auditadas y verificadas en producción (13 funciones)** con llave publicable
(401/403) y sesiones reales de admin, viajero y agencia. `download-cfdi`,
`generate-sat-xml` y `facturapi-webhook` ya estaban correctamente protegidas.

Alcance de lo auditado: **autorización**, no corrección fiscal ni aritmética.

### Payouts a agencias — nunca habían funcionado

`process_agency_payout_atomic` fallaba desde su creación el 14-ago. Eran **tres**
desalineados encadenados, no uno (`c227b81`):

1. `INSERT` a la columna `payout_date`; la columna se llama `payment_date`.
2. Corregido (1), el CHECK de `payment_method` rechazaba `bank_transfer`,
   `paypal` y `mercadopago` — 3 de las 5 opciones de la UI, incluida la
   preseleccionada.
3. `p_processed_by` y `p_bank_reference` se aceptaban y se descartaban: un pago
   a agencia quedaba sin rastro de quién lo autorizó.

Además se revocó el `EXECUTE` de PUBLIC sobre esa función `SECURITY DEFINER`:
cualquier usuario autenticado podía invocarla por `/rest/v1/rpc/` y crear un
payout saltándose el check de admin.

Resultado: primer payout real del proyecto y **primer CFDI de comisión de la
historia** (serie B, folio 3).

### CFDI — sustitución de F-63 (pieza B del 25-ago, completada)

La capacidad desplegada el 25-ago **nunca se había ejecutado** y tenía dos bugs
(`d40be60`):

1. `uq_cfdi_booking` rechazaba el sustituto. El diseño anterior solo contempló
   saltarse `claim_cfdi_stamping_slot`, pero la protección también vivía en un
   índice único de tabla. Resuelto partiéndolo en dos índices parciales disjuntos
   por `related_cfdi_invoice_id IS NULL / NOT NULL`.
2. FacturAPI respondía `400 unknown_field` en `related_documents.0.cfdi_uuids`:
   el PAC espera `documents`. El código pasaba el objeto sin traducir.

**F-65 timbrado** ($5,206.84, uuid `10B069FE-FAB2-41F0-9657-5ADAD9524C9A`,
`tipo_relacion 04`) y **F-63 cancelado** con motivo 01 referenciándolo. La
reserva queda facturada por lo realmente cobrado.

### Correos de factura con links rotos

El 100% de los 33 CFDIs timbrados tenían botones apuntando a la **API privada de
FacturAPI**, que exige la API key secreta: daban 401 al destinatario
(`a581dcd`, `3d53d8b`).

- El comprobante ahora viaja **adjunto** (PDF + XML), descargado del lado del
  servidor. Se descartó enlazar porque un link de correo se abre sin sesión, y se
  verificó contra la documentación que FacturAPI **no ofrece links públicos**.
- El botón al listado ramifica por `recipient_type`: `/agency/invoices` no es
  `/traveler/invoices`, que filtra por 7 tipos y **no incluye `commission`**.
- **13 funciones** construían esa URL a mano, no una. Doce dejaron de guardarla;
  la treceava es la pieza F (abajo).
- Backfill de 35 filas a NULL (33 `stamped` + 2 en otros estados).
- 9 correos reenviados con el fix.

De paso: `send-cfdi-email` reportaba `success: true` mirando solo el status HTTP,
y **SMTP2GO responde 200 aunque el envío falle** (`dad58c9`). Marcaba
`email_sent = true` para correos que nunca salieron.

### Exención de membresía duplicada (pieza C del 25-ago)

**El diagnóstico heredado estaba invertido** (`87255f5`). Decía que el cargo
BASE se exentaba dos veces y que PayPal/MercadoPago "quedan igual". Verificando
los **18 sitios** (no 10) uno por uno:

- `stripe-webhook:1121`, `:1705` y `approve-booking:244` exentan el cargo base y
  **ya estaban guardados** por `!booking.used_membership_benefit`. No duplicaban.
- Los que duplicaban eran los **bucles de extras**, fuera de ese guard:
  `stripe-webhook:1168`, `capture-paypal-order:269`, `mercadopago-webhook:722` y
  `approve-booking:282`. Este último parecía protegido por `!autoConfirm`, que
  significa "cubierto con monedero", no "ya exentado".
- `openpay-webhook:317` ya lo evitaba **a propósito**, con un comentario que
  nombraba a Stripe y PayPal. El arreglo nunca se propagó.

Corregido replicando ese precedente. **No hizo falta backfill**: el doble consumo
nunca se materializó porque el tope estaba agotado.

Al verificarlo en vivo salió un bug adicional (`5c23cd9`): Stripe confirma
reservas por **dos rutas** y `payment_intent.succeeded` **nunca tocaba los
extras** — quedaban con `paid_at NULL` para siempre, fuera del CFDI y sin pagar
a la agencia.

### Contabilidad

`create_accounting_entry_for_booking` llevaba 11 días sin generar un solo asiento
(columna renombrada, `u.full_name` → `first_name`/`last_name`). Corregido y 19
asientos backfilleados en sus fechas reales. *(Trabajo iniciado el 25-ago,
cerrado y verificado hoy.)*

### Precisión numérica

Seis columnas de dinero declaradas `numeric` sin escala guardaban el residuo de
punto flotante de JavaScript tal cual (`6088daa`). `PAY-1787694694` quedó con
`net_amount = 78946.25999999998` mientras `amount` —que recibe **el mismo
valor**— quedó en `78946.26`, porque esa sí tiene escala. El origen era un
`reduce()` en `AdminPayouts.tsx`; se arregló en las dos capas.

### Frontend

- **Etiqueta de método de pago** (`20e517b`, `996df8b`). `payment_method_type` es
  el **instrumento**, no el procesador: Openpay no puede aparecer ahí. Se
  centralizó en `paymentLabels.ts` y las 16 reservas con `payment_method` NULL
  dejaron de mostrar "N/A" o "Tarjeta". Hizo falta un quinto archivo que solo
  apareció al abrir la pantalla: `BOOKING_SELECT_FIELDS` no traía
  `payment_provider`, así que el fallback nunca podía dispararse.
- **`AdminBookings.tsx`** (`18f6194`, `ea08617`). Tres identificadores fuera de
  scope desde julio, que tronaban en rutas poco visitadas —el detalle de reserva
  fallaba en 25 de 32 reservas— y que **ningún build detectaba**: Vite no ejecuta
  `tsc`, y `tsc -p tsconfig.json` devuelve 0 siempre porque ese archivo es solo
  referencias. Además, el RLS de `payment_transactions` no permitía a los admins
  leer pagos, lo que dejaba el **reembolso sugerido al cancelar** sin contar lo
  cobrado con tarjeta.

### Merge del PR #9 y reversión deliberada de `d4f3fe2`

`main` traía un commit titulado *"Updated .gitignore"* que en realidad eran **211
archivos, +348 / −4,878**, y bajo ese título hacía tres desmantelamientos de
seguridad sin relación entre sí:

| Qué quitaba | Alcance |
|---|---|
| **Sentry** | 171 Edge Functions (el frontend intacto) |
| **AAL2 / MFA** | 12 funciones administrativas destructivas |
| **Step-up y recovery codes** | 7 archivos, incluido `dependabot.yml` |

Y dejaba el árbol **inconsistente**: `stepUpCheck.ts` lo seguían importando dos
funciones que no borraba, y `confirm-booking-wallet-payment` lo llamaban tres
pantallas de las que solo migraba una.

El propio cambio de `.gitignore` que da nombre al commit también se rechazó: no
añadía nada, **quitaba `.netlify/`** de las exclusiones.

**Se aceptaron 9 archivos de 211**: cinco de configuración (`netlify.toml`, las
dos edge-functions de Netlify, `upload-logo.js`, `verify-contract-otp`) y la
eliminación de cuatro funciones sin ningún llamador (`test-pdfmake`,
`process-payment`, `stripe-checkout`, `invalidate-agency-document`) — **solo del
repo**; siguen desplegadas y retirarlas es decisión aparte.

Verificado en `main` tras el merge: **170 funciones con Sentry, 13 con
`checkAal2Required`, `stepUpCheck.ts` presente**, `PUBLISHABLE_KEY` en 28
archivos y 0 con `ANON_KEY`.

> Un commit que borra 4,878 líneas retirando observabilidad, MFA y step-up a la
> vez, bajo un título que solo menciona el `.gitignore`, no parece trabajo manual
> deliberado. **Conviene averiguar cómo se generó antes de que se repita** — si
> la misma herramienta vuelve a correr sobre `main`, deshará todo esto.

## ✅ E — Typecheck en el pipeline (pasos 1 y 2 cerrados el 26-ago, tarde)

**Estado: pasos 1 y 2 cerrados. Queda el paso 3, sin fecha.**

| | 25-ago | 26-ago tarde |
|---|---|---|
| Total | 501 en 126 archivos | **461** |
| **Clase crash** | **32 en 14 archivos** | **0** |
| `TS2304` | 1 | 0 |
| Declarado y no usado | 239 | 239 |
| `TS2339` | 124 | 120 |

Cuatro commits: `e656edd` (paso 1), `3d1dc65`, `bbed573`, `9a26ad6` (paso 2).

El workflow `.github/workflows/typecheck.yml` corre en push a `main` y en cada
PR, en modo informativo, y publica el desglose por clase en el resumen del job.
Su línea base quedó en **461 / 0**. Con la base de crash en cero el contador es
un centinela real: un `TS2304/18047/18048` nuevo se nota contra cero, no contra
"ya había 32".

Dos cosas que costó descubrir y conviene no repetir:

- El step tiene `set +e` a propósito. Actions corre `run:` con `bash -e`, así que
  sin eso el exit 2 de `tsc` aborta el step y el check sale **rojo y bloqueante**,
  que es lo contrario del modo informativo.
- Los 11 `data is possibly null` de auth **no eran crashes**: eran el contrato de
  `signUp`/`signIn`, que devuelven `data: null` solo en el `catch` y por tanto
  siempre junto a un `error`. Se arregló con una unión discriminada. La rama de
  fallo **no puede llevar `error: any`** — se intentó primero así y no cambió
  absolutamente nada (481 antes y después), porque `any` incluye null y no
  discrimina. Tiene que ser un tipo de objeto.

Texto original de la medición, conservado porque explica el punto ciego:

### E — Typecheck en el pipeline (medido el 25-ago)

**El punto ciego:** `npm run build` (Vite) **no ejecuta `tsc`**. Y
`tsc -p tsconfig.json` **tampoco sirve**: ese archivo es solo referencias
(`"files": []`) y devuelve exit 0 siempre. Hay que usar
**`tsc --noEmit -p tsconfig.app.json`**.

Así sobrevivieron meses los tres identificadores fuera de scope de
`AdminBookings`. Se descubrieron abriendo la pantalla, no revisando código.

**Medición del 25-ago: 501 errores en 126 archivos.**

| Clase | Errores | Riesgo en runtime |
|---|---|---|
| Declarado y no usado (`TS6133/6196/6192`) | **239** (48%) | Ninguno |
| Propiedad inexistente (`TS2339`) | 124 | Huecos de tipado sobre respuestas de Supabase |
| Tipos incompatibles | 106 | Caso por caso |
| **Posible crash** (`TS2304/18047/18048`) | **32** en 14 archivos | Real |

Los 239 vienen de `noUnusedLocals` / `noUnusedParameters`. Apagarlos baja de 501
a 262 sin arreglar nada — atajo válido para tener un checker utilizable, pero no
es limpieza.

**El incendio ya está apagado:** queda **un solo `TS2304`**, y no es un crash —
`AdminSettings.tsx:182`, `useState<PlatformSecrets>` con el tipo sin importar.
Está en posición de tipo, y los tipos se borran al compilar.

Tres pasos, en orden de valor:

1. ✅ **Meter `tsc --noEmit -p tsconfig.app.json` al pipeline en modo
   informativo.** Hecho el 26-ago (`e656edd`).
2. ✅ **Atacar los 32 de clase crash** en 14 archivos. Hecho el 26-ago, en 0.
3. ⏸️ **El resto**, limpieza de fondo sin fecha. Los más cargados:
   `BookingSuccessPage` (45), `AgencyTours` (39), `TravelerBookings` (27).

## 🟡 Salido del trabajo de la pieza E (26-ago, tarde) — nada de esto se tocó

Tres cosas que aparecieron al leer código por otro motivo. Ninguna es de la
pieza E y ninguna se arregló.

1. **Las dos features de contabilidad arregladas no se han ejercitado.**
   `AccountingPage:567` y `:593` mandaban `Authorization: Bearer undefined` por
   un `session.session?.access_token` sobre una `session` ya desestructurada, así
   que **"Generar pólizas" y "Exportar SAT XML" nunca funcionaron**: las dos
   Edge Functions hacen `getUser(token)` y devolvían 401 siempre. Corregido en
   `3d1dc65`, pero **solo verificado leyendo el código** — falta apretar ambos
   botones en sandbox. Es independiente del bug de `full_name` que tuvo la
   contabilidad 11 días sin asientos; aquel se arregló backfilleando y este
   seguía vivo.

2. **`support-create-ticket` no valida a quien lo llama.** Tiene
   `verify_jwt = false` en `config.toml`, corre con service role, **ignora por
   completo el header de autorización** y toma `user_id` **del body**. Mismo
   patrón que los cuatro huecos de CFDI de esta misma sesión. Las dos pantallas
   de soporte le mandaban `Bearer undefined` y funcionaban igual, que es como se
   destapó.

3. **`AgencySignupPage` importa `TurnstileWidget` y no lo usa** (`:6`, `TS6133`),
   y tampoco usa el `profileData` que desestructura (`:110`). Esa pantalla **no
   valida Turnstile** mientras `SignupPage` sí. Puede ser deliberado o un olvido;
   no se investigó.

## ⏸️ F — `executive_commissions` guarda la URL privada del PAC como único id

Salió al hacer la búsqueda global del arreglo de correos, y **casi rompe el flujo
de ejecutivos**: se iba a anular `cfdi_xml_url` / `cfdi_pdf_url` en esa tabla,
como se hizo en `cfdi_invoices`.

**Por qué ahí NO se puede.** `executive_commissions` no tiene `pac_invoice_id`
—sus únicas columnas de CFDI son `cfdi_xml_url`, `cfdi_pdf_url`, `cfdi_total`,
`cfdi_uuid_fiscal`, `cfdi_uploaded_at`— y `download-executive-cfdi:108`
**extrae el id de la factura parseando la URL guardada**:

```js
const storedUrl = fileType === "pdf" ? commission.cfdi_pdf_url : commission.cfdi_xml_url;
const match = storedUrl.match(/\/invoices\/([^\/]+)\//);
const invoiceId = match[1];
```

Ahí la URL no es vestigial: es el **único lugar** donde vive el id de FacturAPI.
Anularla deja esa función en 404 para todos los CFDIs de ejecutivos. Lo contrario
de `cfdi_invoices`, donde `pac_invoice_id` existe y `download-cfdi:127` deriva
de él.

**Segundo motivo, independiente:** `ExecutiveComisiones.tsx:239` guarda ahí una
**URL pública de Supabase Storage** cuando el ejecutivo sube su CFDI a mano, y
`:413` la renderiza directo. La columna tiene dos semánticas y una funciona bien.

**El arreglo, cuando se haga:**

1. Migración: agregar `pac_invoice_id` a `executive_commissions`.
2. Backfill: extraer el id de las URLs existentes con el mismo regex.
3. `generate-executive-commission-cfdi`: escribir `pac_invoice_id` y dejar de
   guardar la URL privada.
4. `download-executive-cfdi`: derivar de `pac_invoice_id`.
5. Separar el caso de subida manual: esa URL de Storage es legítima y debe seguir
   funcionando. Probablemente convenga su propia columna.

Requiere migración y merece revisión con calma.

## 🔴 Dependabot — 4 PRs abiertos, los 4 con checks en rojo

Ninguno revisado. **Los 4 fallan los mismos 4 checks de Netlify**
(`deploy-preview`, `Header rules`, `Pages changed`, `Redirect rules`), o sea el
build del preview no compila con esas versiones.

| PR | Cambio | Nota |
|---|---|---|
| **#7** | `react` + `@types/react` | Mayor: revisar breaking changes |
| **#6** | `react-dom` + `@types/react-dom` | Va junto con #7, no mergear por separado |
| **#5** | `tailwindcss` 3.4.19 → **4.3.3** | Salto de mayor. Tailwind 4 cambia la configuración por completo |
| **#4** | `typescript` 5.9.3 → **7.0.2** | Dos mayores de golpe. Con 501 errores de `tsc` medidos, va a empeorar antes de mejorar |

**Recomendación:** no mergear ninguno hasta cerrar la pieza E. Sin typecheck en
el pipeline no hay forma de saber qué rompe un salto de TypeScript o de Tailwind,
y hoy el build verde de Vite demostró no significar nada.

`#4` y `#5` son los de mayor riesgo; `#7` y `#6` deben tratarse como uno solo.

> Nota: `d4f3fe2` había borrado `.github/dependabot.yml`. Se conservó en el merge
> del PR #9, así que estos PRs seguirán llegando.

## 🟢 Datos de prueba generados hoy (limpiar antes de UAT, no antes)

- **`memberships.service_fee_exemption_used` del socio `axelalvarez@outlook.com`
  quedó en 52.50**, no en los 500.00 originales. Se reseteó tres veces para poder
  medir el doble consumo.
- **`TRG-84KJF6B7FMJ`** tiene su extra con `paid_at NULL` — es la reserva que
  destapó el bug de `payment_intent.succeeded`. El arreglo es hacia adelante, no
  retroactivo.
- Tres reservas nuevas: `TRG-E5BGCYW29XY`, `TRG-84KJF6B7FMJ`, `TRG-8XEBZDR3CQ1`.
- Tres payouts (`PAY-1787694694`, `PAY-1787694740`, `PAY-1787698843`) con sus
  CFDIs de comisión serie B folios 3, 4 y 5.
- Una fila `status = 'error'` en `cfdi_invoices` del primer intento de sustitución
  de F-63. No estorba: `error` está fuera del predicado de los índices únicos.

## Estado final

- **PR #9 mergeado a `main`** el 26-ago 06:46 UTC (`9a501cd`), por `axelalvarez84`.
  24 commits, 223 archivos, +8,412 / −705.
- **Netlify:** deploy preview del PR en verde antes del merge;
  `toursredmx.netlify.app` responde 200.
- **Supabase (sandbox):** 5 migraciones aplicadas y ~20 Edge Functions
  desplegadas **antes** del merge. El PR sincronizó git con lo que ya corría, no
  al revés — si alguien revierte el PR, producción queda por delante del código.
- Verificado en `main`: 170 funciones con Sentry, 13 con AAL2, step-up completo.

## Lo que NO se verificó

Para que nadie lo dé por hecho leyendo lo de arriba:

- **La auditoría de CFDI cubrió autorización**, no corrección fiscal ni
  aritmética. Los bugs de la sustitución (índice único, `cfdi_uuids` vs
  `documents`) eran de esa otra clase y no habrían salido de esa revisión.
- **`generate-executive-commission-cfdi` y `download-executive-cfdi` no se
  auditaron** — tienen su propio modelo (API key por ejecutivo). Ver pieza F.
- **De las 8 funciones de emisión, solo `generate-commission-cfdi` se ejercitó de
  punta a punta.** Las otras 7 están probadas del lado del guard (401 con llave
  publicable), pero su camino de timbrado no se ha ejecutado desde el deploy. Se
  ejercitarán solas conforme entren pagos; un fallo aparecería como
  `cfdi_invoices.status = 'error'`.
- **Las dos features de contabilidad arregladas hoy** (`Generar pólizas` y
  `Exportar SAT XML`) están verificadas solo por lectura de código, no
  ejercitadas. Ver punto 1 de la sección amarilla de la pieza E.
- **El contenido de los 9 correos reenviados** se confirmó en uno solo (F-65).
  Los 3 de agencia usan `recipient_type: "agency"`, ruta que nunca se había
  ejecutado antes de hoy.

---

*Para retomar: leer este archivo y `PENDIENTES_25_AGO.md` completos antes de
continuar con cualquier pieza.*
