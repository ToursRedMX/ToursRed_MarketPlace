-- Bloquear a un usuario deja de ser un control solo del front.
--
-- ============================================================================
-- QUE PASABA
-- ============================================================================
--
-- `users.is_active = false` es lo que escribe el panel al bloquear una cuenta,
-- y hasta hoy NADIE lo miraba del lado del servidor: ni RLS, ni los helpers de
-- rol, ni las Edge Functions. `current_user_has_role` y `current_user_is_admin`
-- —de las que cuelgan las politicas de 18 migraciones— solo comparaban `role`.
--
-- Consecuencias, ambas medidas leyendo el codigo:
--
--   1. El bloqueo se aplicaba en el login y en cada cambio de estado de sesion,
--      o sea en el navegador. Quien hablara con PostgREST directo con su token
--      no se detenia.
--   2. Nada revoca la sesion al bloquear, y el cliente tiene
--      `autoRefreshToken: true`. Un usuario ya logueado al que se bloquea
--      conserva un token que se renueva solo.
--
-- El arreglo del front (PR #183) cerro el unico control que existia. Esto pone
-- el segundo, que es el que aplica al token ya emitido.
--
-- ============================================================================
-- POR QUE `IS DISTINCT FROM false` Y NO `= true`
-- ============================================================================
--
-- La columna nacio como `boolean DEFAULT true` SIN `NOT NULL`
-- (`20251229171833_add_is_active_to_users.sql`). Con `= true`, una fila con
-- `is_active` en NULL quedaria fuera: es el mismo error que persigue toda esta
-- auditoria —tratar "no se sabe" como "no"— pero en SQL y con el acceso de una
-- persona real de por medio.
--
-- `IS DISTINCT FROM false` bloquea EXACTAMENTE lo que el panel escribe: un
-- `false` explicito. Un NULL sigue entrando, que es lo correcto: NULL no es
-- "bloqueado", es "nunca se fijo", y el DEFAULT de la columna dice que eso
-- significa activo.
--
-- Con todo, hay que ser honesto sobre cuanto protege el operador: quien salva a
-- las filas existentes es la normalizacion de mas abajo, que corre ANTES en el
-- mismo bloque. Despues de eso ya no queda ningun NULL y la columna es NOT
-- NULL, asi que `= true` daria hoy el mismo resultado. La primera version de
-- `test-is-active-rls.sql` caia justo en esa trampa: afirmaba probar el
-- operador y pasaba igual con `= true`.
--
-- El operador vale como segunda capa, para el dia en que alguien quite el NOT
-- NULL. La prueba ahora lo comprueba asi: reintroduce un NULL a la fuerza y
-- exige que el usuario conserve su rol.
--
-- ============================================================================
-- POR QUE TODO VA DENTRO DE UN SOLO `DO`
-- ============================================================================
--
-- Esto no es estilo, es lo que hace seguro el aborto de mas abajo, y se
-- descubrio probandolo:
--
--   La primera version tenia el seguro en un `DO` y el resto en sentencias
--   sueltas. Aplicada con `psql` en autocommit —o sea, statement por statement,
--   que es como puede acabar aplicandose desde el editor SQL del panel— el
--   seguro disparaba, psql reportaba el ERROR... y las sentencias siguientes se
--   ejecutaban igual. Resultado medido en una base de prueba: la columna quedo
--   NOT NULL y los helpers con la condicion nueva. Es decir, el escenario que
--   el seguro existe para evitar ocurria de todos modos, con la valvula de
--   seguridad "funcionando".
--
--   Un bloque `DO` es UNA sentencia. Dentro, un `RAISE EXCEPTION` deshace todo
--   lo que hizo, sin depender de que quien aplique esto lo envuelva en una
--   transaccion. Por eso las DDL van por `EXECUTE`.
--
-- ============================================================================
-- QUE NO TOCA ESTO
-- ============================================================================
--
-- La politica de lectura de `users` deja al usuario leer SU PROPIA fila por su
-- primera rama, `(SELECT auth.uid()) = id`, que no pasa por estos helpers. Es a
-- proposito y hay que conservarlo: si un bloqueado no pudiera leer su fila, el
-- front recibiria cero filas SIN error, lo interpretaria como "el alta va en
-- curso" y lo dejaria pasar con el rol de su metadata. O sea que endurecer esa
-- politica reabriria por detras lo que #183 acaba de cerrar.

DO $migracion$
DECLARE
  v_super_admins_bloqueados int;
  v_admins_activos int;
  v_normalizados int;
BEGIN
  -- -------------------------------------------------------------------------
  -- 0. Seguro: no aplicar si esto dejaria la plataforma sin quien la gestione.
  -- -------------------------------------------------------------------------
  --
  -- Hoy hay UNA sola cuenta de super admin y es con la que se opera todo. Si su
  -- fila tuviera `is_active = false` por un dedazo, esta migracion la dejaria
  -- sin acceso y sin nadie que pudiera devolverselo. Antes que arriesgar eso,
  -- se aborta y se dice por que.
  SELECT count(*) INTO v_super_admins_bloqueados
  FROM public.users
  WHERE is_super_admin = true AND is_active = false;

  IF v_super_admins_bloqueados > 0 THEN
    RAISE EXCEPTION
      'Abortada: hay % super admin(s) con is_active = false. Aplicar esto los dejaria sin acceso. Revisa public.users antes de reintentar.',
      v_super_admins_bloqueados;
  END IF;

  SELECT count(*) INTO v_admins_activos
  FROM public.users
  WHERE role = 'admin' AND is_active IS DISTINCT FROM false;

  IF v_admins_activos = 0 THEN
    RAISE EXCEPTION
      'Abortada: no quedaria ningun admin activo. Revisa public.users antes de reintentar.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. Que "activo" deje de ser ambiguo.
  -- -------------------------------------------------------------------------
  UPDATE public.users SET is_active = true WHERE is_active IS NULL;
  GET DIAGNOSTICS v_normalizados = ROW_COUNT;

  EXECUTE 'ALTER TABLE public.users ALTER COLUMN is_active SET DEFAULT true';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN is_active SET NOT NULL';

  -- -------------------------------------------------------------------------
  -- 2. Los dos helpers de los que cuelga la autorizacion de RLS.
  -- -------------------------------------------------------------------------
  --
  -- Se reescriben completos, no con un parche: asi el archivo dice exactamente
  -- que quedo corriendo, sin tener que reconstruirlo leyendo cinco migraciones.
  -- Se conservan `STABLE`, `SECURITY DEFINER` y `SET search_path = public`, que
  -- son los tres motivos por los que estas funciones existen (el ultimo, ademas,
  -- es lo que exige la guardia de CI `check-search-path.mjs`).
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.current_user_has_role(check_roles text[])
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $cuerpo$
      SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND role = ANY (check_roles)
          AND is_active IS DISTINCT FROM false
      );
    $cuerpo$;
  $ddl$;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.current_user_is_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $cuerpo$
      SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND role = 'admin'
          AND is_active IS DISTINCT FROM false
      );
    $cuerpo$;
  $ddl$;

  -- Los GRANT se repiten porque, aunque `CREATE OR REPLACE` conserva los
  -- privilegios, si alguna de las dos no existiera todavia en el ambiente donde
  -- se aplica esto naceria con los permisos por defecto (EXECUTE para PUBLIC).
  -- Repetirlos hace el archivo autosuficiente y deja el mismo perfil en
  -- cualquier ambiente.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.current_user_has_role(text[]) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.current_user_has_role(text[]) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated';

  EXECUTE $c$
    COMMENT ON FUNCTION public.current_user_has_role(text[]) IS
      'Rol del usuario actual, ignorando a los bloqueados (is_active = false). Usada por las politicas RLS; SECURITY DEFINER para no recursar sobre users.'
  $c$;
  EXECUTE $c$
    COMMENT ON FUNCTION public.current_user_is_admin() IS
      'True si el usuario actual es admin y no esta bloqueado (is_active = false).'
  $c$;

  RAISE NOTICE 'Listo: % admin(s) activos, % fila(s) con is_active NULL normalizadas.',
    v_admins_activos, v_normalizados;
END $migracion$;
