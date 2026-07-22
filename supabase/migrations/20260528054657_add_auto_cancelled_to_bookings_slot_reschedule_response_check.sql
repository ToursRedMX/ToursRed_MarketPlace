ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_slot_reschedule_response_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_slot_reschedule_response_check
  CHECK (slot_reschedule_response = ANY (ARRAY[
    'accepted',
    'rejected',
    'auto_accepted',
    'auto_cancelled',
    'accepted_no_availability',
    'auto_accepted_no_availability'
  ]));
