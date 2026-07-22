
-- Add policy for admins to update commission_rate
CREATE POLICY "Admins can update agency commission"
  ON agencies FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
