# Inventario de controles técnicos para PCI DSS

**Fecha de medición:** 10 de septiembre de 2026
**Proyecto Supabase:** `huzsedewwzjywcpbkjkm`
**Rama medida:** `main` en `ab5af91`

---

## Qué es esto, y qué NO es

Esto es un **inventario de controles técnicos que ya existen y funcionan**, con el
apuntador exacto a su evidencia: en qué archivo vive, qué job de CI lo verifica, y
cómo reproducir la comprobación. Nació de que la auditoría del 05-sep-2026 dejó
varias guardias automáticas nuevas, y esas guardias son evidencia auditable que
sería una lástima tener que reconstruir de memoria.

**Lo que NO es:**

- **No es una determinación de cumplimiento.** Nadie aquí es QSA. El mapeo a
  requisitos que aparece más abajo es una **propuesta razonada** para que el
  auditor tenga por dónde empezar, no un veredicto.
- **No decide el SAQ.** Eso lo determina el adquirente o el QSA. Lo que sí hay
  aquí son los hechos verificables sobre los que se toma esa decisión.
- **No cubre los controles no técnicos.** Políticas, capacitación, acuerdos con
  proveedores, seguridad física: nada de eso está en el repo y nada de eso se
  inventaría aquí.

---

## 1. Alcance: por dónde pasan los datos de tarjeta

Esta es la sección que más peso tiene, porque determina el tamaño de todo lo demás.

### El flujo real

ToursRed cobra con cinco procesadores —Stripe, PayPal, Conekta, OpenPay y
MercadoPago— y **los cinco funcionan por redirección a la página de cobro del
procesador**. El navegador del viajero sale del dominio de ToursRed y captura la
tarjeta en el sitio del procesador.

En el código eso se ve como `window.location.href = url`, el `checkout` que
devuelve Conekta, y las URLs de `mercadopago.com`. Para PayPal, la orden se crea
en el servidor y el pago se completa del lado de PayPal.

### La consecuencia

**Ningún dato de tarjeta —PAN, CVV, fecha de expiración— toca los servidores de
ToursRed, ni su base de datos, ni sus Edge Functions.**

Comprobación reproducible:

```bash
grep -rniE "card_?number|\bcvv\b|cvv2|expiration_(month|year)" src/ supabase/functions/
# 10-sep-2026: cero resultados
```

Lo que sí se guarda son **identificadores del procesador**, que no son datos de
tarjeta: `stripe_payment_intent_id`, `paypal_capture_id`, `conekta_order_id`,
etcétera, en `payment_transactions`.

### El hallazgo del 10-sep-2026, y por qué importaba

Existía **una sola excepción**, y estuvo activa hasta hoy: la página
`/test-openpay-3ds` renderizaba un formulario propio con PAN, CVV, mes/año y
titular. Estaba ruteada **sin guardia**: pública y en producción.

El PAN iba directo al SDK de OpenPay (nunca al servidor de ToursRed), pero **el
formulario era nuestro, servido desde nuestro dominio**. Y ahí está la línea:

| | |
|---|---|
| **SAQ A** | todas las páginas de captura las sirve **entero el tercero** (iframe o redirección) |
| **SAQ A-EP** | el comercio sirve una página **propia** que postea al procesador |

A-EP es del orden de cuatro veces más requisitos que A, más escaneos ASV
trimestrales. Una página de pruebas que además ya no funcionaba —su Edge Function
la rechazaba con 401 desde el 29-ago— podía estar multiplicando el alcance.

