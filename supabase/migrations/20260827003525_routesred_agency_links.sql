-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003525
--   name:    routesred_agency_links
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
# RoutesRed — Provider Agency Links

Creates routesred.provider_agency_links for optional linking between RoutesRed
transport providers and ToursRed agencies. Linking requires the user to be
owner/admin of the provider AND owner of the agency or staff with sufficient
permissions (can_view_financials as proxy for management authority).

Also creates the link_provider_agency SECURITY DEFINER RPC.
*/

CREATE TABLE IF NOT EXISTS routesred.provider_agency_links (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id  uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  agency_id              uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'active',
  linked_by              uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  verified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pal_status_check CHECK (status IN ('active', 'inactive', 'pending')),
  CONSTRAINT pal_unique UNIQUE (transport_provider_id, agency_id)
);

CREATE INDEX IF NOT EXISTS pal_provider_idx ON routesred.provider_agency_links (transport_provider_id);
CREATE INDEX IF NOT EXISTS pal_agency_idx ON routesred.provider_agency_links (agency_id);

ALTER TABLE routesred.provider_agency_links ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT — members of the provider OR agency owner/staff OR admin
DROP POLICY IF EXISTS "pal_select_authorized" ON routesred.provider_agency_links;
CREATE POLICY "pal_select_authorized"
  ON routesred.provider_agency_links FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.transport_provider_id = provider_agency_links.transport_provider_id
      AND tpu.user_id = auth.uid() AND tpu.status = 'active')
    OR EXISTS (SELECT 1 FROM public.agencies a
      WHERE a.id = provider_agency_links.agency_id AND a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.agency_staff ast
      WHERE ast.agency_id = provider_agency_links.agency_id
      AND ast.user_id = auth.uid() AND ast.is_active = true)
    OR public.is_super_admin()
  );

-- No direct INSERT/UPDATE/DELETE — use link_provider_agency RPC
-- (DELETE allowed for owner/admin of provider)
DROP POLICY IF EXISTS "pal_delete_authorized" ON routesred.provider_agency_links;
CREATE POLICY "pal_delete_authorized"
  ON routesred.provider_agency_links FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.transport_provider_id = provider_agency_links.transport_provider_id
      AND tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND tpu.role IN ('owner', 'administrator'))
    OR public.is_super_admin()
  );

-- link_provider_agency RPC (SECURITY DEFINER)
-- Validates: user is owner/admin of provider AND owner of agency or staff with can_view_financials
CREATE OR REPLACE FUNCTION routesred.link_provider_agency(
  p_transport_provider_id uuid,
  p_agency_id uuid
)
RETURNS routesred.provider_agency_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO routesred, public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link routesred.provider_agency_links;
  v_is_provider_admin boolean;
  v_is_agency_authorized boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Check provider authorization (owner or administrator)
  SELECT EXISTS(SELECT 1 FROM routesred.transport_provider_users
    WHERE transport_provider_id = p_transport_provider_id
    AND user_id = v_uid AND status = 'active' AND role IN ('owner', 'administrator'))
  INTO v_is_provider_admin;
  IF NOT v_is_provider_admin THEN RAISE EXCEPTION 'Not authorized for this provider'; END IF;

  -- Check agency authorization (owner OR staff with can_view_financials)
  SELECT EXISTS(
    SELECT 1 FROM public.agencies a WHERE a.id = p_agency_id AND a.user_id = v_uid
  ) OR EXISTS(
    SELECT 1 FROM public.agency_staff ast
    JOIN public.agency_staff_permissions asp ON asp.staff_id = ast.id
    WHERE ast.agency_id = p_agency_id AND ast.user_id = v_uid AND ast.is_active = true
    AND asp.can_view_financials = true
  ) INTO v_is_agency_authorized;
  IF NOT v_is_agency_authorized THEN RAISE EXCEPTION 'Not authorized for this agency'; END IF;

  INSERT INTO routesred.provider_agency_links (transport_provider_id, agency_id, status, linked_by, linked_at)
  VALUES (p_transport_provider_id, p_agency_id, 'active', v_uid, now())
  RETURNING * INTO v_link;

  RETURN v_link;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.link_provider_agency(uuid, uuid) TO authenticated;

;
