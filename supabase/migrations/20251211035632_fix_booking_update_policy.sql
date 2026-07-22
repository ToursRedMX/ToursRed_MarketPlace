
-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can update own bookings" ON bookings;

-- Create a more permissive policy for updates
-- This allows authenticated users to update their own bookings
-- The USING clause ensures they can only update bookings they own
CREATE POLICY "Users can update own bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
