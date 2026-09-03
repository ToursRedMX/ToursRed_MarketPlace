
-- Add departure_time column (stores time without date)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tour_departure_points' AND column_name = 'departure_time'
  ) THEN
    ALTER TABLE tour_departure_points
    ADD COLUMN departure_time time;
  END IF;
END $$;

-- Add special_instructions column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tour_departure_points' AND column_name = 'special_instructions'
  ) THEN
    ALTER TABLE tour_departure_points
    ADD COLUMN special_instructions text;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN tour_departure_points.departure_time IS 'Time of day when the tour departs from this point (optional)';
COMMENT ON COLUMN tour_departure_points.special_instructions IS 'Special instructions or reference points for travelers (optional)';
