-- Drop the recursive policy
DROP POLICY IF EXISTS "Travelers can view target slots in pending reschedule requests" ON tour_slots;

-- Replace with a non-recursive version: check slot_reschedule_responses directly
-- A traveler can see a target slot if they have a response record pointing to it
CREATE POLICY "Travelers can view target slots via their responses"
  ON tour_slots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM slot_reschedule_requests srq
      WHERE srq.target_slot_id = tour_slots.id
        AND EXISTS (
          SELECT 1
          FROM slot_reschedule_responses srr
          WHERE srr.request_id = srq.id
            AND srr.user_id = (SELECT auth.uid())
        )
    )
  );
