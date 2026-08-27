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
   y tampoco usa el `profileData` que desestructura (`:110`). ~~Esa pantalla no
   valida Turnstile mientras `SignupPage` sí.~~ **Ese diagnóstico resultó
   incorrecto al investigarlo — ver la pieza G abajo.**

## ✅ G — Turnstile: activado y funcionando (cerrada el 27-ago)

**Los cuatro pasos hechos.** Axel activo CAPTCHA en GoTrue y puso
`turnstile_auth_enabled = true` (estaba apagado por limitaciones de Bolt, que ya
no aplican). El fix de la condicion y el import muerto entraron en el PR #20.

Verificado con las mismas sondas que antes pasaban de largo:

    signup sin captcha_token   -> 400 captcha_failed (no captcha_token found)
    signup con token invalido  -> 400 captcha_failed (invalid-input-response)
    login  sin captcha_token   -> 400 captcha_failed (no captcha_token found)

GoTrue rechaza **antes** de validar credenciales, lo que confirma
retroactivamente que las sondas del 26-ago (que llegaban a `weak_password`) si
indicaban captcha apagado.

En las tres pantallas el widget monta (300x71) y emite token de 773 caracteres.

**Un limite que quedo documentado:** no se pudo probar "enviar sin resolver el
desafio" porque Cloudflare **auto-resuelve** para visitantes de bajo riesgo — no
existe el estado "sin resolver" desde un navegador normal. El respaldo real es el
servidor, que si esta probado. Para forzar ese estado habria que poner la site key
en modo *always challenge* desde Cloudflare.

Texto original de la pieza, conservado por el diagnostico:

### G — diagnostico original (26-ago)

**El hallazgo original estaba mal y conviene decirlo claro.** Se anotó que
`AgencySignupPage` "no valida Turnstile". Sí lo hace: mantiene el token (`:24`),
lo pasa a `signUp` (`:110`) y le pasa las props al hijo que renderiza el widget:

```jsx
turnstileToken={turnstileEnabled ? turnstileToken : ''}
onTurnstileToken={turnstileEnabled ? setTurnstileToken : undefined}
```

El widget vive en `AgencySignupFormBody:668`. El `TS6133` es un import que sobró
cuando el formulario se extrajo a ese componente: basura, no un hueco.

### El bug real: una condición contradictoria

`AgencySignupFormBody:675`:

```js
disabled={... || (!!turnstileToken && !turnstileToken)}
```

`(!!turnstileToken && !turnstileToken)` es **siempre falso**. La intención era
`(turnstileEnabled && !turnstileToken)`, como en `SignupPage:992` y
`LoginPage:323`. Efecto: en el registro de agencias el botón **nunca se bloquea**
por falta de token; en viajero y login sí.

### Pero hoy nada de esto valida nada, y no solo en agencias

Quien verifica el token no es una función propia: el token viaja a
`supabase.auth.signUp({ options: { captchaToken } })` (`lib/supabase.ts:107-113`)
y lo valida **GoTrue**, según la configuración de CAPTCHA del proyecto. Agencias
y viajeros usan **el mismo backend**.

Verificado el 26-ago con tres sondas no destructivas contra sandbox:

| Sonda | Resultado |
|---|---|
| `POST /auth/v1/signup` sin `captcha_token` | pasa de largo (falla por contraseña) |
| `POST /auth/v1/signup` con token **inválido** | pasa de largo (falla por contraseña) |
| `POST /auth/v1/token` con token inválido vs. sin token | idénticos: `invalid_credentials` |

Un proyecto con CAPTCHA activo rechaza un token inválido en ambos endpoints.
Además **`platform_settings.turnstile_auth_enabled = false`**, así que el widget
**no se renderiza en ninguna pantalla** y `turnstileToken` sale vacío siempre.

**Está apagado para las tres pantallas — viajero, agencia y login — no solo para
agencias.** Arreglar el front sin activar lo de arriba no cambia nada.

### Atenuante de negocio, que invierte la prioridad

`agencies.is_approved` tiene default **`false`**, con `approved_at` / `approved_by`:
una agencia registrada por un bot **no puede operar** hasta que un admin la
apruebe. Un viajero registrado por un bot sí puede usar la plataforma de
inmediato. El anti-bot importa **más** en el registro de viajeros que en el de
agencias — lo contrario de lo que sugería la nota original.

### Los cuatro pasos, en este orden

