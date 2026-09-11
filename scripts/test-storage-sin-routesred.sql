-- ===========================================================================
-- Las politicas de Storage no pueden leer tablas que el usuario no lee
-- ===========================================================================
--
-- LA TRAMPA
--
-- Postgres evalua TODAS las politicas permisivas de un comando, no solo la del
-- bucket que le interesa al usuario. Si UNA de ellas consulta una tabla que el
-- rol no puede leer, la operacion entera muere — aunque el usuario estuviera
-- subiendo a un bucket que no tiene nada que ver.
--
-- Eso convierte a cualquier politica de `storage.objects` en un punto unico de
-- fallo para TODO Storage. Por eso el caso 5 no mira permisos: mira que NINGUNA
-- politica nombre una tabla ajena.
--
-- El caso 1 REPRODUCE el 42501 antes de aplicar la correccion. Sin eso los
-- demas pasarian aunque el defecto nunca hubiera existido.
--
--   psql -v ON_ERROR_STOP=1 -f test-storage-sin-routesred.sql
-- ===========================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS routesred;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('prueba.usuario', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('prueba.super', true),'') = 'si' $$;

-- Copia fiel de la de Supabase: la ruta SIN el nombre del archivo.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  _parts := string_to_array(name, '/');
  RETURN _parts[1 : array_length(_parts,1) - 1];
END $$;

GRANT USAGE ON SCHEMA storage, auth, public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), public.is_super_admin(), storage.foldername(text) TO authenticated;

-- OJO: a `routesred` NO se le da USAGE. Es exactamente la situacion real.
CREATE TABLE routesred.transport_provider_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'operator'
);
INSERT INTO routesred.transport_provider_users (transport_provider_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','owner');

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- La politica del bucket de gastos: la del usuario que quiere subir su PDF.
CREATE OR REPLACE FUNCTION public.puede_gestionar_gastos() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('prueba.contador', true),'') = 'si' $$;
GRANT EXECUTE ON FUNCTION public.puede_gestionar_gastos() TO authenticated;

CREATE POLICY gastos_comprobantes_alta ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gastos-comprobantes' AND public.puede_gestionar_gastos());
CREATE POLICY gastos_comprobantes_lectura ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gastos-comprobantes' AND public.puede_gestionar_gastos());

-- Las de RoutesRed, ORIGINALES, copiadas de 20260827003538.
CREATE POLICY "rr_public_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'routesred-public' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner','administrator','operator_manager')
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)));
CREATE POLICY "rr_public_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'routesred-public' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)));
CREATE POLICY "rr_public_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'routesred-public' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)));
-- La OCTAVA politica rr_*, que el fixture no tenia y produccion si. No lee
-- ninguna tabla —el bucket publico se lee y ya— asi que esta migracion no la
-- toca. Estaba ausente aqui y por eso la primera version de la migracion
-- conto 7 de 7 en la prueba y 7 de 8 en produccion, donde reventó.
CREATE POLICY "rr_public_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'routesred-public');

CREATE POLICY "rr_private_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'routesred-private' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text))
    OR public.is_super_admin());
CREATE POLICY "rr_private_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'routesred-private' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text))
    OR public.is_super_admin());
CREATE POLICY "rr_private_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'routesred-private' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text))
    OR public.is_super_admin());
CREATE POLICY "rr_private_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'routesred-private' AND EXISTS (
    SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid() AND tpu.status='active'
    AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text))
    OR public.is_super_admin());

CREATE OR REPLACE FUNCTION public.como_usuario(
  p_uid text, p_sql text, p_super text DEFAULT 'no', p_contador text DEFAULT 'si')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  PERFORM set_config('prueba.usuario', p_uid, true);
  PERFORM set_config('prueba.super', p_super, true);
  PERFORM set_config('prueba.contador', p_contador, true);
  BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
    RETURN v_estado;
  END;
END $$;

-- ===========================================================================
-- 1. EL BUG, REPRODUCIDO: subir al bucket de GASTOS muere por RoutesRed
-- ===========================================================================
DO $$
DECLARE v_r text;
BEGIN
  SET LOCAL ROLE authenticated;
  v_r := public.como_usuario('55555555-0000-0000-0000-000000000005',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''gastos-comprobantes'', ''un-gasto/factura.pdf'')');
  RESET ROLE;

  IF v_r <> '42501' THEN
    RAISE EXCEPTION 'Caso 1: se esperaba 42501 y llego «%». La prueba no reproduce el bug.', v_r;
  END IF;
  RAISE NOTICE 'Caso 1 OK (subir al bucket de gastos muere con 42501 por las politicas de RoutesRed)';
END $$;

-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260911090000_storage_sin_leer_tablas_de_routesred.sql
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 2. Ya se puede subir el comprobante del gasto
-- ===========================================================================
DO $$
DECLARE v_r text; v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  v_r := public.como_usuario('55555555-0000-0000-0000-000000000005',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''gastos-comprobantes'', ''un-gasto/factura.pdf'')');
  RESET ROLE;

  IF v_r <> 'OK' THEN RAISE EXCEPTION 'Caso 2: sigue fallando con «%»', v_r; END IF;
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id='gastos-comprobantes';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Caso 2: no se escribio la fila'; END IF;
  RAISE NOTICE 'Caso 2 OK';
