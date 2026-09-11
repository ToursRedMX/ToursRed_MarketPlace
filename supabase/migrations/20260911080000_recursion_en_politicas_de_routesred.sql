-- ============================================================================
-- Recursion infinita en las politicas de RoutesRed
-- ============================================================================
--
-- EL SINTOMA, Y POR QUE APARECIO TAN TARDE
--
-- Al subir un archivo a CUALQUIER bucket desde el navegador, Storage devuelve
-- 400 con «The database schema is invalid or incompatible». Detras, Postgres:
--
--     42P17: infinite recursion detected in policy for relation
--            "transport_provider_users"
--
-- La causa esta en `20260827003435_routesred_provider_helpers_and_policies`:
--
--     CREATE POLICY "tpu_select_members"
--       ON routesred.transport_provider_users FOR SELECT TO authenticated
--       USING (user_id = auth.uid()
--         OR EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2 ...));
--
-- **La politica que protege la tabla consulta esa misma tabla.** Para leer una
-- fila hay que leer la tabla, y para eso hay que leer la tabla. Las cuatro
-- politicas de `transport_provider_users` tienen el mismo defecto.
--
-- POR QUE SE LLEVA POR DELANTE A STORAGE
--
-- `storage.objects` tiene siete politicas de RoutesRed (`rr_private_*`,
-- `rr_public_*`) que leen `transport_provider_users`. Postgres evalua TODAS las
-- politicas permisivas de un comando, no solo la del bucket que le interesa al
-- usuario, asi que una subida al bucket de gastos tambien dispara las de
-- RoutesRed — y revienta.
--
-- Resultado: desde el 27-ago-2026 ningun usuario puede tocar Storage desde el
-- navegador, en NINGUN bucket. No se noto porque hasta hoy todo lo que subia
-- archivos lo hacia del lado del servidor, con `service_role`, que tiene
-- `rolbypassrls` y por eso nunca evalua una politica.
--
-- Y RoutesRed entero —vehiculos, conductores, documentos, imagenes— lleva ese
-- tiempo caido para sus propios usuarios.
--
-- ----------------------------------------------------------------------------
-- LA CORRECCION YA ESTABA ESCRITA
-- ----------------------------------------------------------------------------
--
-- Ese mismo archivo, cincuenta lineas mas arriba, define
-- `routesred.is_provider_member(provider, roles)`: SECURITY DEFINER, propiedad
-- de `postgres`, y la tabla no tiene FORCE ROW LEVEL SECURITY. Es decir, corre
-- como dueña y NO evalua las politicas: rompe el ciclo. Las politicas
-- simplemente no la llamaban.
--
-- Aqui se reescriben las cuatro para usarla. Las otras treinta politicas que
-- leen esta tabla —`drivers`, `vehicles`, `vehicle_images`,
-- `provider_documents`, `transport_providers`, `provider_agency_links` y las
-- siete de `storage.objects`— se curan solas: dejan de tropezar con una tabla
-- que revienta. No se tocan.
--
-- **Los permisos no cambian.** Cada politica sigue diciendo exactamente lo
-- mismo que decia; lo unico que cambia es como lo averigua.
--
-- No es la primera vez en este repo: `20251229171351` arreglo esta misma clase
-- de recursion en `users`, y con el mismo remedio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La funcion, marcada STABLE
-- ---------------------------------------------------------------------------
-- Se redefine solo para añadir STABLE. Sin eso Postgres la trata como VOLATILE
-- y la ejecuta UNA VEZ POR FILA en cada politica que la use — incluidas las de
-- `storage.objects`, que se evaluan en cada listado de archivos. El cuerpo es
-- el mismo de `20260827003435`.
CREATE OR REPLACE FUNCTION routesred.is_provider_member(
  p_provider_id uuid,
  p_roles text[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO routesred, public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_roles IS NULL THEN
    RETURN EXISTS (SELECT 1 FROM routesred.transport_provider_users
      WHERE transport_provider_id = p_provider_id AND user_id = v_uid AND status = 'active');
  END IF;
  RETURN EXISTS (SELECT 1 FROM routesred.transport_provider_users
    WHERE transport_provider_id = p_provider_id AND user_id = v_uid AND status = 'active'
      AND role = ANY(p_roles));
END;
$$;

GRANT EXECUTE ON FUNCTION routesred.is_provider_member(uuid, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las cuatro politicas, sin recursion
-- ---------------------------------------------------------------------------

-- SELECT: tu propia fila SIEMPRE (aunque estes inactivo: si no, un miembro
-- suspendido no podria ni verse a si mismo), cualquier fila de un proveedor
-- donde militas activo, y todo si eres super admin. Identico a lo anterior.
DROP POLICY IF EXISTS "tpu_select_members" ON routesred.transport_provider_users;
CREATE POLICY "tpu_select_members"
  ON routesred.transport_provider_users FOR SELECT TO authenticated
  USING (
    transport_provider_users.user_id = auth.uid()
    OR routesred.is_provider_member(transport_provider_users.transport_provider_id)
    OR public.is_super_admin()
  );

-- INSERT: alta un owner o un administrator del mismo proveedor.
DROP POLICY IF EXISTS "tpu_insert_admins" ON routesred.transport_provider_users;
CREATE POLICY "tpu_insert_admins"
  ON routesred.transport_provider_users FOR INSERT TO authenticated
  WITH CHECK (
    routesred.is_provider_member(
      transport_provider_users.transport_provider_id, ARRAY['owner','administrator'])
    OR public.is_super_admin()
  );

-- UPDATE: lo mismo, en las dos mitades. Sin el WITH CHECK se podria mover una
-- fila a otro proveedor donde no mandas.
DROP POLICY IF EXISTS "tpu_update_admins" ON routesred.transport_provider_users;
CREATE POLICY "tpu_update_admins"
  ON routesred.transport_provider_users FOR UPDATE TO authenticated
  USING (
    routesred.is_provider_member(
      transport_provider_users.transport_provider_id, ARRAY['owner','administrator'])
    OR public.is_super_admin()
  )
  WITH CHECK (
    routesred.is_provider_member(
      transport_provider_users.transport_provider_id, ARRAY['owner','administrator'])
    OR public.is_super_admin()
  );

-- DELETE: solo el owner. Un administrator no puede echar a nadie.
DROP POLICY IF EXISTS "tpu_delete_owner" ON routesred.transport_provider_users;
CREATE POLICY "tpu_delete_owner"
  ON routesred.transport_provider_users FOR DELETE TO authenticated
  USING (
    routesred.is_provider_member(
      transport_provider_users.transport_provider_id, ARRAY['owner'])
    OR public.is_super_admin()
  );

-- ---------------------------------------------------------------------------
-- 3. Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_recursivas integer;
  v_estable boolean;
BEGIN
  -- Ninguna de las cuatro puede volver a nombrar su propia tabla.
  SELECT count(*) INTO v_recursivas
  FROM pg_policies
  WHERE schemaname = 'routesred' AND tablename = 'transport_provider_users'
    AND (coalesce(qual,'') LIKE '%transport_provider_users%'
      OR coalesce(with_check,'') LIKE '%transport_provider_users%');

  IF v_recursivas > 0 THEN
    RAISE EXCEPTION
      'Quedan % politicas de transport_provider_users que se consultan a si mismas: la recursion sigue viva.',
      v_recursivas;
  END IF;

  SELECT p.provolatile = 's' INTO v_estable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'routesred' AND p.proname = 'is_provider_member';

  IF NOT coalesce(v_estable, false) THEN
    RAISE EXCEPTION 'is_provider_member no quedo STABLE: se ejecutaria una vez por fila.';
  END IF;

  RAISE NOTICE 'OK: politicas de transport_provider_users sin recursion';
END $$;