1. **Activar CAPTCHA en GoTrue** (dashboard de Supabase, con la secret key de
   Turnstile). **Decisión de Axel**, toca configuración del proyecto. Sin esto,
   todo lo demás es decorado.
2. **`turnstile_auth_enabled = true`** en `platform_settings`, para que el widget
   se muestre.
3. **Arreglar `AgencySignupFormBody:675`.** Una línea, pero sin efecto observable
   antes de (1) y (2).
4. **Borrar el import muerto** de `AgencySignupPage:6`. Limpieza trivial; cabe en
   el paso 3 de la pieza E.

Deliberadamente **no** se metió al PR #15: agregar el widget sin CAPTCHA del lado
del servidor habría sido un cambio cosmético presentado como anti-bot.

Para antes del lanzamiento (21-sep-2026).

## 🔴 H — Infraestructura: tres capas que bloqueaban los deploy previews

Salieron al intentar verificar React 19 a mano en el preview del PR #21. Ninguna
tiene que ver con el codigo del PR: **son configuracion, y llevaban rotas desde
siempre sin que nadie lo notara.**

### 1. La variable de entorno no llegaba a los previews (RESUELTO)

El preview arrancaba con `Uncaught Error: supabaseKey is required` y la app **no
inicializaba**. Las variables `VITE_*` se inlinean en el bundle en tiempo de
build, asi que se puede leer que recibio cada deploy:

| Deploy | PUBLISHABLE_KEY | SUPABASE_URL | SENTRY_DSN |
|---|---|---|---|
| produccion | presente (12) | presente | presente |
| preview #21 | **AUSENTE** | presente | presente |
| preview #20 | **AUSENTE** | presente | presente |

El detalle que identifico el problema: la URL y el DSN **si** llegaban; solo
faltaba la llave. Si fuera un scope de contexto general, faltarian las tres.
Estaba marcada como variable sensible en Netlify, y Netlify no expone valores
secretos a los Deploy Previews.

Resuelto por Axel. Nota conceptual que conviene no perder: **la llave publicable
esta disenada para ser publica** — vive en el bundle de produccion, que cualquiera
descarga. Lo que protege los datos es la RLS. Marcarla como secreta no daba
seguridad y rompia todos los previews. Distinto seria un SERVICE_ROLE_KEY, que
NUNCA debe ir en una variable `VITE_*`.

### 2. El allowlist de dominios de Turnstile no cubria los previews (RESUELTO)

Con la app ya arrancando, el widget fallaba con
`[Cloudflare Turnstile] Error: 110200` = *domain not allowed*. Misma site key en
ambos bundles, funcionando en produccion: lo unico distinto era el hostname.

Resuelto agregando el hostname del preview en Cloudflare -> Turnstile ->
Settings -> Hostnames. Aplica al instante, sin redesplegar.

**Cuidado con la solucion comoda:** Turnstile hace coincidencia por sufijo y no
admite comodines. Poner `netlify.app` a secas cubriria los previews, pero tambien
**cualquier sitio de cualquier persona alojado en Netlify**, que podria usar la
site key. Alternativa limpia si esto se vuelve molesto: un segundo widget solo
para previews, con su propia key, y sacar la constante hardcodeada de
`TurnstileWidget.tsx:3` a una variable de entorno.

### 3. El check verde de `deploy-preview` nunca significo que la app arrancara

**Este es el hallazgo que importa a futuro y sigue vigente.** El check
`netlify/toursredmx/deploy-preview` solo verifica que el **build compile**. Los
previews del #20 y del #21 salieron en verde mientras la app moria al inicializar
con `supabaseKey is required`.

Es el mismo patron que documenta la pieza E: un check verde que no significa lo
que parece. Alli era Vite compilando sin ejecutar tsc; aqui es Netlify empaquetando
sin abrir la pagina.

Ademas **`SECRETS_SCAN_ENABLED = "false"` en `netlify.toml`** es lo que hizo que
el fallo pasara silencioso: con el escaneo activo Netlify habria avisado. No se
toco porque quitarlo puede tumbar builds por falsos positivos, pero merece una
decision consciente.

**Lo que faltaria, cuando haya tiempo:** un smoke test post-deploy que cargue la
home del preview y falle si la consola tiene errores. Sin eso, "preview en verde"
seguira sin querer decir "la app funciona".

## ✅ F — `executive_commissions`: resuelta (PR #12, mergeada el 27-ago)

