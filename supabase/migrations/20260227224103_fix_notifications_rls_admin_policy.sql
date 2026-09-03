-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260227224103
--   name:    fix_notifications_rls_admin_policy
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
  # Fix notifications RLS - admin policy uses FOR ALL incorrectly

  ## Summary
  The "Admins can view all notifications" policy was using FOR ALL which
  incorrectly applies to INSERT/UPDATE/DELETE as well as SELECT.
  This caused conflicts with the "System can create notifications" policy.
  Splitting into proper per-operation policies.

  ## Changes
  - Drop the incorrect FOR ALL admin policy
  - Create a proper FOR SELECT policy for admins
*/

DROP POLICY IF EXISTS "Admins can view all notifications" ON public.notifications
;



CREATE POLICY "Admins can view all notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'super_admin')
  ))
;



;
