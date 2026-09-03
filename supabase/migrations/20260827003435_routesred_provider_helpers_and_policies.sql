-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003435
--   name:    routesred_provider_helpers_and_policies
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
# RoutesRed — Provider Helper Functions + RLS Policies + create_provider RPC

Adds is_provider_member, get_user_provider_role, RLS policies, and atomic create_provider.
*/

-- Helper functions
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

CREATE OR REPLACE FUNCTION routesred.get_user_provider_role(p_provider_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO routesred, public AS $$
DECLARE v_uid uuid := auth.uid(); v_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO v_role FROM routesred.transport_provider_users
  WHERE transport_provider_id = p_provider_id AND user_id = v_uid AND status = 'active';
  RETURN v_role;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.get_user_provider_role(uuid) TO authenticated;

-- RLS: transport_providers SELECT
DROP POLICY IF EXISTS "tp_select_members" ON routesred.transport_providers;
CREATE POLICY "tp_select_members"
  ON routesred.transport_providers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = transport_providers.id AND tpu.user_id = auth.uid() AND tpu.status = 'active')
    OR public.is_super_admin());

-- RLS: transport_providers UPDATE
DROP POLICY IF EXISTS "tp_update_members" ON routesred.transport_providers;
CREATE POLICY "tp_update_members"
  ON routesred.transport_providers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = transport_providers.id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator')) OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = transport_providers.id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator')) OR public.is_super_admin());

-- RLS: transport_provider_users SELECT
DROP POLICY IF EXISTS "tpu_select_members" ON routesred.transport_provider_users;
CREATE POLICY "tpu_select_members"
  ON routesred.transport_provider_users FOR SELECT TO authenticated
  USING (transport_provider_users.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
      WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
      AND tpu2.user_id = auth.uid() AND tpu2.status = 'active') OR public.is_super_admin());

-- RLS: transport_provider_users INSERT
DROP POLICY IF EXISTS "tpu_insert_admins" ON routesred.transport_provider_users;
CREATE POLICY "tpu_insert_admins"
  ON routesred.transport_provider_users FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role IN ('owner', 'administrator')) OR public.is_super_admin());

-- RLS: transport_provider_users UPDATE
DROP POLICY IF EXISTS "tpu_update_admins" ON routesred.transport_provider_users;
CREATE POLICY "tpu_update_admins"
  ON routesred.transport_provider_users FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role IN ('owner', 'administrator')) OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role IN ('owner', 'administrator')) OR public.is_super_admin());

-- RLS: transport_provider_users DELETE
DROP POLICY IF EXISTS "tpu_delete_owner" ON routesred.transport_provider_users;
CREATE POLICY "tpu_delete_owner"
  ON routesred.transport_provider_users FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu2
    WHERE tpu2.transport_provider_id = transport_provider_users.transport_provider_id
    AND tpu2.user_id = auth.uid() AND tpu2.status = 'active'
    AND tpu2.role = 'owner') OR public.is_super_admin());

-- create_provider RPC (SECURITY DEFINER, atomic)
CREATE OR REPLACE FUNCTION routesred.create_provider(
  p_provider_type text,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_legal_name text DEFAULT NULL,
  p_trade_name text DEFAULT NULL,
  p_rfc text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_cover_image_url text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_legal_representative text DEFAULT NULL
)
RETURNS routesred.transport_providers
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO routesred, public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider routesred.transport_providers;
  v_slug text; v_name text; v_base text; v_counter integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_provider_type NOT IN ('individual', 'company') THEN RAISE EXCEPTION 'Invalid provider_type'; END IF;
  IF p_provider_type = 'individual' THEN
    IF p_first_name IS NULL OR trim(p_first_name) = '' THEN RAISE EXCEPTION 'first_name required for individual'; END IF;
  ELSE
    IF p_legal_name IS NULL OR trim(p_legal_name) = '' THEN RAISE EXCEPTION 'legal_name required for company'; END IF;
  END IF;
  v_name := COALESCE(NULLIF(trim(p_trade_name), ''), NULLIF(trim(p_legal_name), ''), trim(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')));
  v_base := lower(trim(v_name));
  v_base := regexp_replace(v_base, '[^a-z0-9\s-]', '', 'g');
  v_base := regexp_replace(v_base, '[\s_-]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  IF v_base = '' OR v_base IS NULL THEN v_base := 'proveedor'; END IF;
  v_slug := v_base;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM routesred.transport_providers WHERE slug = v_slug) THEN EXIT; END IF;
    v_counter := v_counter + 1;
    v_slug := v_base || '-' || v_counter::text;
  END LOOP;
  INSERT INTO routesred.transport_providers (
    owner_user_id, provider_type, first_name, last_name, legal_name, legal_representative,
    trade_name, slug, rfc, description, logo_url, cover_image_url,
    phone, email, website, state, city, address, postal_code
  ) VALUES (
    v_uid, p_provider_type, p_first_name, p_last_name, p_legal_name, p_legal_representative,
    p_trade_name, v_slug, p_rfc, p_description, p_logo_url, p_cover_image_url,
    p_phone, p_email, p_website, p_state, p_city, p_address, p_postal_code
  ) RETURNING * INTO v_provider;
  INSERT INTO routesred.transport_provider_users (transport_provider_id, user_id, role, status, joined_at)
  VALUES (v_provider.id, v_uid, 'owner', 'active', now());
  RETURN v_provider;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.create_provider(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text
) TO authenticated;

;
