
-- Allow account executives to read bookings for agencies they manage
-- (needed to show booking counts in ExecutiveMisAgencias)
CREATE POLICY "Account executives can read their agencies bookings"
ON bookings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM agencies a
    JOIN account_executives ae ON ae.id = a.account_executive_id
    WHERE a.id = bookings.agency_id
      AND ae.user_id = (SELECT auth.uid())
  )
);
