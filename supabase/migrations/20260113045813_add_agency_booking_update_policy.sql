
-- Create policy allowing agencies to update their bookings
CREATE POLICY "Agencies can update own tour bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = bookings.agency_id
      AND user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = bookings.agency_id
      AND user_id = (select auth.uid())
    )
  );
