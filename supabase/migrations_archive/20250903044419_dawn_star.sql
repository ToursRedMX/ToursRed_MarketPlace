-- Add policy to allow admins to insert destination images
CREATE POLICY "Admins can insert destination images"
  ON destination_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Update existing admin policy to include INSERT operations
DROP POLICY IF EXISTS "Admins can delete destination images" ON destination_images;
DROP POLICY IF EXISTS "Admins can manage destination images" ON destination_images;

-- Create comprehensive admin policy for all operations
CREATE POLICY "Admins can manage all destination images"
  ON destination_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );
