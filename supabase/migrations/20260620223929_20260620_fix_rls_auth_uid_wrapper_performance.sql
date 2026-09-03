-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260620223929
--   name:    20260620_fix_rls_auth_uid_wrapper_performance
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

-- Fix performance warnings: replace auth.uid() with (SELECT auth.uid() AS uid) in RLS policies
-- This ensures auth.uid() is evaluated once per query instead of once per row.

-- ============================================================
-- audit_errors
-- ============================================================
DROP POLICY IF EXISTS "audit_errors_select_superadmin" ON public.audit_errors
;


CREATE POLICY "audit_errors_select_superadmin" ON public.audit_errors
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.is_super_admin = true)
  ))
;



-- ============================================================
-- featured_plans
-- ============================================================
DROP POLICY IF EXISTS "admin_all_featured_plans" ON public.featured_plans
;


CREATE POLICY "admin_all_featured_plans" ON public.featured_plans
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



-- ============================================================
-- featured_tour_slots
-- ============================================================
DROP POLICY IF EXISTS "admin_insert_slots" ON public.featured_tour_slots
;


CREATE POLICY "admin_insert_slots" ON public.featured_tour_slots
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



DROP POLICY IF EXISTS "admin_read_all_slots" ON public.featured_tour_slots
;


CREATE POLICY "admin_read_all_slots" ON public.featured_tour_slots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



DROP POLICY IF EXISTS "admin_update_slots" ON public.featured_tour_slots
;


CREATE POLICY "admin_update_slots" ON public.featured_tour_slots
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



DROP POLICY IF EXISTS "agency_read_own_slots" ON public.featured_tour_slots
;


CREATE POLICY "agency_read_own_slots" ON public.featured_tour_slots
  FOR SELECT TO authenticated
  USING (agency_id IN (
    SELECT agencies.id FROM agencies
    WHERE (agencies.user_id = (SELECT auth.uid() AS uid))
  ))
;



-- ============================================================
-- featured_tour_stats
-- ============================================================
DROP POLICY IF EXISTS "admin_all_stats" ON public.featured_tour_stats
;


CREATE POLICY "admin_all_stats" ON public.featured_tour_stats
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



-- ============================================================
-- featured_tour_waitlist
-- ============================================================
DROP POLICY IF EXISTS "admin_all_waitlist" ON public.featured_tour_waitlist
;


CREATE POLICY "admin_all_waitlist" ON public.featured_tour_waitlist
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE (users.id = (SELECT auth.uid() AS uid) AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  ))
;



DROP POLICY IF EXISTS "agency_insert_waitlist" ON public.featured_tour_waitlist
;


CREATE POLICY "agency_insert_waitlist" ON public.featured_tour_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (agency_id IN (
    SELECT agencies.id FROM agencies
    WHERE (agencies.user_id = (SELECT auth.uid() AS uid))
  ))
;



DROP POLICY IF EXISTS "agency_read_own_waitlist" ON public.featured_tour_waitlist
;


CREATE POLICY "agency_read_own_waitlist" ON public.featured_tour_waitlist
  FOR SELECT TO authenticated
  USING (agency_id IN (
    SELECT agencies.id FROM agencies
    WHERE (agencies.user_id = (SELECT auth.uid() AS uid))
  ))
;



-- ============================================================
-- user_auth_providers
-- ============================================================
DROP POLICY IF EXISTS "users_delete_own_providers" ON public.user_auth_providers
;


CREATE POLICY "users_delete_own_providers" ON public.user_auth_providers
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid() AS uid) = user_id)
;



DROP POLICY IF EXISTS "users_insert_own_providers" ON public.user_auth_providers
;


CREATE POLICY "users_insert_own_providers" ON public.user_auth_providers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid() AS uid) = user_id)
;



DROP POLICY IF EXISTS "users_view_own_providers" ON public.user_auth_providers
;


CREATE POLICY "users_view_own_providers" ON public.user_auth_providers
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid() AS uid) = user_id)
;



-- ============================================================
-- user_sessions
-- ============================================================
DROP POLICY IF EXISTS "users_read_own_sessions" ON public.user_sessions
;


CREATE POLICY "users_read_own_sessions" ON public.user_sessions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid() AS uid) = user_id)
;



;
