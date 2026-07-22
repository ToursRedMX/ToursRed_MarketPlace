
CREATE POLICY "Travelers can view slots from own bookings"
  ON tour_slots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.slot_id = tour_slots.id
        AND b.user_id = (SELECT auth.uid())
    )
  );
