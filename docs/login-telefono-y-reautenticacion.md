# Login por teléfono y reautenticación de acciones sensibles

Estado: **diseño acordado con Axel (13-oct-2026), implementación en curso en este PR.** Este documento se actualiza con lo que de verdad quede construido; lo que no esté verificado se marca como tal.

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

**Fuera de alcance, a propósito:** `process-tour-cancellation` (la agencia cancela un tour entero) no se tocó; no estaba en lo acordado. Es una acción de impacto mayor que las de arriba: conviene decidir si entra.

Pendiente: cambio de teléfono y de correo con verificación del valor nuevo, y el login por teléfono.

## Orden de puesta en marcha (importa)

Las funciones **fallan cerrado**: si `reauth_satisfied` no existe, `enforceReauth` responde 503 y **nadie puede cancelar**. Por eso, en este orden:

1. Aplicar la migración `20261013014305` **con la versión del archivo** (CLAUDE.md, regla 1 y trampa de `db push`) y confirmar contra la base que existen `reauth_proofs`, `user_has_totp` y `reauth_satisfied`.
2. Desplegar `verify-reauth` (verify_jwt = true, el default) y las 6 funciones de cancelación; mandar un `OPTIONS` a cada una.
3. Desplegar el front.

Desplegar el front antes que las funciones no rompe nada (el modal solo aparece si el servidor responde `REAUTH_REQUIRED`). Desplegar las funciones antes que la migración **sí** rompe las cancelaciones.

## Sin verificar / riesgos abiertos

- Dónde se pide MFA al iniciar sesión a viajeros y agencias que lo activaron (`MfaGate` solo cubre admin, contador y ejecutivo).
- Si el proyecto tiene "Secure email change" activo en Supabase Auth (no legible desde el entorno de desarrollo).
- Costos de SMS/WhatsApp a México.
- Una cuenta sin MFA queda protegida solo por el chip del teléfono en el login por OTP (riesgo de SIM swap): el wallet sigue exigiendo MFA; datos personales y reservas quedan expuestos. Decisión de Axel: aceptado al inicio.
- Migraciones: **solo commiteadas, no aplicadas** (CLAUDE.md, regla 1).
