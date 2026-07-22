
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'travel_insurance_included'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN travel_insurance_included boolean DEFAULT false,
      ADD COLUMN travel_insurance_cost decimal(10,2) DEFAULT 0,
      ADD COLUMN insurance_email_sent boolean DEFAULT false;
  END IF;
END $$;