`pac_invoice_id` + `cfdi_source` agregados, backfill hecho (1 fila), y
`download-executive-cfdi` ya no parsea la URL. La rama manual **estaba rota**
—devolvia 422 en silencio— y quedo arreglada. Verificado con descargas reales:
PAC xml 200/5,274 bytes, PAC pdf 200/113,803, manual xml 200/18,173, manual pdf
404 con mensaje claro. Y con las URLs anuladas a proposito, el PAC sigue
resolviendo por `pac_invoice_id`: mismos bytes.

Texto original del diagnostico:

### F — diagnostico original (26-ago)

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

## 🟡 Dependabot — 2 resueltos el 27-ago, 2 pendientes

**#7 y #6 cerrados sin mergear**, reemplazados por el **PR #21**, que sube
`react` y `react-dom` a **19.2.8 juntos** con sus `@types`. Ya en `main` y
desplegado en produccion.

Por que estaban bloqueados: cada uno subia la mitad del par y `npm ci` fallaba
con `Conflicting peer dependency` antes de compilar. **Causa raiz:**
`.github/dependabot.yml` no tenia bloque `groups:`. Se agrego uno que junta
react + react-dom + sus tipos, asi que la proxima mayor llegara en un solo PR.

Verificacion del salto a React 19:
- Ninguna API eliminada se usa en `src/` (ReactDOM.render, findDOMNode,
  defaultProps, propTypes, string refs, useFormState...). Ya usaba `createRoot`.
- Los 12 paquetes que consumen React aceptan 19 (peers verificados).
- Dos cambios de codigo, migraciones canonicas:
  `useRef<T>()` -> `useRef<T | undefined>(undefined)`, y el callback de ref de
  VerifyEmailPage, que **devolvia el elemento** — React 19 lo habria tomado como
  funcion de limpieza.
- tsc: 460, **conjunto identico** a main. Build verde. 54 rutas montadas sin un
  solo error ni warning. Los 4 casos de VerifyEmailPage probados en el componente
  real (foco adelante, Backspace atras, pegado, pegado con basura).
- `vendor` crecio de 549,520 a 599,760 bytes (+49.8 kB, +14 kB en gzip).

**Sin verificar todavia:** TipTap, Mapbox y React Query bajo React 19 requieren
interaccion manual. El proyecto no tiene tests automatizados.

### Los 2 que siguen abiertos

| PR | Cambio | Nota |
|---|---|---|
| **#5** | `tailwindcss` 3.4.19 -> **4.3.3** | **Diagnosticado, ver pieza I.1.** 6-9 h, el grueso es revision visual. Sesion propia |
| **#4** | `typescript` 5.9.3 -> **7.0.2** | **BLOQUEADO, ver pieza I.2.** typescript-eslint no soporta TS 7 en ninguna version, ni canary. No mergear |

### Texto original (26-ago)

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

## 🔵 I — Tailwind 4 y TypeScript 7: diagnosticados, listos para ejecutar

Investigacion del 27-ago. **Nada aplicado.** Los dos spikes se corrieron en ramas
aparte, se midieron y se borraron; el arbol quedo limpio y con las versiones
originales (tailwind 3.4.19, typescript 5.9.3).

---

### I.1 — Tailwind 3.4.19 -> 4.3.3 (PR #5)

**Veredicto: media jornada (6-9 h), y el grueso NO es codigo, es mirar pantallas.
Merece sesion propia.**

#### Lo que bloquea el build (15 min, ya probado)

1. El plugin de PostCSS se mudo: `tailwindcss` -> `@tailwindcss/postcss`. Sin eso
   el build falla en seco.
2. `@tailwind base/components/utilities` -> `@import "tailwindcss";`. Sin eso falla
   con `Cannot apply unknown utility class 'font-sans'`.

#### EL CONFIG NO HAY QUE MIGRARLO

Hallazgo que reduce mucho el alcance. Con una linea:

    @config "../tailwind.config.js";

**todo el tema sobrevive intacto**, verificado comparando el CSS generado:
las 6 paletas custom (primary/secondary/accent/success/warning/error, 60 tonos),
la fuente Inter, y las animaciones fade-in/slide-up con sus keyframes. `plugins`
esta vacio, asi que no hay plugins que rompan. Migrar a `@theme` es opcional.

#### Lo que cambia de aspecto EN SILENCIO (el riesgo real)

