# Login por teléfono y reautenticación de acciones sensibles

Estado (14-oct-2026): **construido en tres PRs (#381 reautenticación y cancelaciones, #383 MFA para gastar saldo, y el de login por teléfono + cambio de teléfono/correo + cancelación de tour entero).** Lo que no se haya podido probar contra Supabase real se marca como tal.

## Qué se construye

1. **Entrar con mi teléfono.** Cuentas con `users.phone_verified_e164` pueden iniciar sesión con un OTP de 6 dígitos por **WhatsApp o SMS (lo elige la persona)**. Viajeros, agencias y admins. Reemplaza a la contraseña *en ese camino*; email + contraseña sigue existiendo.
2. **Reautenticación de acciones sensibles, una sola regla en el servidor:**
   - cuenta **con MFA (TOTP verificado)** → solo vale el código TOTP;
   - cuenta **sin MFA** → solo vale la contraseña actual.
3. **Acciones cubiertas:** cambiar teléfono verificado, cambiar correo, cambiar contraseña, cancelar reservas (viajero **y agencia**).
4. **Cambio de teléfono/correo:** el valor nuevo no reemplaza al vigente hasta verificarse; se avisa al correo anterior.

## Hallazgos que motivan el diseño (verificados contra la base y el código, 13-oct-2026)

- Cambiar teléfono hoy exige solo "autenticación reciente" (`recent_phone_auth`): haber iniciado sesión hace < 10 min **o** una fila vigente en `sensitive_verifications`. No pide contraseña.
- El correo no se puede cambiar desde la app; el trigger `sync_user_email` reescribe `public.users.email` desde `auth.users`.
- `checkStepUp` acepta **cualquier** fila vigente de `sensitive_verifications` sin mirar `method`. Una prueba por contraseña guardada ahí **abriría el wallet con solo la contraseña**. Por eso: prueba aparte para la contraseña y `checkStepUp` filtra `method = 'totp'`.
- La contraseña actual al cambiarla hoy se valida solo en el navegador (`ChangePasswordSection.tsx`). Supabase ofrece "Require current password when changing password" (documentación de Supabase, 13-oct-2026); **no se verificó** qué otros flujos rompe (`FirstLoginPasswordGate`, `ExecutivePerfil`, altas sociales fijan contraseña sin tener la anterior).
- Cancelar: 5 funciones de viajero (`process-traveler-cancellation`, `process-partial-cancellation`, `cancel-optional-service`, `cancel-individual-supplement`, `process-receptivo-slot-cancellation`) y la de agencia (`process-agency-booking-cancellation`) piden solo sesión. Solo `admin-cancel-booking` exige AAL2.

## Por qué NO el proveedor Phone nativo de Supabase

Guarda el teléfono como identidad en `auth.users` (hoy 0 de 12 cuentas lo tienen; el nuestro vive en `public.users`), enviaría fuera de nuestros topes, presupuestos, Turnstile y modo simulación, y duplicaría la fuente de verdad. Se reusa el motor OTP propio (`request-phone-otp` / `verify-phone-otp`).

## Cómo se abre la sesión (pendiente de probar)

Con el código válido, una Edge Function llama a `auth.admin.generateLink({ type: 'magiclink' })` y devuelve el `token_hash`; el navegador lo canjea con `verifyOtp`. La sesión nace `aal1`; `MfaGate` decide por el `aal` del JWT, así que el MFA se pide igual que hoy. **No probado todavía:** qué `type` acepta el canje; debe probarse contra el proyecto antes de mergear.

## Estado de la implementación (actualizado 13-oct-2026)

Hecho en este PR: regla única en la base, `verify-reauth`, `enforceReauth`, modal de contraseña/TOTP, y las **6 cancelaciones** detrás de la regla (viajero: reserva completa, parcial, servicio opcional, suplemento; agencia: reserva y slot receptivo). La vista previa de la cancelación parcial y `check_capacity_only` del receptivo **no** la piden (solo leen).

`process-tour-cancellation` (la agencia cancela un tour entero) **entra desde el 14-oct-2026**, por decisión de Axel; ya son 7 las cancelaciones detrás de la regla.

## Orden de puesta en marcha (importa)

Las funciones **fallan cerrado**: si `reauth_satisfied` no existe, `enforceReauth` responde 503 y **nadie puede cancelar**. Por eso, en este orden:

1. Aplicar la migración `20261013014305` **con la versión del archivo** (CLAUDE.md, regla 1 y trampa de `db push`) y confirmar contra la base que existen `reauth_proofs`, `user_has_totp` y `reauth_satisfied`.
2. Desplegar `verify-reauth` (verify_jwt = true, el default) y las 6 funciones de cancelación; mandar un `OPTIONS` a cada una.
3. Desplegar el front.

Desplegar el front antes que las funciones no rompe nada (el modal solo aparece si el servidor responde `REAUTH_REQUIRED`). Desplegar las funciones antes que la migración **sí** rompe las cancelaciones.

## MFA para gastar saldo y puntos (13-oct-2026, PR siguiente al #381)

**Hallazgo (medido con datos de Axel):** la verificación TOTP valía 15 min para cualquier acción y era por persona, no por sesión. El código tecleado a las 03:01:28 para cancelar una reserva dejó que a las 03:02:16 se debitara Cash sin pedir otro. Además, los pagos **mixtos** (saldo o puntos + tarjeta/PayPal/Conekta/OpenPay/MercadoPago) nunca pedían MFA: el saldo se compromete en la reserva y el webhook del procesador lo debita al cobrar.

**Decisión de Axel:** "que lo pida siempre para poder usar wallet y/o puntos".

- **Prueba de gasto de un solo uso** (`sensitive_verifications.purpose = 'spend'`, vence en 5 min, se consume con `consume_spend_step_up`). Cada gasto exige un código nuevo. La de reautenticación (`'reauth'`, 15 min) queda solo para acciones que no mueven dinero. **Una no sirve para la otra.**
- **Caminos cubiertos (9):** wallet al 100% (`confirm-booking-wallet-payment`), suplementos, extras, mensualidades con Cash/puntos (`process-payment-plan-installment`), y el cobro de reserva en Stripe, PayPal, Conekta, OpenPay y MercadoPago.
- **Decisión de cada creador:** `reservaGastaSaldo` (`_shared/gastoDeSaldo.ts`): la reserva tiene `points_used` o `toursred_cash_used` > 0 **y** `payment_status` aún no es `succeeded`. Una reserva ya pagada conserva esos campos para siempre; un suplemento posterior con tarjeta no pide el código.
- **Hallazgo adjunto:** PayPal y MercadoPago no comprobaban que la reserva fuera de quien paga. Con saldo de por medio, el webhook habría debitado al **dueño** aunque pagara otra persona. El helper ahora exige que la reserva sea de quien llama cuando hay saldo.

**Orden de puesta en marcha:** migración `20261013031834` **primero**; luego las funciones (fallan cerrado: sin `consume_spend_step_up` nadie puede pagar con saldo); el front al final.

**No cubierto, a propósito:**
- **Aprobación manual** (`approve-booking`): el saldo se compromete cuando la persona crea la reserva (RPC desde el navegador) y se debita cuando la agencia aprueba. No hay un punto del servidor donde pedir el código en ese camino sin tocar la RPC de creación. Pendiente de decidir.
- **`confirm-checkin-wallet-charge`:** lo inicia la agencia con un OTP que da el viajero en persona; es otro control.
- **Dos pagos simultáneos con un solo código:** lo evita `for update skip locked`; no se probó (requiere dos sesiones).

## Sin verificar / riesgos abiertos

- Dónde se pide MFA al iniciar sesión a viajeros y agencias que lo activaron (`MfaGate` solo cubre admin, contador y ejecutivo).
- Si el proyecto tiene "Secure email change" activo en Supabase Auth (no legible desde el entorno de desarrollo).
- Costos de SMS/WhatsApp a México.
- Una cuenta sin MFA queda protegida solo por el chip del teléfono en el login por OTP (riesgo de SIM swap): el wallet sigue exigiendo MFA; datos personales y reservas quedan expuestos. Decisión de Axel: aceptado al inicio.
- Migraciones: **solo commiteadas, no aplicadas** (CLAUDE.md, regla 1).

## Login por teléfono, cambio de teléfono y de correo (14-oct-2026)

### Qué hay
- **Entrar con el celular** (`PhoneLoginForm`, botón «Entrar con mi celular» en el login): `request-login-otp` busca la cuenta por `users.phone_verified_e164` (activa, correo verificado) y manda el código por SMS o WhatsApp (el que elija la persona); `verify-login-otp` lo valida con la misma `verify_phone_challenge` del motor OTP y, **solo si es bueno**, entrega un token de un solo uso (`generateLink` magiclink) que el navegador canjea con `verifyOtp`. Si la cuenta tiene TOTP, la pantalla pide el código de la app antes de dejar pasar; cancelar ese paso cierra la sesión.
- **Interruptor:** `platform_settings.phone_login_enabled`, **apagado por defecto**. Se enciende con `update public.platform_settings set phone_login_enabled = true;` después de probar en staging. No hay pantalla de admin para esto todavía.
- **Cuenta inexistente:** se responde igual que un envío real (reto falso, nada sale). Limite honesto: el cooldown de 60 s y los topes solo existen para cuentas reales, así que insistir en un número distingue cuáles lo son.
- **Fallos del login con bucket propio** (`login:<user>`): adivinar mal el código de una cuenta ajena bloquea su login por teléfono (5 por día) pero **no** su verificación normal ni correo+contraseña.
- **Cambio de teléfono pendiente:** antes, pedir un código para otro número escribía `users.phone_number` y el trigger borraba la verificación vigente sin probar el nuevo. Ahora el vigente se conserva hasta confirmar el código del número nuevo; luego cambian número y verificación juntos. Un teléfono **verificado** ya no se puede escribir directo en `users` (trigger `PHONE_CHANGE_REQUIRES_OTP`), ni con reautenticación.
- **Reautenticación en el cambio de teléfono:** `request-phone-otp` responde `403 REAUTH_REQUIRED` (TOTP si hay MFA, si no contraseña) y `PhoneOtpVerify` usa `invokeWithStepUp`, así que sale el mismo modal que en las cancelaciones.
- **Cambio de correo:** `request-email-change` (reautenticación → código de 6 dígitos al correo **nuevo**, HMAC, 15 min, 5 intentos, 3 solicitudes/hora) y `confirm-email-change` (código bueno → `auth.admin.updateUserById`, sincroniza `public.users`, aviso al correo **anterior**, cierra las demás sesiones). El correo vigente no cambia hasta confirmar.
- **Pantalla:** `AccountAccessSection` («Acceso a tu cuenta») en los perfiles de viajero, agencia, administrador y ejecutivo. El campo de celular de esos perfiles queda de solo lectura si ya está verificado.
- **Cancelar un tour entero** (`process-tour-cancellation`) exige la misma reautenticación.

### Orden de puesta en marcha
1. Migraciones `20261013043540_login_por_telefono_y_cambio_pendiente` y `20261013044213_cambio_de_correo_verificado`, **con la versión del archivo** (CLAUDE.md, regla 1 y trampa de `db push`; `--dry-run` primero). Confirmar contra la base: columna `phone_login_enabled`, funciones `find_user_for_phone_login`, `get_login_challenge`, `issue_email_change`, `confirm_email_change`, tabla `email_change_requests`.
2. Funciones nuevas: `request-login-otp` y `verify-login-otp` (**`verify_jwt = false`**, ya en `config.toml`; cruzar contra la API tras desplegar), `request-email-change` y `confirm-email-change` (`verify_jwt = true`). Modificadas: `request-phone-otp`, `process-tour-cancellation`. `OPTIONS` a cada una.
3. Front. Con `phone_login_enabled = false` el botón no aparece.
4. Probar en staging; luego encender el interruptor.

### Sin verificar (decirlo antes de afirmarlo)
- **El canje `generateLink` → `verifyOtp`.** No se pudo probar fuera de Supabase real. El front prueba el `type` que devuelve el servidor (`magiclink`) y, si falla, `email`. Si ninguno funciona, hay que ajustar esa pieza antes de encender el interruptor.
- Que `generateLink` no dependa de que el proveedor Email de Auth esté activo.
- Envío real de SMS y de WhatsApp en el login, y del correo con el código del cambio de correo (SMTP2GO).
- `deno check` de las funciones nuevas en local (no hay Deno en este entorno; lo cubre `tipos-edge` del CI).
- `scripts/test-phone-otp-db.mjs` (contenedor Docker de Axel) se **actualizó pero no se corrió** por no haber Docker aquí.
- Que una cuenta con TOTP no pueda quedarse con sesión `aal1` saltándose la pantalla: la sesión sí nace `aal1` y el segundo factor lo exige la interfaz (igual que hoy en el login con contraseña para viajeros y agencias; `MfaGate` solo manda en admin/contador/ejecutivo). Gastar saldo y cancelar siguen pidiendo su propia prueba aunque alguien se salte la pantalla.

### Sigue pendiente
- **Cambiar la contraseña con prueba del lado del servidor.** `ChangePasswordSection` comprueba la contraseña actual con `signInWithPassword` en el navegador, pero `updateUser({password})` no la exige: quien tenga un token puede llamarlo directo. Lo cierra el ajuste «Require current password when changing password» de Supabase Auth (acción de Axel en el Dashboard) **más** adaptar los flujos que fijan contraseña sin tener la anterior (`FirstLoginPasswordGate`, `ExecutivePerfil`, altas sociales) y probar «olvidé mi contraseña» después.
- Aprobación manual (`approve-booking`) y `confirm-checkin-wallet-charge`: ver arriba.
- Costos de SMS/WhatsApp a México y quién paga el login por teléfono: sin medir.
