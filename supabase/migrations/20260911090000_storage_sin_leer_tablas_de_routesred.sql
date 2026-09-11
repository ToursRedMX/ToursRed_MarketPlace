-- ============================================================================
-- Las politicas de Storage de RoutesRed no pueden leer sus tablas
-- ============================================================================
--
-- EL SEGUNDO PROBLEMA, QUE EL PRIMERO TAPABA
--
-- `20260911080000` mato la recursion infinita. Debajo habia otra cosa: subir un
-- archivo a cualquier bucket seguia fallando, ahora con
--
--     42501: permission denied for table transport_provider_users
--
-- Las siete politicas de `storage.objects` que puso RoutesRed
-- (`20260827003538`) hacen `EXISTS (SELECT 1 FROM
-- routesred.transport_provider_users ...)`. Esa subconsulta corre con los
-- permisos de QUIEN CONSULTA, y `authenticated`:
--
--     usa el esquema routesred ............... NO
--     lee transport_provider_users .......... NO
--
-- Y como Postgres evalua TODAS las politicas permisivas de un comando —no solo
-- la del bucket que le interesa al usuario—, una subida al bucket de gastos
-- tambien las dispara y muere ahi. Es el mismo mecanismo que la recursion, con
-- otro error.
--
-- ----------------------------------------------------------------------------
-- LA CORRECCION: PREGUNTAR SIN LEER
-- ----------------------------------------------------------------------------
--
-- Se mueve el `EXISTS` a una funcion SECURITY DEFINER, que corre con los
-- permisos de su dueña (`postgres`) y por tanto si puede leer la tabla.
-- `authenticated` solo necesita EXECUTE, que es lo unico que se le concede: no
-- gana acceso a ninguna tabla de RoutesRed.
--
-- ----------------------------------------------------------------------------
-- LO QUE **NO** SE ARREGLA, A PROPOSITO
-- ----------------------------------------------------------------------------
--
-- La condicion original compara el PRIMER segmento de la ruta con
-- `'providers/' || provider_id`:
--
--     (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
--
-- `storage.foldername('providers/<uuid>/doc.pdf')` devuelve `{providers,<uuid>}`,
-- asi que `[1]` es `'providers'` — que nunca puede ser igual a
-- `'providers/<uuid>'`. **Ese EXISTS no se cumple jamas.** Hoy, en la practica:
-- `routesred-public` no deja entrar a nadie y `routesred-private` solo al super
-- admin, por el `OR is_super_admin()` que va aparte.
--
-- Se conserva TAL CUAL. Corregirlo daria acceso a gente que hoy no lo tiene, y
-- eso es una decision de producto sobre un modulo que esta en pausa, no una
-- correccion tecnica. Aqui solo se busca que RoutesRed deje de romper a los
-- demas buckets. Queda anotado para cuando RoutesRed se retome.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La pregunta, sin leer la tabla desde fuera
-- ---------------------------------------------------------------------------
-- Devuelve exactamente lo que devolvia el EXISTS original, incluida su rareza:
-- compara la carpeta recibida contra `'providers/' || provider_id`.
CREATE OR REPLACE FUNCTION routesred.carpeta_de_un_proveedor_mio(
  p_carpeta text,
  p_roles   text[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO routesred, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM routesred.transport_provider_users tpu
    WHERE tpu.user_id = auth.uid()
      AND tpu.status = 'active'
      AND (p_roles IS NULL OR tpu.role = ANY(p_roles))
      AND p_carpeta = 'providers/' || tpu.transport_provider_id::text
  );
$$;

REVOKE ALL ON FUNCTION routesred.carpeta_de_un_proveedor_mio(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION routesred.carpeta_de_un_proveedor_mio(text, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. routesred-public: owner, administrator y operator_manager
-- ---------------------------------------------------------------------------
-- Sin `OR is_super_admin()`: el original tampoco lo tenia en este bucket.
DROP POLICY IF EXISTS "rr_public_insert" ON storage.objects;
CREATE POLICY "rr_public_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'routesred-public'
    AND routesred.carpeta_de_un_proveedor_mio(
          (storage.foldername(name))[1],
          ARRAY['owner','administrator','operator_manager'])
  );

DROP POLICY IF EXISTS "rr_public_update" ON storage.objects;
CREATE POLICY "rr_public_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'routesred-public'
    AND routesred.carpeta_de_un_proveedor_mio(
          (storage.foldername(name))[1],
          ARRAY['owner','administrator','operator_manager'])
  )
  WITH CHECK (
    bucket_id = 'routesred-public'
    AND routesred.carpeta_de_un_proveedor_mio(
          (storage.foldername(name))[1],
          ARRAY['owner','administrator','operator_manager'])
  );

DROP POLICY IF EXISTS "rr_public_delete" ON storage.objects;
CREATE POLICY "rr_public_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'routesred-public'
    AND routesred.carpeta_de_un_proveedor_mio(
          (storage.foldername(name))[1],
          ARRAY['owner','administrator','operator_manager'])
  );

-- ---------------------------------------------------------------------------
-- 3. routesred-private: cualquier miembro activo, o el super admin
-- ---------------------------------------------------------------------------
-- El parentesis importa y replica la precedencia del original: `AND` ata mas
-- fuerte que `OR`, asi que el super admin entra INDEPENDIENTEMENTE del bucket.
-- Se conserva; cambiarlo seria cerrarle una puerta que hoy tiene abierta.
DROP POLICY IF EXISTS "rr_private_read" ON storage.objects;
CREATE POLICY "rr_private_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    (bucket_id = 'routesred-private'
     AND routesred.carpeta_de_un_proveedor_mio((storage.foldername(name))[1]))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_insert" ON storage.objects;
CREATE POLICY "rr_private_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    (bucket_id = 'routesred-private'
     AND routesred.carpeta_de_un_proveedor_mio((storage.foldername(name))[1]))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_update" ON storage.objects;
CREATE POLICY "rr_private_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    (bucket_id = 'routesred-private'
     AND routesred.carpeta_de_un_proveedor_mio((storage.foldername(name))[1]))
    OR public.is_super_admin()
  )
  WITH CHECK (
    (bucket_id = 'routesred-private'
     AND routesred.carpeta_de_un_proveedor_mio((storage.foldername(name))[1]))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_delete" ON storage.objects;
CREATE POLICY "rr_private_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    (bucket_id = 'routesred-private'
     AND routesred.carpeta_de_un_proveedor_mio((storage.foldername(name))[1]))
    OR public.is_super_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer;
BEGIN
  -- NINGUNA politica de storage puede nombrar una tabla de routesred: el rol
  -- que consulta no tiene permiso para leerla, y el error se come la operacion
  -- entera, sea cual sea el bucket.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual,'') LIKE '%transport_provider_users%'
      OR coalesce(with_check,'') LIKE '%transport_provider_users%');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'Quedan % politicas de storage.objects leyendo transport_provider_users: seguiran rompiendo TODOS los buckets.', v_n;
  END IF;

  -- Y las siete siguen existiendo: quitarlas seria abrir los buckets de
  -- RoutesRed, no arreglarlos.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rr\_%';
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'Se esperaban 7 politicas rr_* y hay %.', v_n;
  END IF;

  RAISE NOTICE 'OK: storage.objects ya no lee tablas de routesred';
END $$;
