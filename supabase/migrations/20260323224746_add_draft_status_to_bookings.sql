
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'pending'::text,
    'confirmed'::text,
    'cancelled'::text,
    'completed'::text,
    'payment_not_received'::text
  ]));
