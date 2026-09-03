-- Add is_super_admin column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;

-- Add policy for super admins to view all users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Super admins can view all users'
  ) THEN
    CREATE POLICY "Super admins can view all users"
      ON users
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.is_super_admin = true
        )
      );
  END IF;
END $$;
