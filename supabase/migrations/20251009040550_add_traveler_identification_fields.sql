
-- Add identification fields to users table
DO $$
BEGIN
  -- Add CURP field for national travelers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'curp'
  ) THEN
    ALTER TABLE users ADD COLUMN curp text;
  END IF;

  -- Add passport number for foreign travelers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'passport_number'
  ) THEN
    ALTER TABLE users ADD COLUMN passport_number text;
  END IF;

  -- Add phone number for all travelers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone_number'
  ) THEN
    ALTER TABLE users ADD COLUMN phone_number text;
  END IF;

  -- Add flag to identify foreign vs national travelers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_foreign_traveler'
  ) THEN
    ALTER TABLE users ADD COLUMN is_foreign_traveler boolean DEFAULT false;
  END IF;
END $$;
