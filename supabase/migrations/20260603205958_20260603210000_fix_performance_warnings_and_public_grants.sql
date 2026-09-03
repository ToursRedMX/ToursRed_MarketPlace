-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. account_executives: consolidar UPDATE policies
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins can update account executives" ON account_executives;
DROP POLICY IF EXISTS "Executives can update own profile" ON account_executives;

CREATE POLICY "Admins and executives can update account executives"
  ON account_executives
  FOR UPDATE
  TO authenticated
  USING (
    is_admin_with_executive_permission()
    OR user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    is_admin_with_executive_permission()
    OR user_id = (SELECT auth.uid())
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. agencies: consolidar UPDATE policies
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Agencies and admins can update agencies" ON agencies;
DROP POLICY IF EXISTS "Executives can update their registered agencies" ON agencies;

CREATE POLICY "Agencies admins and executives can update agencies"
  ON agencies
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role IN ('admin', 'super_admin')
    )
    OR account_executive_id IN (
      SELECT ae.id FROM account_executives ae
      WHERE ae.user_id = (SELECT auth.uid())
        AND ae.is_active = true
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role IN ('admin', 'super_admin')
    )
    OR account_executive_id IN (
      SELECT ae.id FROM account_executives ae
      WHERE ae.user_id = (SELECT auth.uid())
        AND ae.is_active = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Revocar PUBLIC de las 4 funciones abiertas a anon
--    La causa raíz: migración anterior revocaba FROM anon pero no FROM PUBLIC.
--    Mientras PUBLIC tenga EXECUTE, anon lo hereda vía membresía a PUBLIC.
-- ═══════════════════════════════════════════════════════════════════════════════

-- is_admin_with_executive_permission: necesita authenticated (usada en RLS y React)
REVOKE EXECUTE ON FUNCTION is_admin_with_executive_permission() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_admin_with_executive_permission() FROM anon;
GRANT  EXECUTE ON FUNCTION is_admin_with_executive_permission() TO authenticated;

-- get_executive_id_for_user: necesita authenticated (usada en RLS policies)
REVOKE EXECUTE ON FUNCTION get_executive_id_for_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_executive_id_for_user(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION get_executive_id_for_user(uuid) TO authenticated;

-- get_garbage_bookings: necesita authenticated (llamada desde React admin)
REVOKE EXECUTE ON FUNCTION get_garbage_bookings(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_garbage_bookings(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION get_garbage_bookings(integer) TO authenticated;

-- generate_and_notify_platform_commissions: necesita authenticated (React admin)
REVOKE EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) TO authenticated;
