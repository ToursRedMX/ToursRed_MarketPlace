-- ===========================================================================
-- Recursion infinita en las politicas de RoutesRed
-- ===========================================================================
--
-- QUE SE PRUEBA
--
-- El caso 1 REPRODUCE el bug antes de arreglarlo. Sin eso, los demas casos
-- pasarian aunque el defecto nunca hubiera existido, que es como se escriben
-- pruebas que no prueban nada.
--
-- Despues se aplica la correccion y se comprueba que los PERMISOS no cambiaron:
-- la recursion se quita cambiando COMO se averigua quien manda, no QUIEN manda.
-- Un arreglo que ademas abriera la tabla seria peor que el bug.
--
-- El caso 8 es el que ata esto con lo que reporto el usuario: una politica
-- sobre OTRA tabla que lee `transport_provider_users` —como las siete de
-- `storage.objects`— revienta igual, y se cura sola.
--
--   psql -v ON_ERROR_STOP=1 -f test-recursion-routesred.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture: lo minimo para que las politicas reales se puedan crear
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS routesred;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- La identidad, en una variable de sesion, para poder cambiar de usuario.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('prueba.usuario', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('prueba.super', true), '') = 'si';
$$;

GRANT USAGE ON SCHEMA routesred, auth, public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), public.is_super_admin() TO authenticated;

CREATE TABLE routesred.transport_provider_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'operator'
);
ALTER TABLE routesred.transport_provider_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON routesred.transport_provider_users TO authenticated;

-- Dos proveedores. En el A: un owner, un administrator y un operator.
-- En el B: otro owner, para comprobar que no se ven entre proveedores.
INSERT INTO routesred.transport_provider_users (transport_provider_id, user_id, status, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','active','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','active','administrator'),
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003','active','operator'),
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000004','suspended','operator'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000001','active','owner');

-- La funcion tal como la dejo 20260827003435: SIN marcar STABLE.
CREATE OR REPLACE FUNCTION routesred.is_provider_member(p_provider_id uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO routesred, public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_roles IS NULL THEN
    RETURN EXISTS (SELECT 1 FROM routesred.transport_provider_users
      WHERE transport_provider_id = p_provider_id AND user_id = v_uid AND status = 'active');
  END IF;
  RETURN EXISTS (SELECT 1 FROM routesred.transport_provider_users
    WHERE transport_provider_id = p_provider_id AND user_id = v_uid AND status = 'active' AND role = ANY(p_roles));
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.is_provider_member(uuid, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Las politicas ORIGINALES, copiadas de 20260827003435. Son las recursivas.
-- ---------------------------------------------------------------------------
CREATE POLICY "tpu_select_members"
  ON routesred.transport_provider_users FOR SELECT TO authenticated
  USING (transport_provider_users.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
      WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
      AND tpu2.user_id = auth.uid() AND tpu2.status = 'active') OR public.is_super_admin());

CREATE POLICY "tpu_insert_admins"
  ON routesred.transport_provider_users FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role = ANY(ARRAY['owner','administrator'])) OR public.is_super_admin());

CREATE POLICY "tpu_update_admins"
  ON routesred.transport_provider_users FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role = ANY(ARRAY['owner','administrator'])) OR public.is_super_admin());

CREATE POLICY "tpu_delete_owner"
  ON routesred.transport_provider_users FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role = 'owner') OR public.is_super_admin());

-- Y una tabla VICTIMA: su politica lee la tabla enferma, igual que las siete
-- de `storage.objects`.
CREATE TABLE routesred.vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL,
  placa text NOT NULL
);
ALTER TABLE routesred.vehiculos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON routesred.vehiculos TO authenticated;
INSERT INTO routesred.vehiculos (transport_provider_id, placa)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ABC-123');

CREATE POLICY "veh_select_members" ON routesred.vehiculos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehiculos.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'));

-- Ayudante: corre algo como `authenticated` y devuelve el SQLSTATE, o 'OK'.
CREATE OR REPLACE FUNCTION public.como_usuario(p_uid text, p_sql text, p_super text DEFAULT 'no')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  PERFORM set_config('prueba.usuario', p_uid, true);
  PERFORM set_config('prueba.super', p_super, true);
  BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
    RETURN v_estado;
  END;
END;
$$;

