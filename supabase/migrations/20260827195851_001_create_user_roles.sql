-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827195851
--   name:    001_create_user_roles.sql
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

-- ============================================================================
-- Migration: 001_create_user_roles
-- Purpose: Create shared multi-role table for the ecosystem
-- Schema: public
-- Backwards-compatible: YES (new table, no modifications to existing objects)
-- ToursRed impact: NONE
-- ============================================================================
--
-- This table allows a single user to hold multiple roles across multiple
-- platforms simultaneously (e.g. traveler/toursred + host/naturestayred).
--
-- public.users.role remains the legacy authorization source for ToursRed.
-- This table is the new authorization source for Nature Stay and future
-- verticals. No bidirectional sync is created between the two.
--
-- RLS admin policies validate via the LEGACY mechanism (users.role / is_super_admin)
-- to avoid making user_roles self-referencing for admin access.
-- ============================================================================

CREATE TABLE public.user_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        text        NOT NULL,
  platform    text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  granted_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_roles_role_check
    CHECK (role IN ('traveler', 'agency', 'host', 'carrier', 'admin', 'super_admin', 'account_executive')),
  CONSTRAINT user_roles_platform_check
    CHECK (platform IN ('toursred', 'naturestayred', 'routesred', 'global')),
  CONSTRAINT user_roles_revocation_consistency
    CHECK (
      -- Active role: no revocation metadata
      (is_active = true  AND revoked_at IS NULL AND revoked_by IS NULL)
      OR
      -- Revoked role: revocation timestamp required
;

revoked_by nullable
      -- for automatic system revocations
      (is_active = false AND revoked_at IS NOT NULL)
    )
)
;



-- Indexes
CREATE INDEX idx_user_roles_user_id
  ON public.user_roles (user_id)
;



CREATE INDEX idx_user_roles_role_platform
  ON public.user_roles (role, platform)
;



CREATE INDEX idx_user_roles_active_user
  ON public.user_roles (user_id, is_active)
  WHERE is_active = true
;



-- Unique partial index: prevents duplicate ACTIVE roles for the same
-- (user_id, role, platform) combination. Inactive (revoked) records are
-- allowed to coexist for historical audit purposes.
CREATE UNIQUE INDEX idx_user_roles_unique_active
  ON public.user_roles (user_id, role, platform)
  WHERE is_active = true
;



-- updated_at trigger (matches pattern used elsewhere in the codebase)
CREATE OR REPLACE FUNCTION public.update_user_roles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$
;



CREATE TRIGGER trigger_update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_roles_updated_at()
;



-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY
;



-- SELECT: users can see their own roles
;

admins (via legacy mechanism) can see all
CREATE POLICY "users_select_own_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid())
;



CREATE POLICY "admins_select_all_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.role = 'admin' OR u.is_super_admin = true)
    )
  )
;



-- INSERT/UPDATE/DELETE: service_role only (server-side / Edge Functions)
CREATE POLICY "service_role_manage_roles"
  ON public.user_roles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true)
;



-- ============================================================================
-- Permissions
-- ============================================================================
GRANT SELECT ON public.user_roles TO authenticated
;


-- service_role has full access by default in Supabase

;
