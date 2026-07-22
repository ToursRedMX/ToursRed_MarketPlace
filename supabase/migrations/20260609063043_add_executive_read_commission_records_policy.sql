
-- Allow account executives to read commission_records for agencies they manage
CREATE POLICY "Account executives can read their agencies commission records"
ON commission_records FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM agencies a
    JOIN account_executives ae ON ae.id = a.account_executive_id
    WHERE a.id = commission_records.agency_id
      AND ae.user_id = (SELECT auth.uid())
  )
);
