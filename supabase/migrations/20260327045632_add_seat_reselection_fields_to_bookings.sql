
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'needs_seat_reselection'
  ) THEN
    ALTER TABLE bookings ADD COLUMN needs_seat_reselection boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'previous_selected_seats'
  ) THEN
    ALTER TABLE bookings ADD COLUMN previous_selected_seats integer[];
  END IF;
END $$;
