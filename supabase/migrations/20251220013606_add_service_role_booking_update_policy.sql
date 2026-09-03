
-- Create a policy that allows service role to update bookings for webhook processing
CREATE POLICY "Service role can update bookings for webhooks"
  ON bookings
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
