-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827195932
--   name:    003_has_role_function.sql
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
-- Migration: 003_has_role_function
-- Purpose: Helper function for RLS policies of Nature Stay and future verticals
-- Schema: public
-- Backwards-compatible: YES (new function, no modifications to existing)
-- ToursRed impact: NONE (ToursRed does not use this function)
-- ============================================================================
--
-- Checks whether the current authenticated user (auth.uid()) has a specific
-- active role on a specific platform.
--
-- Security decisions:
--   - SECURITY INVOKER: runs with the caller's privileges. user_roles has RLS
--     that allows users to see their own roles, so this is safe.
--   - STABLE: does not modify data, results are stable within a transaction.
--   - search_path explicitly set to prevent search_path injection.
--   - Does NOT accept an arbitrary user_id parameter (prevents privilege
--     checking for other users).
--
-- ToursRed continues using users.role directly. This function is for
-- Nature Stay, RoutesRed, and future verticals only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_role(
  p_role     text,
  p_platform text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = p_role
      AND ur.platform = p_platform
      AND ur.is_active = true
  )
;


END
;


$$
;



GRANT EXECUTE ON FUNCTION public.has_role(text, text) TO authenticated
;



;
