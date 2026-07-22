
-- Add tour_code column to international_tour_inquiries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'international_tour_inquiries' AND column_name = 'tour_code'
  ) THEN
    ALTER TABLE international_tour_inquiries ADD COLUMN tour_code text;
  END IF;
END $$;
