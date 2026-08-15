-- Add INSERT policy for agencies table
CREATE POLICY "Agencies can create own profile"
  ON agencies
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
