
-- Add unique constraint to passport_number field (only for non-null values)
DO $$
BEGIN
  -- Check if the constraint doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_passport_number_unique' AND conrelid = 'users'::regclass
  ) THEN
    -- Add the unique constraint
    ALTER TABLE users ADD CONSTRAINT users_passport_number_unique UNIQUE (passport_number);
  END IF;
END $$;

-- Create an index for better performance on passport_number lookups (only non-null values)
CREATE INDEX IF NOT EXISTS idx_users_passport_number_not_null 
ON users (passport_number) 
WHERE passport_number IS NOT NULL;
