-- ============================================================
-- accounting_access_invitations
-- ============================================================
DROP POLICY IF EXISTS "Admins can view accounting invitations" ON public.accounting_access_invitations;
CREATE POLICY "Admins can view accounting invitations"
  ON public.accounting_access_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can insert accounting invitations" ON public.accounting_access_invitations;
CREATE POLICY "Admins can insert accounting invitations"
  ON public.accounting_access_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update accounting invitations" ON public.accounting_access_invitations;
CREATE POLICY "Admins can update accounting invitations"
  ON public.accounting_access_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    )
  );

-- ============================================================
-- users — política del contador
-- ============================================================
DROP POLICY IF EXISTS "Accountant can view own profile" ON public.users;
CREATE POLICY "Accountant can view own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR (
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = (SELECT auth.uid())
          AND u.role IN ('admin', 'accountant')
      )
    )
  );
