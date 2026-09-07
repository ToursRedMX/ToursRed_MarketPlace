# Auditoría de funciones Postgres / SQL — 05 de septiembre de 2026

**Alcance:** las 869 migraciones de `supabase/migrations/` (5.6 MB): **345 funciones**
resueltas a su última definición, 199 triggers, 1,374 políticas RLS.
**Tipo de trabajo:** solo revisión y documentación. **No se modificó código ni se aplicó
ninguna migración.**
**Método:** como las migraciones son append-only, un `grep` plano miente — la definición
viva de cada función es la **última** que la crea. Reconstruí ese estado con un script
que recorre los archivos en orden cronológico y se queda con la última definición de
cada nombre, y sobre ese conjunto corrí los análisis.

**Continuación de:** `2026-09-05-auditoria-edge-functions.md` (PR #132).

---

## Advertencia de método que vale para todo el documento

**No pude verificar el estado vivo de la base.** El conector de Supabase no está
autorizado en esta sesión, así que todo lo que sigue sale de leer el repo. Eso importa
especialmente aquí, porque a diferencia de las Edge Functions —donde el archivo *es* lo
que corre— en SQL el estado real depende de la **secuencia de migraciones aplicadas**, y
`claude.md` documenta que hubo 151 versiones aplicadas sin archivo y que la reconstrucción
es "una exportación funcional, no el texto original".

Por eso los hallazgos que dependen de runtime llevan **la consulta exacta para
confirmarlos**. No los des por ciertos sin correrla.

---

## Resumen ejecutivo

**El resultado más importante de esta auditoría es que la mayoría de mis sospechas
iniciales resultaron falsas.** Lo digo primero porque es el hallazgo real: el trabajo de
endurecimiento de SQL en este repo es **notablemente mejor** que el de las Edge Functions.

Lo que verifiqué y salió limpio:

- **Cero inyección SQL.** Solo 2 funciones usan `EXECUTE` dinámico y ninguna concatena
  entrada de usuario ni usa `format()` con `%s` para identificadores.
- **`search_path` efectivamente cubierto** en todas las `SECURITY DEFINER`.
- **715 sentencias `REVOKE`**: hay un esfuerzo sistemático y sostenido de cerrar permisos.
- **RLS habilitado en 155 de 157 tablas** con políticas (las 2 restantes son un artefacto
  de mi regex, no un hueco).
- **`update_wallet_balance` es código ejemplar**: `FOR UPDATE`, clave de idempotencia,
  chequeo de saldo negativo y validación de identidad del llamante.

Encontré **1 hallazgo alto, 4 medios**. El alto no es de seguridad sino de
**funcionalidad**: hay funciones que muy probablemente están rotas en producción desde
diciembre de 2025 por un efecto secundario de una migración de endurecimiento.

---

# ALTO

## A-1. Un `ALTER` masivo de `search_path` probablemente dejó rotas 4 funciones (y con ellas, el alta de reseñas)

**Migración causante:** `20251220004110_fix_all_function_search_paths.sql`

Esa migración recorre **todas** las funciones del esquema `public` y les aplica:

```sql
EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', func_record.oid::regprocedure);
```

Es decir, `SET search_path = ''` — **vacío**. La intención era buena (cerrar el vector de
secuestro de `search_path`, que es el hallazgo clásico del linter de Supabase), pero
`search_path` vacío significa que **solo `pg_catalog` resuelve**. Cualquier referencia a
una tabla o función de `public` **sin calificar con el esquema deja de resolver** y la
función lanza `relation ... does not exist` en tiempo de ejecución.

La migración se aplicó a ciegas sobre todo `public`, sin revisar si los cuerpos estaban
calificados. Cuatro no lo estaban:

| Función | Referencia sin calificar | Consecuencia |
|---|---|---|
| `update_agency_rating` | `FROM agency_reviews`, `UPDATE agencies` | **rompe el alta de reseñas** (ver abajo) |
| `cleanup_expired_notifications` | `DELETE FROM notifications` | la limpieza de notificaciones nunca corre |
| `update_booking_payment_status` | `UPDATE bookings` | falla al actualizar estado de pago |
| `get_all_reviews_with_details` | 6 tablas | el listado de reseñas falla |

**El caso que más duele es el de reseñas, porque falla la escritura completa.** La cadena:

```sql
-- 20251215234545_add_agency_rating_update_function.sql
CREATE TRIGGER update_agency_rating_on_review_insert
  AFTER INSERT ON agency_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_agency_rating_on_insert();

CREATE OR REPLACE FUNCTION trigger_update_agency_rating_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM update_agency_rating(NEW.agency_id);   -- ← sin calificar tampoco
  RETURN NEW;
END;
$$;
```

Con `search_path = ''`, el `PERFORM update_agency_rating(...)` ni siquiera resuelve el
**nombre de la función**. El trigger lanza excepción, y como es un `AFTER INSERT` sin
manejo de errores, **la excepción aborta el INSERT entero**: no se puede escribir una
reseña. Lo mismo aplica a UPDATE y DELETE sobre `agency_reviews`, que tienen sus propios
triggers.

**Por qué es plausible que nadie lo haya notado.** Es la misma situación que `claude.md`
describe para `snapshot_booking_tax` ("nunca ha disparado sobre una reserva real"): la
plataforma no ha lanzado, hay ~11 usuarios, y las reseñas son de lo último que se ejercita.
Un bug que solo aparece cuando un viajero real califica a una agencia real puede llevar
nueve meses ahí sin que nadie lo pise.

**Verificado en el repo:** ninguna de las 4 se redefinió después del 2025-12-20, así que
ninguna recuperó un `search_path` utilizable. (Ojo: `ALTER FUNCTION ... SECURITY INVOKER`,
que sí se le aplicó a `update_booking_payment_status` en mayo, **no toca `proconfig`** —
el `search_path` vacío sigue puesto.)

**Esto hay que confirmarlo contra la base antes de arreglar nada.** Dos consultas:

```sql
-- 1) ¿Tienen realmente search_path vacío?
select p.proname, p.proconfig, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('update_agency_rating','trigger_update_agency_rating_on_insert',
                    'trigger_update_agency_rating_on_update','trigger_update_agency_rating_on_delete',
                    'cleanup_expired_notifications','update_booking_payment_status',
                    'get_all_reviews_with_details');
-- proconfig = {search_path=} significa vacío -> rotas.
-- proconfig NULL o {search_path=public} -> el ALTER no se aplicó o se revirtió: no hay bug.

-- 2) Prueba directa, en una transacción que se revierte:
begin;
  insert into agency_reviews (agency_id, /* ...columnas requeridas... */)
  values ('<un-agency_id-real>', ...);
rollback;
-- Si devuelve 'relation "agency_reviews" does not exist' o
-- 'function update_agency_rating(uuid) does not exist', el bug está confirmado.
```

**Si se confirma, el arreglo es calificar los cuerpos, no quitar el `search_path`.**
Recrear las funciones con `SET search_path = public, pg_catalog` y las referencias
calificadas (`public.agency_reviews`, `public.update_agency_rating`, …) resuelve las dos
cosas a la vez: cierra el vector de secuestro y devuelve la resolución.

---

# MEDIOS

## M-1. La migración masiva de `search_path` dejó una trampa para el futuro

Es la causa raíz de A-1, y sigue armada.

`CREATE OR REPLACE FUNCTION` **reemplaza todos los atributos de la función, incluidas sus
cláusulas `SET`**. O sea: cualquier función recreada después del 2025-12-20 **sin un
`SET search_path` explícito en su definición pierde silenciosamente** el que le había
puesto el `ALTER` masivo. No hay error, no hay warning: simplemente vuelve a tener
`search_path` mutable.

Medí el estado actual:

| | Funciones |
|---|---|
| Sin `SET search_path` en su definición | 19 |
| ...definidas **antes** del ALTER masivo (cubiertas por él) | 14 |
| ...definidas **después** (perdieron el ajuste) | 5 |
| De esas 5, `SECURITY DEFINER` (las que permitirían escalada) | **0** |

**Hoy no hay agujero de escalada:** las 5 que perdieron el ajuste son `SECURITY INVOKER`,
que corren con los privilegios de quien llama y por lo tanto no escalan nada. Por eso esto
es medio y no alto.

Pero el mecanismo sigue vivo, y es exactamente el tipo de trampa que no avisa: la próxima
función `SECURITY DEFINER` que alguien recree sin acordarse de la cláusula `SET` abre el
vector en silencio. El linter de Supabase lo detecta (`function_search_path_mutable`); no
está claro que alguien lo esté leyendo con regularidad.

## M-2. `deduct_points` valida el saldo sobre una lectura sin bloquear

**Archivo:** `20260704012010_20260704_005_guard_get_or_create_wallet_and_deduct_points.sql`

```sql
SELECT balance INTO v_current_balance
FROM public.toursred_points_wallets
WHERE id = v_wallet_id;          -- ← sin FOR UPDATE

IF v_current_balance < p_amount THEN
  RAISE EXCEPTION 'Puntos insuficientes...';
END IF;

UPDATE public.toursred_points_wallets
SET balance = balance - p_amount, ...
```

Dos llamadas concurrentes leen el mismo saldo, ambas pasan la validación, y ambas
descuentan.

**El daño está acotado, y hay que decirlo:** la tabla tiene
`CHECK (balance >= 0)` (`20260126182722_create_toursred_points_system.sql:6`), así que la
carrera **no puede producir un saldo negativo** — la segunda transacción viola el CHECK y
aborta. El síntoma no es pérdida de dinero sino un error 500 sin manejar en la cara del
usuario, en un momento de compra.

También sin bloqueo queda el guard de duplicados (`SELECT 1 FROM ... WHERE reference_id =
p_reference_id`): dos llamadas simultáneas con la misma referencia pueden pasarlo las dos
y descontar dos veces, si el saldo alcanza.

**El contraste vuelve a estar en el propio repo, y esta vez a un archivo de distancia:**
`update_wallet_balance` —la wallet de dinero— hace todo lo correcto:

```sql
SELECT id, balance INTO v_wallet_id, v_current_balance
FROM public.toursred_cash_wallets
WHERE user_id = p_user_id AND is_active = true
FOR UPDATE;                       -- ← bloqueo

IF p_idempotency_key IS NOT NULL THEN ... RETURN v_existing; END IF;   -- ← idempotencia real
IF v_new_balance < 0 THEN RAISE EXCEPTION ...; END IF;                 -- ← guard de saldo
```

La wallet de **dinero** está blindada; la de **puntos** no. Es el mismo patrón que
encontré en las Edge Functions: dos caminos equivalentes, uno revisado a fondo y el otro no.

## M-3. `refresh_commission_record` no valida quién la llama

**Archivo:** `20260725013847_20260725_commission_refresh_and_late_payment_penalty.sql.sql:253`

```sql
GRANT EXECUTE ON FUNCTION public.refresh_commission_record(uuid) TO authenticated, service_role;
```

Es `SECURITY DEFINER`, recibe un `p_booking_id` arbitrario, **no tiene ningún chequeo de
identidad** (`auth.uid()`, rol o pertenencia), y no encontré ningún `REVOKE` posterior.
Cualquier usuario autenticado puede invocarla sobre la reserva de cualquier otro y
reescribir su fila de `commission_records`.

**Severidad acotada, otra vez con honestidad:** la función **recalcula desde fuentes
autoritativas** (`get_effective_commission_rates`, `calculate_booking_financial_breakdown`
y los valores ya guardados en `bookings`). No acepta importes del llamante, así que **no
sirve para inyectar comisiones arbitrarias**. Lo que permite es forzar el recálculo de
reservas ajenas — un IDOR clásico. Importa si alguna vez hubo un ajuste manual sobre esa
fila, porque el recálculo lo pisa.

Destaca porque es la excepción: la migración
`20260820204143_add_authorization_checks_to_security_definer_functions.sql` le agregó
chequeos de autorización a sus funciones hermanas. A esta se le pasó.

## M-4. El patrón de `snapshot_booking_tax` está en tres funciones, no en una

`claude.md` documenta el manejo de errores de `snapshot_booking_tax` como pendiente
abierto. Verifiqué que **hay dos más con el patrón idéntico**, creadas en la misma
migración (`20260901064051_snapshot_tax_on_charge.sql`):

- `snapshot_supplement_tax`
- `snapshot_optional_service_tax`

Las tres hacen lo mismo ante un fallo: `RAISE WARNING`, poner los seis campos fiscales en
`NULL`, y **dejar pasar el cobro**.

**La buena noticia, que verifiqué:** la red de seguridad **sí cubre las tres**.
`check_missing_tax_snapshots` (`20260901064252`) cuenta por separado reservas, suplementos
y servicios opcionales, y notifica a los admins. Así que el riesgo residual es exactamente
el que `claude.md` ya describe —se detecta *después* de cobrar—, no uno mayor. Lo reporto
para que el pendiente del backlog se escriba en plural: son tres funciones a tocar, no una.

**Y la solución que el backlog pide ya existe en este repo.** `claude.md` plantea la
pregunta como "dejar rastro en una tabla en vez de en un `WARNING` que se pierde". Eso es
literalmente lo que hace `insert_audit_log`:

```sql
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'insert_audit_log failed [%]: % | ...', ...;
  BEGIN
    INSERT INTO audit_errors (error_message, sqlstate, raw_payload) VALUES (...);
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- el fallback nunca puede tumbar la transacción de negocio
  END;
  RETURN NULL;
END;
```

Un `BEGIN` anidado que escribe el fallo en una tabla dedicada, y que a su vez no puede
romper la transacción de negocio. Es el patrón exacto que le falta a las tres
`snapshot_*_tax`, ya escrito, probado y en producción, a unas migraciones de distancia.

---

# Lo que verifiqué y está bien

Esta sección no es relleno: son las hipótesis que traía y que el código refutó.

- **Cero inyección SQL.** De 345 funciones, solo 2 usan `EXECUTE` dinámico, y ninguna
  concatena entrada de usuario ni usa `format()` con `%s` donde debería ir `%I`/`%L`.
- **`promote_to_admin` está cerrada.** Es una función que promueve a admin por email, y
  por defecto Postgres otorga `EXECUTE` a `PUBLIC` — de donde `anon` y `authenticated`
  heredan. Habría sido escalada de privilegios trivial vía PostgREST. **Está revocada de
  `anon` y de `authenticated`** en tres migraciones distintas.
- **RLS sólido.** 157 tablas con políticas, 155 con `ENABLE ROW LEVEL SECURITY` explícito.
  Las 2 "faltantes" son un artefacto de mi regex (capturó nombres de esquema:
  `corporate`, `ecosystem`, `storage`…), no huecos reales.
- **`audit_logs` quedó bien.** Se creó con RLS **deshabilitado** a propósito
  (`20260617174006`), y una migración posterior del mismo día (`20260617191924`) lo
  **rehabilitó**. La lectura ingenua del primer archivo da un falso positivo.
- **`update_wallet_balance`** — el mejor código SQL del repo: bloqueo `FOR UPDATE`,
  idempotencia con replay del resultado original, guard de saldo negativo y validación de
  que el llamante sea el dueño o tenga rol `agency`/`admin`.
- **El sistema de auditoría** tiene fallback a `audit_errors` (ver M-4).
- **715 `REVOKE`** y una decena de migraciones dedicadas exclusivamente a endurecer
  permisos. Alguien estuvo trabajando esto en serio y de forma sostenida.

---

# Priorización sugerida

| # | Hallazgo | Severidad | Primer paso |
|---|---|---|---|
| 1 | **A-1** — 4 funciones probablemente rotas por `search_path` vacío | Alto | **Correr la consulta a `pg_proc`** — minutos, sin tocar nada |
| 2 | **A-1** — recrear las 4 con referencias calificadas | Alto | medio, solo si (1) confirma |
| 3 | **M-2** — `FOR UPDATE` en `deduct_points`, copiando `update_wallet_balance` | Medio | bajo |
| 4 | **M-3** — chequeo de identidad en `refresh_commission_record` | Medio | trivial |
| 5 | **M-4** — fallback a tabla en las 3 `snapshot_*_tax`, patrón de `insert_audit_log` | Medio | bajo |
| 6 | **M-1** — vigilar `function_search_path_mutable` en el linter | Medio | proceso, no código |

El punto 1 va primero por la misma razón que en la auditoría anterior: **es una consulta,
no un cambio**, y decide si los puntos 2 existen o no.

---

# La conclusión de fondo

La comparación con la auditoría de Edge Functions es el hallazgo más útil de las dos.

En las Edge Functions el problema era **estructural**: no hay guard compartido, así que
cada función reinventa o se salta su control de acceso, y quedaron ~81 endpoints
alcanzables sin cuenta.

**En SQL pasa lo contrario.** Postgres *obliga* a declarar permisos explícitamente, hay
`REVOKE` en masa, RLS casi universal y funciones de dinero con bloqueo e idempotencia. La
capa de base de datos está bastante mejor defendida que la capa que está encima de ella.

Lo que sí comparten las dos capas es el patrón de **decisiones correctas que no se
replicaron**:

- Edge Functions: PayPal falla cerrado / Stripe falla abierto; `create-paypal-order`
  deriva el monto del servidor / `create-checkout-session` lo acepta del cliente.
- SQL: `update_wallet_balance` bloquea / `deduct_points` no; sus hermanas recibieron
  chequeo de autorización / `refresh_commission_record` no; `insert_audit_log` deja
  rastro en tabla / las tres `snapshot_*_tax` solo emiten un `WARNING`.

Cada vez, **la versión correcta ya existe en el repo** y no se propagó al caso gemelo. Eso
sugiere que lo que más rinde no es escribir código nuevo, sino un mecanismo que detecte
cuándo dos caminos equivalentes divergen — que es, otra vez, la lección de
`scripts/check-edge-types.mjs`: una línea base que no puede crecer.

Y un riesgo de proceso que A-1 deja a la vista: **una migración de endurecimiento aplicada
a ciegas sobre todo un esquema puede romper más de lo que arregla.** El `ALTER` masivo de
`search_path` cerró un vector real y, si se confirma A-1, dejó cuatro funciones muertas
durante nueve meses sin que nada lo notara. La lección no es no endurecer: es que un
cambio masivo necesita una verificación posterior tan amplia como el cambio.

---

## Verificación y límites

**Verificado leyendo el repo:** los 345 cuerpos de función se resolvieron a su última
definición con un script determinista; las citas de archivo y línea salen de ese árbol.

**Lo que NO pude verificar y por lo tanto no afirmo:**

- **El estado vivo de la base.** El conector de Supabase **no está autorizado en esta
  sesión** — para usarlo hay que autorizarlo desde los conectores de claude.ai. Sin eso no
  puedo leer `pg_proc`, `pg_policies` ni los grants reales. **A-1 depende enteramente de
  esto** y por eso lleva su consulta.
- **Si las migraciones reflejan la base.** `claude.md` documenta 151 versiones aplicadas
  sin archivo, reconstruidas como "exportación funcional". Un `GRANT`, un `REVOKE` o un
  `ALTER FUNCTION` aplicado desde el Dashboard no aparece en el repo.
- **Nada se ejecutó.** Ni una consulta, ni una migración. Todo es lectura estática.

**Falsos positivos que descarté durante el trabajo** — los dejo escritos porque el patrón
se repite y conviene desconfiar de los barridos automáticos:

| Sospecha inicial | Qué resultó |
|---|---|
| "9 `SECURITY DEFINER` sin `search_path`" | **Falso.** El `ALTER` masivo las cubrió; 0 escalables hoy |
| "`promote_to_admin` es escalada trivial" | **Falso.** Revocada de `anon` y `authenticated` |
| "`bookings` no tiene RLS" | **Falso.** Sí lo tiene (`20250512220510_cold_salad.sql`); mi grep no usaba `-i` y la sentencia está en minúsculas |
| "5 tablas con políticas y sin RLS" | **Falso.** Artefacto de regex: eran nombres de esquema |
| "Las 9 funciones de auditoría se tragan los errores" | **Falso.** Tienen fallback a `audit_errors` — son el buen patrón |
| "`audit_logs` corre sin RLS" | **Falso.** Rehabilitado el mismo día |

Seis de mis siete sospechas iniciales eran falsas. **Una ausencia en un barrido automático
no es evidencia de nada hasta que se lee el archivo** — misma lección que anoté en la
auditoría de Edge Functions, y esta vez se cumplió seis veces seguidas.
