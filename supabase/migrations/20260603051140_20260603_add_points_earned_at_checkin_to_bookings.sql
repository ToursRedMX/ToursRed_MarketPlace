
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'points_earned_at_checkin'
  ) THEN
    ALTER TABLE bookings ADD COLUMN points_earned_at_checkin integer NOT NULL DEFAULT 0;
  END IF;
END $$;
