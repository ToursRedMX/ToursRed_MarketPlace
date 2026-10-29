-- Quita TRUNCATE a anon y authenticated en todas las tablas de public (hallazgo SEG-02 del pre-UAT, 29-oct-2026).
--
-- Medido el 29-oct contra la base: 17 de las 21 tablas sensibles revisadas (users, payment_transactions, bookings, los monederos,
-- cfdi_invoices, los asientos, agency_payouts, platform_settings, gift_cards...) conservaban los permisos POR DEFECTO de Supabase
-- para anon y authenticated: INSERT, UPDATE, DELETE y TRUNCATE (pg_default_acl de postgres en public: arwdDxt para los dos).
-- INSERT/UPDATE/DELETE los contiene el RLS. TRUNCATE no: PostgreSQL no lo evalua contra las politicas, asi que el unico freno era
-- que la API REST de Supabase no expone TRUNCATE. No es explotable por esa via, pero cualquier funcion SECURITY INVOKER o
-- RPC futuro que lo ejecute con el rol del usuario lo dejaria pasar. Es el mismo patron que se cerro para las tablas del cobro
-- en 20261023071500 y que se documenta en CLAUDE.md (patron 13).
--
-- Que hace:
--   1. Revoca TRUNCATE sobre todas las tablas existentes de public.
--   2. Quita TRUNCATE de los permisos por defecto de las tablas FUTURAS que cree postgres (el rol de las migraciones), para que
--      una tabla nueva no vuelva a nacer con el hueco.
-- Lo que NO hace: no toca SELECT/INSERT/UPDATE/DELETE (el RLS sigue siendo el control) ni al service_role, y no cambia los permisos
-- por defecto de supabase_admin (las tablas que crean las migraciones son de postgres).
-- Nada de la app usa TRUNCATE como anon o authenticated: las funciones SECURITY DEFINER corren como su dueno, no como el usuario.

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- Si quedo alguna tabla con TRUNCATE, la migracion falla en vez de dejarlo a medias.
DO $$
DECLARE
  v_restantes text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_restantes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  IF v_restantes IS NOT NULL THEN
    RAISE EXCEPTION 'Siguen con TRUNCATE para anon o authenticated: %', v_restantes;
  END IF;
END;
$$;
