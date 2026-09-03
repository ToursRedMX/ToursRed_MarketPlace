
DROP POLICY IF EXISTS "Users agencies and admins can read bookings" ON bookings;

CREATE POLICY "Users agencies and admins can read bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR
    current_user_has_role(ARRAY['admin'::text])
  );
