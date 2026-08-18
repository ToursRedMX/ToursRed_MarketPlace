/*
# AAL2 Enforcement on Protected Tables (Write Policies)

## Summary
Modifies the write policies (INSERT/UPDATE/DELETE) on 9 sensitive tables to require AAL2
when the MFA toggle is active for the user's role.

## Pattern
Each affected policy gets an additional condition:
  AND (NOT public.requires_aal2_check() OR public.has_aal2())

This means:
- If the toggle is OFF (mfa_required_for_admins = false): requires_aal2_check() returns false,
  NOT false = true, the whole expression is true → no change in behavior.
- If the toggle is ON AND user is admin/accountant: requires_aal2_check() returns true,
  so has_aal2() must also return true (AAL2 required) to allow the write.
- If the toggle is ON AND user is NOT admin/accountant: requires_aal2_check() returns false,
  no AAL2 requirement.

## Important
- SELECT policies are NOT modified — admins can always read.
- service_role policies are NOT modified — service_role bypasses RLS entirely.
- Only policies TO authenticated are modified.

## ROLLBACK
To revert these changes, run:
  supabase/migrations_rollback/rollback_aal2_rls_policies.sql
which drops the modified policies and recreates the originals without the AAL2 check.
*/

-- ============================================================================
-- platform_settings: UPDATE policy for admin
-- ============================================================================
DROP POLICY IF EXISTS "Admin can update platform settings" ON public.platform_settings;
CREATE POLICY "Admin can update platform settings" ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user() AND (NOT public.requires_aal2_check() OR public.has_aal2()));

-- ============================================================================
-- email_settings: UPDATE policy for admin
-- ============================================================================
DROP POLICY IF EXISTS "Admin can update email settings" ON public.email_settings;
CREATE POLICY "Admin can update email settings" ON public.email_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user() AND (NOT public.requires_aal2_check() OR public.has_aal2()));

-- ============================================================================
-- admin_permissions: UPDATE/INSERT/DELETE policies
-- ============================================================================
DROP POLICY IF EXISTS "Admin can update permissions" ON public.admin_permissions;
CREATE POLICY "Admin can update permissions" ON public.admin_permissions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin() AND (NOT public.requires_aal2_check() OR public.has_aal2()));

DROP POLICY IF EXISTS "Admin can insert permissions" ON public.admin_permissions;
CREATE POLICY "Admin can insert permissions" ON public.admin_permissions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() AND (NOT public.requires_aal2_check() OR public.has_aal2()));

DROP POLICY IF EXISTS "Admin can delete permissions" ON public.admin_permissions;
CREATE POLICY "Admin can delete permissions" ON public.admin_permissions
  FOR DELETE TO authenticated
  USING (public.is_super_admin() AND (NOT public.requires_aal2_check() OR public.has_aal2()));

-- ============================================================================
-- chart_of_accounts: INSERT/UPDATE/DELETE policies
-- ============================================================================
DROP POLICY IF EXISTS "Admin and accountant can insert chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin and accountant can insert chart of accounts" ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

DROP POLICY IF EXISTS "Admin and accountant can update chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin and accountant can update chart of accounts" ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

DROP POLICY IF EXISTS "Admin and accountant can delete chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin and accountant can delete chart of accounts" ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

-- ============================================================================
-- accounting_entries: INSERT/UPDATE policies (already have admin/accountant check)
-- ============================================================================
DROP POLICY IF EXISTS "Admin and accountant can insert accounting entries" ON public.accounting_entries;
CREATE POLICY "Admin and accountant can insert accounting entries" ON public.accounting_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

DROP POLICY IF EXISTS "Admin and accountant can update accounting entries" ON public.accounting_entries;
CREATE POLICY "Admin and accountant can update accounting entries" ON public.accounting_entries
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

-- ============================================================================
-- accounting_entry_lines: INSERT/UPDATE/DELETE policies
-- ============================================================================
DROP POLICY IF EXISTS "Admin and accountant can insert accounting entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can insert accounting entry lines" ON public.accounting_entry_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

DROP POLICY IF EXISTS "Admin and accountant can update accounting entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can update accounting entry lines" ON public.accounting_entry_lines
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );

DROP POLICY IF EXISTS "Admin and accountant can delete accounting entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can delete accounting entry lines" ON public.accounting_entry_lines
  FOR DELETE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'accountant')))
    AND (NOT public.requires_aal2_check() OR public.has_aal2())
  );
