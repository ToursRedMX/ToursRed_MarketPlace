
-- Add new columns to users table
DO $$
BEGIN
  -- Add curp column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'curp'
  ) THEN
    ALTER TABLE users ADD COLUMN curp text;
  END IF;

  -- Add passport_number column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'passport_number'
  ) THEN
    ALTER TABLE users ADD COLUMN passport_number text;
  END IF;

  -- Add is_foreign_traveler column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_foreign_traveler'
  ) THEN
    ALTER TABLE users ADD COLUMN is_foreign_traveler boolean DEFAULT false;
  END IF;
END $$;

-- Create unique indexes for CURP and passport_number
CREATE UNIQUE INDEX IF NOT EXISTS users_curp_unique 
ON users (curp) 
WHERE curp IS NOT NULL AND curp != '';

CREATE UNIQUE INDEX IF NOT EXISTS users_passport_number_unique 
ON users (passport_number) 
WHERE passport_number IS NOT NULL AND passport_number != '';

-- Add constraint to ensure either CURP or passport is provided
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'users' AND constraint_name = 'users_curp_or_passport_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_curp_or_passport_check;
  END IF;

  -- Add new constraint
  ALTER TABLE users ADD CONSTRAINT users_curp_or_passport_check 
  CHECK (
    (is_foreign_traveler = false AND curp IS NOT NULL AND curp != '' AND passport_number IS NULL) OR
    (is_foreign_traveler = true AND passport_number IS NOT NULL AND passport_number != '' AND curp IS NULL)
  );
END $$;
