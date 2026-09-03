
-- Add policy for super admins to update users
CREATE POLICY "Super admins can update users"
  ON users
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