**Se eliminó** (PR #195). El SDK de OpenPay lo inyectaba esa misma página, así que
también desapareció un script de tercero de producción.

**Para el auditor:** confirmar con el adquirente qué SAQ aplica, ahora que el
único formulario propio ya no existe.

---

## 2. Controles técnicos, su evidencia, y cómo reproducirla

Cada fila apunta a algo que se puede abrir y correr. La columna de requisito es
**propuesta**, no determinación.

### 2.1 Autenticación y control de acceso

| Control | Dónde vive | Verificación automática | Req. propuesto |
|---|---|---|---|
| MFA (AAL2) exigido en operaciones sensibles | `supabase/functions/_shared/aal2Check.ts` | `scripts/test-mfa-aal2.mjs` — 38 casos del helper + 532 de handler en 14 consumidores | 8.4 |
| Step-up de autenticación | `supabase/functions/_shared/stepUpCheck.ts` | — | 8.4 |
| Autorización en toda Edge Function | `supabase/functions/_shared/auth.ts` | `scripts/check-edge-guards.mjs` — 171 funciones, 162 con decisión de autorización, 9 públicas por diseño, **0 huecos** | 7.2 |
| RLS en toda tabla | migraciones | medido en vivo: **148 de 148 tablas** con RLS activo | 7.2 |
| Bloqueo de cuenta efectivo en 3 capas | login (#183), RLS (#184), revocación de sesión (#190) | `scripts/test-auth-falla-cerrado.mjs` (18 casos) · `scripts/test-is-active-rls.sql` · `scripts/test-revocar-sesion.sql` (10 comprobaciones) | 8.2.5 |
| Intentos de login fallidos registrados | tabla `failed_login_attempts` (RLS activo) | — | 8.3.4, 10.2 |

**Detalle del bloqueo de cuenta**, porque es el control que más se reforzó y el que
un auditor suele picar:

1. **El front falla cerrado.** Si no se puede comprobar el estado de la cuenta, se
   niega el acceso en vez de concederlo. Probado, incluidos los dos `catch` que
   antes se tragaban la denegación.
2. **RLS ignora a los bloqueados.** Los helpers `current_user_has_role` y
   `current_user_is_admin` —de los que cuelgan las políticas de 18 migraciones—
   excluyen a quien tiene `is_active = false`. O sea que un token válido no basta.
3. **Bloquear revoca la sesión.** Un trigger sobre `public.users` borra las
   sesiones de GoTrue en la transición a bloqueado.

**Limitación conocida y declarada:** el access token JWT ya emitido sigue siendo
válido hasta su expiración, porque se valida por firma sin consultar la base. Es
inherente a JWT y `auth.admin.signOut()` de Supabase tiene la misma ventana.
Cerrarla del todo exige un Auth Hook. Dentro de esa ventana el bloqueado ya no lee
datos, por la capa 2.

### 2.2 Protección de la aplicación

| Control | Dónde vive | Verificación automática | Req. propuesto |
|---|---|---|---|
| CORS con lista blanca | `supabase/functions/_shared/cors.ts` | `scripts/check-origin-header.mjs` — 186 archivos, 0 leen `Origin`/`Referer` crudo | 6.4 |
| Turnstile obligatorio + límite por IP | formularios públicos | `scripts/test-edge-security-closures.mjs` — 12 escenarios en los 3 llamadores | 6.4 |
| Autenticidad del webhook verificada | Stripe, Conekta y MercadoPago verifican **firma**; OpenPay verifica **contra la API del procesador** (`getCharge`/`getChargeMerchant`), no por firma | — | 6.2 |
| `SET search_path` en toda `SECURITY DEFINER` | migraciones | `scripts/check-search-path.mjs`, job `guardia-search-path` (**bloquea**). Medido en vivo: **254 funciones `SECURITY DEFINER`, 0 sin `search_path`** | 6.2 |
| Sin errores silenciados en consultas | todo `src/` | `scripts/check-supabase-errors.mjs` — línea base **0**, cualquier consulta nueva que ignore su error rompe CI | 6.2 |
| Tipado de Edge Functions | — | job `tipos-edge` | 6.2 |

Sobre los webhooks: los cuatro comprueban que el evento es auténtico, pero **no
todos por el mismo mecanismo**, y conviene decírselo al auditor tal cual.
Stripe, Conekta y MercadoPago validan la firma criptográfica del payload.
OpenPay **no valida firma**: en su lugar toma el `transaction.id` del evento y
**vuelve a consultar el cargo contra la API de OpenPay** antes de creerle nada al
cuerpo del mensaje. Si esa verificación falla, el evento se marca
`requiere_conciliacion_manual` en `openpay_webhook_events` y no se procesa.

Es un patrón distinto y defendible —no depende de un secreto compartido, y
verifica contra la fuente autoritativa— pero es distinto, y describirlo como
"firma" en un documento de auditoría sería inexacto.

Sobre `search_path`: importa más de lo que parece. `CREATE OR REPLACE FUNCTION`
**reemplaza todos los atributos, incluidas las cláusulas `SET`**. Cualquier función
recreada sin `search_path` explícito lo pierde en silencio, y en una función
`SECURITY DEFINER` eso es un vector de escalada de privilegios. Es una trampa que
no avisa, y por eso hay una guardia y no una nota.

### 2.3 Bitácora y trazabilidad — Requisito 10

Es el bloque más sólido del inventario.

**`audit_logs_2025` … `audit_logs_2029`** — particionado por año, RLS activo,
lectura restringida. **1,398 registros en la partición de 2026** al 10-sep.

Campos capturados:

```
actor_id, actor_email, actor_role, target_id, target_table, action,
old_values, new_values, diff, ip_address, ip_masked, user_agent,
session_id, correlation_id, metadata, error_message, severity,
created_at, country, country_code, city, region, source_platform
```

Eso cubre de forma directa lo que pide 10.2: **quién** (`actor_*`), **qué**
(`action`, `target_*`, `old_values`/`new_values`/`diff`), **cuándo** (`created_at`),
**desde dónde** (`ip_address`, `ip_masked`, `country`, `user_agent`) y **con qué
sesión** (`session_id`, `correlation_id`).

Dos detalles que conviene señalar antes de que los pregunten:

- **`ip_masked` junto a `ip_address`** sugiere que se pensó en minimización de
  datos personales. Vale la pena documentar el criterio de cuál se usa dónde.
- La migración `20260831051033_CRITICAL_fix_audit_logs_null_bypass.sql` corrigió un
  bypass por NULL. Que exista y esté versionada **es evidencia a favor**: muestra
  que el control se prueba y se corrige, que es justo lo que 10.x quiere ver.

**`audit_errors`** — donde se asientan los fallos que se decidió no propagar, con
`error_message`, `sqlstate` y `raw_payload`. Es el registro de "algo falló y se
siguió a propósito", y cada uso está documentado en su migración.

**`failed_login_attempts`** — 40 registros, RLS activo.

### 2.4 Respaldo y recuperación

Ocho workflows dedicados, todos programados:

| Workflow | Qué respalda |
|---|---|
| `backup-supabase.yml` | base completa a Backblaze B2 |
| `backup-supabase-logical.yml` | respaldo lógico |
| `backup-supabase-hourly-data.yml` | datos, cada hora |
| `backup-supabase-storage.yml` | archivos de Storage |
| `notify-backup-failure.yml` | avisa si algún respaldo falla |
| `test-dr-restore.yml` | **prueba la restauración completa** |
| `test-edge-functions-restore.yml` | prueba restaurar Edge Functions |
| `test-storage-restore.yml` | prueba restaurar Storage |

Lo valioso no son los respaldos: es que **hay pruebas de restauración**. Un
respaldo que nadie ha restaurado no es un respaldo, es una esperanza. Estos tres
workflows son el insumo directo del DRP.

### 2.5 Integridad de la configuración

| Control | Qué vigila |
|---|---|
| `migration-drift.yml` (`guardia-desfase`) | que no haya esquema en producción sin archivo en el repo. **Corre en todos los PR y diario.** Se disparó de verdad el 10-sep con 4 migraciones aplicadas antes de llegar a `main` |
| `audit-supabase-secrets.yml` | secretos de Edge Functions |
| `audit-edge-jwt.yml` | configuración de JWT por función |
| `audit-edge-functions.yml` | auditoría periódica de Edge Functions |
| `fiscal-guard.yml` (**bloquea**) | paridad de la fórmula de IVA entre TypeScript y plpgsql — 18 casos |
| `edge-deps.yml` (`guardia-dependencias`) | que ningún import remoto de `supabase/functions/` entre sin **versión exacta**. Nació en 0 tras fijar 434 especificadores el 10-sep. Publica el inventario de 6.3.2 en el resumen de cada ejecución |

`guardia-desfase` merece énfasis: es un control de gestión de cambios que **ya
demostró funcionar en producción**, no en teoría. Eso es exactamente lo que pide
el Requisito 6.5 sobre cambios controlados.

---

## 3. Cómo reproducir toda la evidencia

Las guardias corren en CI en cada PR. Para correrlas a mano:

```bash
# Suites y guardias de Node (18 pasos en lint.yml)
node scripts/check-edge-guards.mjs        # autorización en Edge Functions
node scripts/check-origin-header.mjs      # CORS
node scripts/check-supabase-errors.mjs    # errores silenciados
node scripts/test-mfa-aal2.mjs            # MFA
node scripts/test-auth-falla-cerrado.mjs  # bloqueo de cuenta, falla cerrado
node scripts/check-search-path.mjs --todo # search_path

# Pruebas SQL: necesitan un Postgres 16 (en CI lo levanta el job `lint`)
cd scripts
psql -d <base> -f test-is-active-rls.sql
psql -d <base> -f test-is-active-rls-guardia.sql
psql -d <base> -f test-revocar-sesion.sql
psql -d <base> -f test-ventana-conciliacion.sql
```

**Una nota metodológica que vale para el auditor:** las pruebas de las migraciones
aplican **el archivo real de la migración**, no una paráfrasis, y varias
**reproducen el fallo antes de arreglarlo**. Además están probadas por mutación:
se revirtió a propósito cada arreglo para confirmar que la prueba se pone en rojo
con el mensaje correcto. Una prueba que nunca se vio fallar no prueba nada.

---

## 4. Huecos conocidos al 10-sep-2026

Se listan aquí a propósito. Un inventario que solo enseña lo bueno no sirve para
prepararse.

| # | Hueco | Impacto | Req. |
|---|---|---|---|
| 1 | **Un `account_executive` activo sin MFA.** Los 2 admins sí lo tienen verificado | Depende de si ese rol entra en alcance | 8.4 |
| 2 | **Ventana del JWT tras bloquear.** El token ya emitido vive hasta expirar | Acotado: dentro de esa ventana RLS ya no le responde | 8.2.5 |
| 3 | **Sin escaneos ASV ni pruebas de penetración.** Depende del SAQ; un ASV es una contratación, no algo que corramos nosotros → [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md) | 11.3 |
| 4 | ~~Sin inventario formal de componentes de terceros~~ **Hecho** → [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md). El hueco técnico que dejó —componentes de Edge Functions sin versión fija— **también está cerrado**: eran 4 de 6, no 3, y 434 de 526 imports; se fijaron todos y lo vigila `guardia-dependencias` | 6.3.2 |
| 5 | ~~Retención sin política escrita~~ **Hecho** → [`retencion-y-revision-de-bitacora.md`](retencion-y-revision-de-bitacora.md). Pero al medirla salió algo peor: solo hay **~2.5 meses de historia**, y los 12 no se recuperan hacia atrás | 10.5.1 |
| 6 | ~~Sin revisión periódica documentada~~ **Procedimiento escrito** (mismo documento), con 7 consultas listas para correr. Falta que Axel asigne responsables | 10.4 |
| 7 | **Procesadores en modo pruebas.** Stripe en cuenta de test, Facturapi con `sk_test_` y `pac_sandbox_mode = true` | No es hueco de PCI, pero el auditor va a ver un entorno que no es el productivo | — |

Los huecos 3 a 6 se atendieron el mismo 10-sep-2026, y al escribirlos **aparecieron
dos hallazgos que no se veían desde fuera**:

- **Solo hay ~2.5 meses de bitácora** (desde el 25-jun-2026). El Requisito 10.5.1
  pide 12, y eso **no se recupera hacia atrás**: el reloj corre desde ya, y la
  única acción posible es no borrar nada.
- **75 eventos `DELETE` sin actor ni IP.** Los escriben triggers de base de datos,
  que no tienen contexto HTTP. Un borrado sin autor es difícil de defender.

O sea que escribir la política sirvió para algo más que tener el papel: obligó a
medir, y medir encontró lo que no se sabía.

---

## 4-bis. Documentos que acompañan a este

| Documento | Cubre |
|---|---|
| [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md) | 6.3.2 — qué software de terceros corre y en qué versión |
| [`retencion-y-revision-de-bitacora.md`](retencion-y-revision-de-bitacora.md) | 10.4 y 10.5.1 — cuánto se guarda y cómo se revisa |
| [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md) | 11.3 y 11.4 — qué falta y de qué depende |

---

## 5. Qué llevar a la primera sesión con el auditor

1. **La determinación de SAQ**, ahora que no hay formulario propio de tarjeta.
2. **Este inventario**, con la aclaración de que el mapeo es propuesto.
3. **La evidencia de que los controles se prueban**: las guardias de CI y su
   historial de ejecuciones en Actions.
4. **Los huecos de la sección 4**, dichos por nosotros antes de que los encuentren.
   Llegar con la lista propia de pendientes cambia el tono de toda la auditoría.

---

## Procedencia de los números

Todo lo medido en vivo salió de consultas a la base de producción el 10-sep-2026:
conteo de tablas y RLS sobre `pg_class`, funciones `SECURITY DEFINER` y su
`proconfig` sobre `pg_proc`, MFA sobre `auth.mfa_factors` con `status='verified'`,
y volúmenes de bitácora sobre `pg_stat_user_tables`. Los conteos de las guardias
salieron de correrlas, no de leerlas.
