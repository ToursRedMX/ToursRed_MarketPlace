
-- Add notifications to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Add DELETE policy for users to delete their own notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications'
      AND schemaname = 'public'
      AND policyname = 'Users can delete their own notifications'
  ) THEN
    CREATE POLICY "Users can delete their own notifications"
      ON notifications
      FOR DELETE
      TO authenticated
      USING ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

-- Fix SELECT policy to avoid recursion: use auth.jwt() for role check instead of querying users table
DROP POLICY IF EXISTS "Users and admins can view notifications" ON notifications;

CREATE POLICY "Users and admins can view notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (auth.jwt() ->> 'role') IN ('admin', 'super_admin')
  );