| Clase v3 | Que pasa en v4 | Usos |
|---|---|---|
| `shadow-sm` | pasa a valer lo que valia `shadow`: **sombra mas grande** | **233** |
| `outline-none` | ya no dibuja outline transparente; ahora `outline-style:none` | **324** |
| `space-x-*` / `space-y-*` | selector `:not([hidden])~:not([hidden])` -> `:where(>:not(:last-child))` | **799** |
| `border` sin color | hereda `currentColor` en vez de `gray-200` | **179** |
| `backdrop-blur-sm` | 4px -> 8px | **35** |
| `rounded-sm` | .125rem -> .25rem (`--radius-sm`) | **6** |
| `bg-opacity-*`, `ring-opacity-*` | **eliminadas, dejan de aplicar** | **51** |

**`outline-none` con 324 usos es el que mas cuidado merece: es accesibilidad.**
El cambio de semantica puede dejar campos sin indicador de foco visible.

#### Lo que NO se rompe (contra lo que se supone)

- **`flex-shrink-0` sigue funcionando**: 566 usos, declaracion generada identica.
- **`rounded` sigue en .25rem**: 273 usos sin cambio.
- **`!important` de Tailwind: 0 usos reales.** (Un primer conteo dio 650, pero
  eran falsos positivos de JS: `!isOpen`, `!form`...)

#### Medicion del CSS generado (spike real, no teoria)

    CSS con Tailwind 3:  124,453 bytes    1,042 clases
    CSS con Tailwind 4:  149,374 bytes    1,294 clases   (+20%)

De las 919 clases comparables, 787 difieren en texto **pero casi todas son
indireccion de variables con el mismo valor computado**:

    gap-4   v3: gap:1rem           v4: gap:calc(var(--spacing)*4)   <- igual
    py-2    v3: padding-top:.5rem  v4: padding-block:calc(...*2)    <- igual

**Clases que desaparecen del CSS: 4 reales** (`bg-opacity-40/50/60`,
`ring-opacity-5`).

#### Plan para la sesion dedicada

| Tarea | Esfuerzo |
|---|---|
| PostCSS + `@import` + `@config` | 15 min |
| `npx @tailwindcss/upgrade` y revisar su diff | 1 h |
| Los 7 patrones de reemplazo | 1-2 h |
| **Revision visual pantalla por pantalla** | **3-4 h** |
| Ajustes de lo que se vea mal | 1-2 h |

No hay `tsc` que avise ni error de consola: una sombra mas grande o un `space-x`
desalineado **no rompen nada, solo se ven mal**.

---

### I.2 — TypeScript 5.9.3 -> 7.0.2 (PR #4)

**Veredicto: BLOQUEADO por el ecosistema, no por nuestro codigo. No se puede
hacer hoy ni manana. Esperar a que typescript-eslint soporte TS 7.**

#### El bloqueo

    $ npm run lint
    Error: typescript-eslint does not support TS 7.0.

No es una advertencia de peer: es un rechazo explicito en tiempo de ejecucion.
Y **no hay version que lo resuelva**:

| Paquete | Version | peer typescript |
|---|---|---|
| typescript-eslint (instalado) | 8.67.0 | `>=4.8.4 <6.1.0` |
| typescript-eslint (**ultima**) | 8.68.0 | `>=4.8.4 <6.1.0` |
| typescript-eslint (**canary**) | 8.68.1-alpha.5 | `>=4.8.4 <6.1.0` |

No existe ninguna 9.x. Mientras eso no cambie, subir TS 7 significa quedarse sin
`npm run lint`.

#### La sorpresa: tsc NO explota

Contra lo que se anticipo el 26-ago ("va a empeorar antes de mejorar"):

| | errores | clase crash |
|---|---|---|
| TS 5.9.3 (base) | 460 | 0 |
| TS 7.0.2 tal cual | **459** | 3 |
| TS 7.0.2 + `"types": ["node"]` | **456** | **0** |

Del conjunto: **390 errores identicos, 69 nuevos, 70 que desaparecen**. El churn
es simetrico por codigo (TS2345: 23 salen / 20 entran; TS6133: 19/10; TS2352:
9/9; TS2367: 7/7), o sea **reformateo de diagnosticos del compilador nuevo, no
errores nuevos de verdad**.

#### Lo unico genuinamente nuevo: 3 errores, un arreglo de una linea

    src/components/DeparturePointSelector.tsx(44,30): TS2503: Cannot find namespace 'NodeJS'
    src/components/ProtectedRoute.tsx(18,35):         TS2503: Cannot find namespace 'NodeJS'
    src/hooks/useFormPersistence.ts(20,35):           TS2503: Cannot find namespace 'NodeJS'

