
-- Allow admins to read all commission records
CREATE POLICY "Admins can read all commission records"
  ON commission_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