-- ===========================================================================
-- 1. EL BUG, REPRODUCIDO
-- ===========================================================================
DO $$
DECLARE v_r text; v_v text;
BEGIN
  SET LOCAL ROLE authenticated;
  v_r := public.como_usuario('11111111-0000-0000-0000-000000000001',
          'SELECT 1 FROM routesred.transport_provider_users LIMIT 1');
  v_v := public.como_usuario('11111111-0000-0000-0000-000000000001',
          'SELECT 1 FROM routesred.vehiculos LIMIT 1');
  RESET ROLE;

  IF v_r <> '42P17' THEN
    RAISE EXCEPTION 'Caso 1: se esperaba 42P17 al leer la tabla y llego «%». La prueba no reproduce el bug.', v_r;
  END IF;
  IF v_v <> '42P17' THEN
    RAISE EXCEPTION 'Caso 1: la tabla VICTIMA deberia reventar igual y llego «%»', v_v;
  END IF;
  RAISE NOTICE 'Caso 1 OK (el bug se reproduce: 42P17 en la tabla y en su victima)';
END $$;

-- ---------------------------------------------------------------------------
-- LA CORRECCION
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260911080000_recursion_en_politicas_de_routesred.sql

-- ===========================================================================
-- 2. Ya se puede leer, y la victima tambien
-- ===========================================================================
DO $$
DECLARE v_r text; v_v text;
BEGIN
  SET LOCAL ROLE authenticated;
  v_r := public.como_usuario('11111111-0000-0000-0000-000000000001',
          'SELECT 1 FROM routesred.transport_provider_users LIMIT 1');
  v_v := public.como_usuario('11111111-0000-0000-0000-000000000001',
          'SELECT 1 FROM routesred.vehiculos LIMIT 1');
  RESET ROLE;

  IF v_r <> 'OK' THEN RAISE EXCEPTION 'Caso 2: la tabla sigue reventando con «%»', v_r; END IF;
  IF v_v <> 'OK' THEN RAISE EXCEPTION 'Caso 2: la victima sigue reventando con «%»', v_v; END IF;
  RAISE NOTICE 'Caso 2 OK';
END $$;

-- ===========================================================================
-- 3. Un miembro ve a TODO su proveedor, y solo al suyo
-- ===========================================================================
DO $$
DECLARE v_n integer; v_ajenos integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('prueba.usuario', '11111111-0000-0000-0000-000000000003', true);
  PERFORM set_config('prueba.super', 'no', true);

  SELECT count(*) INTO v_n FROM routesred.transport_provider_users;
  SELECT count(*) INTO v_ajenos FROM routesred.transport_provider_users
   WHERE transport_provider_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  RESET ROLE;

  -- Las 4 filas del proveedor A (incluida la del suspendido), ninguna del B.
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'Caso 3: un operator del proveedor A deberia ver 4 filas y ve %', v_n;
  END IF;
  IF v_ajenos <> 0 THEN
    RAISE EXCEPTION 'Caso 3: se filtraron % filas de OTRO proveedor', v_ajenos;
  END IF;
  RAISE NOTICE 'Caso 3 OK';
END $$;

-- ===========================================================================
-- 4. Un suspendido se ve a si mismo y a nadie mas
-- ===========================================================================
-- Es el matiz que el `user_id = auth.uid()` del original protegia. Si el
-- arreglo lo hubiera perdido, un miembro suspendido no podria ni verse.
DO $$
DECLARE v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('prueba.usuario', '11111111-0000-0000-0000-000000000004', true);
  PERFORM set_config('prueba.super', 'no', true);
  SELECT count(*) INTO v_n FROM routesred.transport_provider_users;
  RESET ROLE;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 4: un suspendido deberia ver solo su fila y ve %', v_n;
  END IF;
  RAISE NOTICE 'Caso 4 OK';
END $$;

-- ===========================================================================
-- 5. Un desconocido no ve NADA
-- ===========================================================================
DO $$
DECLARE v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('prueba.usuario', '99999999-0000-0000-0000-000000000009', true);
  PERFORM set_config('prueba.super', 'no', true);
  SELECT count(*) INTO v_n FROM routesred.transport_provider_users;
  RESET ROLE;

  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 5: el arreglo ABRIO la tabla: un desconocido ve % filas', v_n;
  END IF;
  RAISE NOTICE 'Caso 5 OK';
END $$;

-- ===========================================================================
-- 6. El super admin sigue viendolo todo
-- ===========================================================================
DO $$
DECLARE v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('prueba.usuario', '99999999-0000-0000-0000-000000000009', true);
  PERFORM set_config('prueba.super', 'si', true);
  SELECT count(*) INTO v_n FROM routesred.transport_provider_users;
  RESET ROLE;

  IF v_n <> 5 THEN
    RAISE EXCEPTION 'Caso 6: el super admin deberia ver las 5 filas y ve %', v_n;
  END IF;
  RAISE NOTICE 'Caso 6 OK';
END $$;

-- ===========================================================================
-- 7. Quien puede ESCRIBIR no cambio
-- ===========================================================================
DO $$
DECLARE
  v_owner text; v_admin text; v_operator text; v_ajeno text;
  v_borra_admin text; v_borra_owner text; v_tras_admin integer;
  v_alta text := 'INSERT INTO routesred.transport_provider_users '
               || '(transport_provider_id, user_id) VALUES '
               || '(''aaaaaaaa-0000-0000-0000-000000000001'', gen_random_uuid())';