END $$;

-- ===========================================================================
-- 3. Sin el permiso de gastos SIGUE sin poder: el arreglo no abrio nada
-- ===========================================================================
DO $$
DECLARE v_r text;
BEGIN
  SET LOCAL ROLE authenticated;
  v_r := public.como_usuario('55555555-0000-0000-0000-000000000005',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''gastos-comprobantes'', ''otro/x.pdf'')',
    'no', 'no');
  RESET ROLE;

  IF v_r = 'OK' THEN
    RAISE EXCEPTION 'Caso 3: alguien SIN el permiso de gastos pudo subir. El arreglo abrio el bucket.';
  END IF;
  RAISE NOTICE 'Caso 3 OK';
END $$;

-- ===========================================================================
-- 4. Los buckets de RoutesRed conservan EXACTAMENTE su comportamiento
-- ===========================================================================
-- Incluida la rareza que no se toca: la comparacion de carpeta no se cumple
-- nunca, asi que `routesred-public` no deja entrar a nadie —ni al owner— y
-- `routesred-private` solo al super admin, por su `OR` aparte.
DO $$
DECLARE v_owner text; v_priv_owner text; v_priv_super text; v_ajeno text;
BEGIN
  SET LOCAL ROLE authenticated;
  v_owner := public.como_usuario('11111111-0000-0000-0000-000000000001',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''routesred-public'', ''providers/aaaaaaaa-0000-0000-0000-000000000001/logo.png'')');
  v_priv_owner := public.como_usuario('11111111-0000-0000-0000-000000000001',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''routesred-private'', ''providers/aaaaaaaa-0000-0000-0000-000000000001/doc.pdf'')');
  v_priv_super := public.como_usuario('99999999-0000-0000-0000-000000000009',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''routesred-private'', ''providers/aaaaaaaa-0000-0000-0000-000000000001/doc2.pdf'')', 'si');
  v_ajeno := public.como_usuario('77777777-0000-0000-0000-000000000007',
    'INSERT INTO storage.objects (bucket_id, name) VALUES (''routesred-private'', ''providers/aaaaaaaa-0000-0000-0000-000000000001/doc3.pdf'')');
  RESET ROLE;

  IF v_owner = 'OK' THEN
    RAISE EXCEPTION 'Caso 4: el arreglo CAMBIO la semantica: el owner ahora entra a routesred-public y antes no.';
  END IF;
  IF v_priv_owner = 'OK' THEN
    RAISE EXCEPTION 'Caso 4: el arreglo CAMBIO la semantica en routesred-private.';
  END IF;
  IF v_priv_super <> 'OK' THEN
    RAISE EXCEPTION 'Caso 4: el super admin perdio su acceso a routesred-private: «%»', v_priv_super;
  END IF;
  IF v_ajeno = 'OK' THEN
    RAISE EXCEPTION 'Caso 4: un desconocido entro a routesred-private.';
  END IF;
  RAISE NOTICE 'Caso 4 OK';
END $$;

-- ===========================================================================
-- 4b. …y LEER routesred-private tambien se conserva
-- ===========================================================================
-- El caso 4 solo miraba INSERT, y por eso no cazaba que rr_private_read
-- perdiera su `OR is_super_admin()`. Comprobado por mutacion.
DO $$
DECLARE v_super integer; v_ajeno integer;
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM set_config('prueba.usuario', '99999999-0000-0000-0000-000000000009', true);
  PERFORM set_config('prueba.super', 'si', true);
  PERFORM set_config('prueba.contador', 'no', true);
  SELECT count(*) INTO v_super FROM storage.objects WHERE bucket_id = 'routesred-private';

  PERFORM set_config('prueba.super', 'no', true);
  SELECT count(*) INTO v_ajeno FROM storage.objects WHERE bucket_id = 'routesred-private';
  RESET ROLE;

  -- El super admin metio un doc2.pdf en el caso 4.
  IF v_super < 1 THEN
    RAISE EXCEPTION 'Caso 4b: el super admin ya no puede LEER routesred-private (ve % filas)', v_super;
  END IF;
  IF v_ajeno <> 0 THEN
    RAISE EXCEPTION 'Caso 4b: un desconocido lee % filas de routesred-private', v_ajeno;
  END IF;
  RAISE NOTICE 'Caso 4b OK';
END $$;

