

CREATE POLICY "Agencies can view travelers with bookings"
ON users
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    INNER JOIN agencies a ON b.agency_id = a.id
    WHERE b.user_id = users.id
    AND a.user_id = auth.uid()
  )
);