BEGIN
  SET LOCAL ROLE authenticated;
  v_owner    := public.como_usuario('11111111-0000-0000-0000-000000000001', v_alta);
  v_admin    := public.como_usuario('11111111-0000-0000-0000-000000000002', v_alta);
  v_operator := public.como_usuario('11111111-0000-0000-0000-000000000003', v_alta);
  v_ajeno    := public.como_usuario('22222222-0000-0000-0000-000000000001', v_alta);

  -- Borrar: solo el owner. Se mide POR EL EFECTO, no por el codigo de error:
  -- un DELETE sin permiso no revienta, simplemente no borra. Entre los dos
  -- intentos se cuenta la fila, porque si solo se mirara al final, un arreglo
  -- que dejara borrar al administrator pasaria igual: la fila estaria igual de
  -- muerta y nadie sabria quien la mato.
  v_borra_admin := public.como_usuario('11111111-0000-0000-0000-000000000002',
    'DELETE FROM routesred.transport_provider_users WHERE user_id = ''11111111-0000-0000-0000-000000000003''');
  SELECT count(*) INTO v_tras_admin FROM routesred.transport_provider_users
   WHERE user_id = '11111111-0000-0000-0000-000000000003';
  v_borra_owner := public.como_usuario('11111111-0000-0000-0000-000000000001',
    'DELETE FROM routesred.transport_provider_users WHERE user_id = ''11111111-0000-0000-0000-000000000003''');
  RESET ROLE;

  IF v_tras_admin <> 1 THEN
    RAISE EXCEPTION 'Caso 7: el ADMINISTRATOR borro una fila que solo el owner puede borrar.';
  END IF;

  IF v_owner <> 'OK'    THEN RAISE EXCEPTION 'Caso 7: el owner no pudo dar de alta: %', v_owner; END IF;
  IF v_admin <> 'OK'    THEN RAISE EXCEPTION 'Caso 7: el administrator no pudo dar de alta: %', v_admin; END IF;
  IF v_operator = 'OK'  THEN RAISE EXCEPTION 'Caso 7: un operator PUDO dar de alta. El arreglo abrio permisos.'; END IF;
  IF v_ajeno = 'OK'     THEN RAISE EXCEPTION 'Caso 7: el owner de OTRO proveedor pudo dar de alta.'; END IF;

  -- Un DELETE sin permiso no lanza error: simplemente no borra filas. Se
  -- comprueba por el efecto, no por el codigo.
  IF v_borra_admin <> 'OK' OR v_borra_owner <> 'OK' THEN
    RAISE EXCEPTION 'Caso 7: un DELETE reventó en vez de no borrar nada';
  END IF;
  RAISE NOTICE 'Caso 7 OK';
END $$;

-- ===========================================================================
-- 8. …y el owner SI lo logro
-- ===========================================================================
DO $$
DECLARE v_quedan integer;
BEGIN
  -- Tras el caso 7, el operator 3 tiene que estar borrado (lo quito el owner),
  -- y no por el administrator, que lo intento primero.
  SELECT count(*) INTO v_quedan FROM routesred.transport_provider_users
   WHERE user_id = '11111111-0000-0000-0000-000000000003';
  IF v_quedan <> 0 THEN
    RAISE EXCEPTION 'Caso 8: el owner no logro borrar: quedan % filas', v_quedan;
  END IF;
  RAISE NOTICE 'Caso 8 OK';
END $$;

-- ===========================================================================
-- 9. Ninguna politica se nombra a si misma
-- ===========================================================================
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='routesred' AND tablename='transport_provider_users'
    AND (coalesce(qual,'') LIKE '%transport_provider_users%'
      OR coalesce(with_check,'') LIKE '%transport_provider_users%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 9: % politicas se siguen consultando a si mismas', v_n;
  END IF;
  RAISE NOTICE 'Caso 9 OK';
END $$;

-- ===========================================================================
-- 10. La funcion quedo STABLE
-- ===========================================================================
-- VOLATILE la ejecutaria UNA VEZ POR FILA en cada politica que la use,
-- incluidas las de storage.objects en cada listado de archivos.
DO $$
DECLARE v_vol char;
BEGIN
  SELECT p.provolatile INTO v_vol FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='routesred' AND p.proname='is_provider_member';
  IF v_vol <> 's' THEN
    RAISE EXCEPTION 'Caso 10: is_provider_member quedo «%» en vez de STABLE', v_vol;
  END IF;
  RAISE NOTICE 'Caso 10 OK';
END $$;

ROLLBACK;

\echo 'Recursion en politicas de RoutesRed: 10/10 casos OK'