-- ===========================================================================
-- 5. NINGUNA politica de storage nombra una tabla de routesred
-- ===========================================================================
-- Es la afirmacion general de la que salio todo: una politica que lea una tabla
-- ajena es un punto unico de fallo para TODO Storage, no solo para su bucket.
DO $$
DECLARE v_n integer; v_rr integer; v_faltan text[];
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND (coalesce(qual,'') LIKE '%transport_provider_users%'
      OR coalesce(with_check,'') LIKE '%transport_provider_users%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 5: % politicas de storage siguen leyendo transport_provider_users', v_n;
  END IF;

  -- Las siete reescritas siguen ahi, POR NOMBRE. Contarlas fue lo que fallo:
  -- produccion tiene ocho rr_* porque existe `rr_public_read`, y el fixture
  -- solo copiaba las siete que leen la tabla.
  SELECT array_agg(nombre) INTO v_faltan
  FROM unnest(ARRAY[
    'rr_public_insert','rr_public_update','rr_public_delete',
    'rr_private_read','rr_private_insert','rr_private_update','rr_private_delete'
  ]) AS nombre
  WHERE NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname = nombre);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Caso 5: faltan politicas tras la correccion: %', v_faltan;
  END IF;

  -- Y la que NO se toca sigue intacta.
  SELECT count(*) INTO v_rr FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname = 'rr_public_read';
  IF v_rr <> 1 THEN
    RAISE EXCEPTION 'Caso 5: se toco rr_public_read, que no lee ninguna tabla';
  END IF;
  RAISE NOTICE 'Caso 5 OK';
END $$;

-- ===========================================================================
-- 6. `authenticated` sigue SIN poder leer las tablas de RoutesRed
-- ===========================================================================
-- El arreglo no podia consistir en darle permiso: eso habria abierto los datos
-- de RoutesRed a todo usuario conectado.
DO $$
BEGIN
  IF has_schema_privilege('authenticated','routesred','USAGE') THEN
    RAISE EXCEPTION 'Caso 6: se le dio USAGE sobre routesred a authenticated.';
  END IF;
  IF has_table_privilege('authenticated','routesred.transport_provider_users','SELECT') THEN
    RAISE EXCEPTION 'Caso 6: se le dio SELECT sobre transport_provider_users a authenticated.';
  END IF;
  RAISE NOTICE 'Caso 6 OK';
END $$;

-- ===========================================================================
-- 7. La funcion, probada de frente
-- ===========================================================================
-- A traves de las politicas el filtro de ROLES es invisible: la comparacion de
-- carpeta no se cumple nunca, asi que da igual el rol. Eso hace que una
-- mutacion que borre el filtro sobreviva —comprobado—. Aqui se le pasa a la
-- funcion una carpeta que SI casa, y entonces el rol vuelve a importar.
DO $$
DECLARE
  v_sin_rol boolean; v_con_rol_bueno boolean; v_con_rol_malo boolean;
  v_otra_carpeta boolean; v_desconocido boolean;
  v_carpeta text := 'providers/aaaaaaaa-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('prueba.usuario', '11111111-0000-0000-0000-000000000001', true);

  v_sin_rol       := routesred.carpeta_de_un_proveedor_mio(v_carpeta);
  v_con_rol_bueno := routesred.carpeta_de_un_proveedor_mio(v_carpeta, ARRAY['owner','administrator']);
  v_con_rol_malo  := routesred.carpeta_de_un_proveedor_mio(v_carpeta, ARRAY['operator']);
  v_otra_carpeta  := routesred.carpeta_de_un_proveedor_mio('providers/bbbbbbbb-0000-0000-0000-000000000002');

  PERFORM set_config('prueba.usuario', '77777777-0000-0000-0000-000000000007', true);
  v_desconocido   := routesred.carpeta_de_un_proveedor_mio(v_carpeta);

  IF NOT v_sin_rol THEN
    RAISE EXCEPTION 'Caso 7: un miembro activo no reconoce su propia carpeta';
  END IF;
  IF NOT v_con_rol_bueno THEN
    RAISE EXCEPTION 'Caso 7: el owner no pasa el filtro de roles que lo incluye';
  END IF;
  IF v_con_rol_malo THEN
    RAISE EXCEPTION 'Caso 7: el filtro de ROLES no se aplica: un owner paso como operator.';
  END IF;
  IF v_otra_carpeta THEN
    RAISE EXCEPTION 'Caso 7: la carpeta de OTRO proveedor da verdadero.';
  END IF;
  IF v_desconocido THEN
    RAISE EXCEPTION 'Caso 7: un desconocido reconoce una carpeta ajena.';
  END IF;
  RAISE NOTICE 'Caso 7 OK';
END $$;

-- ===========================================================================
-- 8. El bucket PUBLICO de RoutesRed se sigue leyendo
-- ===========================================================================
-- `rr_public_read` no lee ninguna tabla, asi que esta migracion no la toca —
-- pero si alguien la borrara «de paso», el bucket publico dejaria de leerse y
-- nadie se enteraria hasta que un cliente viera imagenes rotas.
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('routesred-public', 'providers/aaaaaaaa-0000-0000-0000-000000000001/foto.png');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('prueba.usuario', '77777777-0000-0000-0000-000000000007', true);
  PERFORM set_config('prueba.super', 'no', true);
  PERFORM set_config('prueba.contador', 'no', true);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'routesred-public';
  RESET ROLE;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 8: el bucket publico de RoutesRed dejo de leerse (ve % filas)', v_n;
  END IF;
  RAISE NOTICE 'Caso 8 OK';
END $$;

ROLLBACK;

\echo 'Storage sin leer tablas de RoutesRed: 9/9 casos OK'
