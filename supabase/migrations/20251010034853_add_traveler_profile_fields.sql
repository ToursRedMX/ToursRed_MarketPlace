-- Add date of birth and address fields to users table
DO $$
BEGIN
  -- Add date of birth field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE users ADD COLUMN date_of_birth date;
  END IF;

  -- Add address field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'address'
  ) THEN
    ALTER TABLE users ADD COLUMN address text;
  END IF;
END $$;