Causa: **en TS 6+ la opcion `types` pasa a `[]` por defecto**, asi que ya no se
auto-cargan los @types globales. Se arregla con `"types": ["node"]` en
tsconfig.app.json (verificado: los 3 desaparecen). Alternativa mas limpia:
cambiar `NodeJS.Timeout` por `ReturnType<typeof setTimeout>`.

#### Impacto en configuracion, mas alla del codigo

Revisado contra nuestro `tsconfig.app.json`. Lo que TS 6 deprecó/removio y que
**NO nos afecta**: `target: es5` (usamos ES2020), `moduleResolution: classic/node`
(usamos `bundler`), `outFile`, `baseUrl`, `module: amd/umd/systemjs`,
`downlevelIteration`. `strict` ya esta en true, que pasa a ser el default.

Lo que **si** nos afecta:
- `types` -> `[]` por defecto (los 3 TS2503 de arriba).
- `noUncheckedSideEffectImports` pasa a `true`: tenemos un import con efecto
  secundario (`main.tsx:7  import './index.css'`). En el spike **no genero error**
  —lo cubre la referencia a `vite/client` de `src/vite-env.d.ts`— pero conviene
  vigilarlo.

#### Y el build no se entera

`npm run build` sale en verde con TS 7 instalado, **porque Vite no ejecuta tsc**.
Es exactamente el punto ciego que documenta la pieza E: el build no valida tipos.

#### Cuando se desbloquee

| Tarea | Esfuerzo |
|---|---|
| Bump + `"types": ["node"]` | 15 min |
| Verificar el conjunto de errores contra la base | 30 min |
| Revisar que el lint vuelva a correr | 30 min |

**Menos de 2 horas de trabajo real.** El unico costo es la espera.

**Accion recomendada hoy: dejar el PR #4 abierto y NO mergearlo.** Revisar cada
pocas semanas si salio una typescript-eslint que levante el tope de `<6.1.0`.

---

## 🟢 Datos de prueba generados hoy (limpiar antes de UAT, no antes)

**Agregados el 27-ago** (todos con "PRUEBA" en la descripcion):

- **4 tickets de soporte** del guard de `support-create-ticket`:
  `REG-0000001` (general anonimo), `RES-0000001` (viajero, desde pantalla),
  `RES-0000002` (viajero, via API), `PAAG-0000001` (agencia, desde pantalla).
- La fila temporal de `executive_commissions` con `cfdi_source='manual'` **ya fue
  borrada**, y las URLs de la fila `80ce9e54` quedaron restauradas.
- `users.email_verified` de `axelalvarez@outlook.com` se puso en `false` unos
  minutos para poder llegar a `VerifyEmailPage` y probar el ref callback de
  React 19. **Restaurado a `true`**; verificado: 0 usuarios sin verificar.

### Lo del 26-ago

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
- **React 19 en runtime: TipTap VERIFICADO, Mapbox y React Query no.** El salto
  esta verificado por compilacion (tsc identico a main), por montaje (54 rutas sin
  un solo error ni warning) y en el unico archivo con cambio de semantica
  (VerifyEmailPage, 4 casos en el componente real).
  **TipTap se probo a mano en produccion el 27-ago, con React 19 y 3.30.5 encima:
  funciona bien.** Quedan sin ejercitar Mapbox (arrastrar el mapa, autocompletado
  de direcciones) y React Query (refetch al volver a la pestana). Ambos montan sin
  errores, pero no se interactuo con ellos. Ya estan en produccion.
- **El selector de punto de salida** (`DeparturePointSelector`) se probo por
  reproduccion del patron del debounce, no en el componente real: solo se usa en
  `AgencyTours.tsx` y hacia falta sesion de agencia. El cambio ahi es puramente
  de tipos (`useRef<T>()` -> `useRef<T|undefined>(undefined)`, emite JS
  equivalente), asi que el riesgo es minimo.
- **El contenido de los 9 correos reenviados** se confirmó en uno solo (F-65).
  Los 3 de agencia usan `recipient_type: "agency"`, ruta que nunca se había
  ejecutado antes de hoy.

---

*Para retomar: leer este archivo y `PENDIENTES_25_AGO.md` completos antes de
continuar con cualquier pieza.*
