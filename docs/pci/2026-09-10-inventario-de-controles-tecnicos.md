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
- **El SAQ ya está determinado: es A** (10-sep-2026). Los cinco procesadores usan
  checkout alojado, así que ningún dato de tarjeta pasa por nuestro sitio. Este
  documento no lo decidió —eso lo determina el adquirente o el QSA— pero sí
  aportó los hechos verificables sobre los que se tomó.
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

**Confirmado: SAQ A** (10-sep-2026). Los cinco procesadores redirigen a su propia
página de checkout, así que la captura de tarjeta la sirve entero el tercero en
los cinco casos, y ya no queda ningún formulario propio.

**Pero SAQ A no libra de los escaneos ASV.** PCI DSS v4 añadió el Requisito
11.3.2 a SAQ A —no aplicaba en v3.2.1— precisamente para comercios con este
flujo: la página que redirige sigue siendo del comercio y es por donde se han
dado las intrusiones. Ver
[`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md), que
tenía ese punto **al revés** y se corrigió el 10-sep-2026.

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
| `SET search_path` en toda `SECURITY DEFINER` | migraciones | `scripts/check-search-path.mjs`, job `guardia-search-path` — **corre en todo PR pero NO es requerido**: se pone rojo sin impedir el merge. Medido en vivo: **254 funciones `SECURITY DEFINER`, 0 sin `search_path`** | 6.2 |
| Sin errores silenciados en consultas | todo `src/` | `scripts/check-supabase-errors.mjs` — línea base **0**. Corre dentro de `lint`, que **sí es requerido** | 6.2 |
| Tipado de Edge Functions | — | job `tipos-edge` (**requerido**) | 6.2 |

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

> **Corregido el 10-sep-2026.** Esta sección decía «es el bloque más sólido del
> inventario» y listaba los campos como *capturados*. Al medirlos resultó que
> varios estaban vacíos en el 100% de los registros. Lo que sigue distingue
> **columna que existe** de **campo que se llena**, que no es lo mismo y era
> justamente la confusión.

**`audit_logs_2025` … `audit_logs_2029`** — particionado por año, RLS activo,
lectura restringida. **1,400 registros** al 10-sep, desde el 25-jun-2026.

#### Columnas que existen, y cuánto se llenan de verdad

Medido sobre los 1,400 registros. La columna que importa es la última:

| Campo | Vacío | Lectura |
|---|---|---|
| `action`, `target_table`, `created_at`, `severity` | 0 | siempre presentes |
| `actor_id` | 663 | de esos, `FAILED_LOGIN` (39) y `PAYMENT_RECEIVED` (60) **son correctos por diseño** — no hay usuario autenticado en un intento fallido, ni persona detrás de un webhook |
| `ip_address` / `ip_masked` | 795 | **el 100% de los eventos de negocio.** Los 605 de autenticación sí la traen |
| `user_agent` | 808 | |
| `old_values` / `new_values` | 784 / 698 | depende del tipo de evento |
| `session_id` | **1.400 (100%)** | la columna existe y **nunca se llenó** |
| `correlation_id` | **1.400 (100%)** | igual |
| `source_platform` | 0 | pero es la constante `'toursred'` en los 1,400: **es un valor por omisión, no procedencia**. No cuenta como evidencia de nada |

#### Contra 10.2, honestamente

- **Quién** (`actor_*`) — cubierto, con los huecos correctos ya explicados.
- **Qué** (`action`, `target_*`, `diff`) — cubierto.
- **Cuándo** (`created_at`) — cubierto.
- **Desde dónde** — **era el hueco grande**: ni un solo evento de negocio traía
  origen. La bitácora sabía de dónde vino cada login y no sabía de dónde vino un
  cobro, una cancelación ni un cambio de cuenta bancaria.
- **Con qué sesión** — no estaba cubierto en absoluto.

#### Qué se hizo

La migración `20260910190000` hace que `insert_audit_log` **deduzca** IP, user
agent, sesión y correlación de `current_setting('request.headers')` y de los
claims del JWT, que es lo que PostgREST deja por petición. Va ahí y no en los
llamadores porque esa función es el **embudo único**: los 8 triggers de
auditoría y las 13 Edge Functions que escriben bitácora pasan por ella, y las
que se escriban mañana también.

**Aplicada en producción el 10-sep-2026**, con `supabase db push` para que el
ledger registre la versión del archivo y no una que la base se invente. Estado
tras aplicar: `migration list --linked` da **889/889, 0 solo-local y 0
solo-remoto**, y `db push --dry-run` responde `Remote database is up to date`.

Y las escrituras que salen de una Edge Function se cubrieron el mismo día: las
**49 funciones** que escriben en una tabla auditada o llaman a
`insert_audit_log` envuelven ahora sus opciones con `opcionesConContexto(req)`,
que reenvía el origen del cliente. Lo vigila `check-audit-context.mjs` dentro de
`lint`, que es check requerido.

Tres advertencias que el auditor merece oír antes de preguntarlas:

1. **Los 1,400 registros existentes no se arreglan.** No hay backfill posible:
   ese dato nunca existió. La mejora aplica de aquí en adelante, y por eso las
   cifras de la tabla de arriba son las del histórico, no las de hoy.
2. **Está probado en pruebas, no observado en producción.** La paridad de la
   regla de enmascarado se comprueba ejecutándola contra Postgres en CI, y la
   fusión de cabeceras la ejercitan 532 casos de `test-mfa-aal2.mjs` sobre 14
   funciones. Pero **ningún evento real ha pasado todavía** por el camino
   completo. La primera revisión de bitácora que se corra debería mirar
   justamente eso.
3. **Lo que no pasa por HTTP se queda sin origen, a propósito.** Un cron o un
   proceso con service role por conexión directa no tiene cabeceras que
   reenviar, y en esos casos `ip_address` queda en NULL. Inventar un origen
   sería peor que no tenerlo.

Dos detalles más que conviene señalar antes de que los pregunten:

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

| Control | ¿Bloquea? | Qué vigila |
|---|---|---|
| `migration-drift.yml` (`guardia-desfase`) | **Sí** | que no haya esquema en producción sin archivo en el repo. **Corre en todos los PR y diario.** Se disparó de verdad el 10-sep con 4 migraciones aplicadas antes de llegar a `main` |
| `fiscal-guard.yml` (`guardia-fiscal`) | **Sí** | paridad de la fórmula de IVA entre TypeScript y plpgsql — 18 casos |
| `edge-types.yml` (`tipos-edge`) | **Sí** | que no entre un error de tipos nuevo en `supabase/functions/`. Línea base **vacía**: exige cero |
| `lint.yml` (`lint`) | **Sí** | 19 suites y guardias, incluidas `check-supabase-errors` y `check-origin-header` |
| `smoke-preview.yml` (`smoke`) | **Sí** | humo contra el deploy preview |
| `edge-deps.yml` (`guardia-dependencias`) | **Sí** | que ningún import remoto de `supabase/functions/` entre sin **versión exacta**. Nació en 0 tras fijar 434 especificadores, y se hizo requerido el mismo 10-sep. Publica el inventario de 6.3.2 en el resumen de cada ejecución |
| `search-path-guard.yml` (`guardia-search-path`) | No | `SET search_path` en toda `SECURITY DEFINER` nueva |
| `audit-supabase-secrets.yml` | No | secretos de Edge Functions |
| `audit-edge-jwt.yml` | No | configuración de JWT por función |
| `audit-edge-functions.yml` | No | auditoría periódica de Edge Functions |

### La columna «¿Bloquea?» es la que importa, y es la que estaba mal

Hasta el 10-sep-2026 este documento afirmaba que `guardia-search-path`
**bloqueaba**. No es cierto: corre en cada PR y se pone roja, pero no está entre
los checks requeridos de `main`, así que el merge procede igual. Se corrigió al
releer la protección de rama en la API en vez de confiar en lo que decía este
documento.

**La distinción no es un tecnicismo.** Una guardia que corre detecta; solo una
requerida previene. Presentarle a un auditor un control como preventivo cuando
es detectivo es la clase de imprecisión que le hace dudar del resto del
inventario — y con razón.

Los checks requeridos son **ocho**: los seis de esta tabla marcados «Sí», más
`typecheck` y `netlify/toursredmx/deploy-preview`, que no son guardias. Se leen
así, y **no de aquí** — este documento se desactualiza, la API no:

```bash
gh api repos/ToursRedMX/ToursRed_MarketPlace/branches/main/protection \
  --jq '.required_status_checks.contexts'
```

Con `enforce_admins: true`, aplican también a los administradores. Al 10-sep-2026
son: `typecheck`, `netlify/toursredmx/deploy-preview`, `guardia-desfase`,
`guardia-fiscal`, `tipos-edge`, `lint`, `smoke` y `guardia-dependencias`.

**Y esta lista ya se quedó vieja una vez el mismo día en que se escribió.** Se
redactó diciendo «siete», y horas después `guardia-dependencias` pasó a
requerido y fueron ocho. No es un descuido: es la demostración de por qué el
comando de arriba está aquí. Un documento afirma lo que era cierto el día que
alguien lo escribió; la protección de rama afirma lo que es cierto ahora. Ante
el auditor, corre el comando.

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
| 3 | **Sin escaneos ASV. Ya no depende del SAQ: es obligatorio.** Con SAQ A confirmado, PCI DSS v4 exige ASV **cada 90 días** con resultado aprobatorio. Un ASV es una contratación, no algo que corramos nosotros. Las pruebas de intrusión (11.4) **no** se exigen en SAQ A; el pentest interno queda como buena práctica → [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md) | 11.3.2 |
| 4 | ~~Sin inventario formal de componentes de terceros~~ **Hecho** → [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md). El hueco técnico que dejó —componentes de Edge Functions sin versión fija— **también está cerrado**: eran 4 de 6, no 3, y 434 de 526 imports; se fijaron todos y lo vigila `guardia-dependencias` | 6.3.2 |
| 5 | ~~Retención sin política escrita~~ **Hecho** → [`retencion-y-revision-de-bitacora.md`](retencion-y-revision-de-bitacora.md). Pero al medirla salió algo peor: solo hay **~2.5 meses de historia**, y los 12 no se recuperan hacia atrás | 10.5.1 |
| 6 | ~~Sin revisión periódica documentada~~ **Procedimiento escrito** (mismo documento), con 7 consultas listas para correr. Falta que Axel asigne responsables | 10.4 |
| 7 | **Procesadores en modo pruebas.** Stripe en cuenta de test, Facturapi con `sk_test_` y `pac_sandbox_mode = true` | No es hueco de PCI, pero el auditor va a ver un entorno que no es el productivo | — |

Los huecos 3 a 6 se atendieron el mismo 10-sep-2026, y al escribirlos **aparecieron
dos hallazgos que no se veían desde fuera**:

- **Solo hay ~2.5 meses de bitácora** (desde el 25-jun-2026). El Requisito 10.5.1
  pide 12, y eso **no se recupera hacia atrás**: el reloj corre desde ya, y la
  única acción posible es no borrar nada.
- ~~**75 eventos `DELETE` sin actor ni IP.**~~ **Se quedó corto, y por mucho.**
  Al ir a arreglarlo se midió el resto: no son los `DELETE`, son **todos** los
  eventos de negocio — 795 de 795 sin origen — y `session_id` y
  `correlation_id` estaban vacíos en **los 1,400 registros**. La causa tampoco
  era solo «los triggers no tienen contexto HTTP»: las Edge Functions que sí lo
  tienen tampoco lo pasaban. Ver la sección 2.3, corregida, y la migración
  `20260910190000`.

O sea que escribir la política sirvió para algo más que tener el papel: obligó a
medir, y medir encontró lo que no se sabía.

---

## 4-bis. Documentos que acompañan a este

| Documento | Cubre |
|---|---|
| **[`mapeo-saq-a.md`](mapeo-saq-a.md)** | **Empezar por aquí.** Qué requisitos aplican de verdad ahora que el SAQ es A |
| [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md) | 6.3.2 — qué software de terceros corre y en qué versión |
| [`retencion-y-revision-de-bitacora.md`](retencion-y-revision-de-bitacora.md) | 10.4 y 10.5.1 — cuánto se guarda y cómo se revisa |
| [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md) | 11.3 y 11.4 — qué falta y de qué depende |

**Este inventario mapea a requisitos elegidos antes de saber el SAQ.** Con SAQ A
confirmado, varios de sus huecos **ya no son hallazgos** —el Requisito 10 entero
no está en SAQ A— y aparecieron obligaciones que no figuran aquí: el ASV
trimestral, el escaneo tras cambio significativo, la lista formal de proveedores
y la revisión de los AOC de los cinco procesadores. El mapeo lo dice entrada por
entrada.

---

## 5. Qué llevar a la primera sesión con el auditor

1. **La determinación de SAQ: es A**, y el hecho que la sustenta — cero formularios de tarjeta propios, checkout alojado en los cinco procesadores.
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
