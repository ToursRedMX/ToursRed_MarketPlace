-- Fix RLS policies on admin_permissions: super admins have role='admin' + is_super_admin=true,
-- NOT role='super_admin'. Use the is_super_admin_check() helper function or direct column check.

DROP POLICY IF EXISTS "Super admins can insert admin permissions" ON admin_permissions;
DROP POLICY IF EXISTS "Super admins can update admin permissions" ON admin_permissions;
DROP POLICY IF EXISTS "Super admins can delete admin permissions" ON admin_permissions;
DROP POLICY IF EXISTS "Admins and super admins can view admin permissions" ON admin_permissions;

CREATE POLICY "Super admins can insert admin permissions" ON admin_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
        AND users.is_super_admin = true
    )
  );

CREATE POLICY "Super admins can update admin permissions" ON admin_permissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
        AND users.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
        AND users.is_super_admin = true
    )
  );

CREATE POLICY "Super admins can delete admin permissions" ON admin_permissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
        AND users.is_super_admin = true
    )
  );

CREATE POLICY "Admins and super admins can view admin permissions" ON admin_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
        AND users.is_super_admin = true
    )
  );
