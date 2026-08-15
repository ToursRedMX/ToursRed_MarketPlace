
CREATE POLICY "Travelers can view target slots in pending reschedule requests"
  ON tour_slots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM slot_reschedule_requests srq
      JOIN slot_reschedule_responses srr ON srr.request_id = srq.id
      WHERE srq.target_slot_id = tour_slots.id
        AND srr.user_id = (SELECT auth.uid())
    )
  );
