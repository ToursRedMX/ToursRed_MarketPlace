
-- Add unique constraint to CURP field (only for non-null values)
DO $$
BEGIN
  -- Check if the constraint doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_curp_unique' AND conrelid = 'users'::regclass
  ) THEN
    -- Add the unique constraint
    ALTER TABLE users ADD CONSTRAINT users_curp_unique UNIQUE (curp);
  END IF;
END $$;

-- Create an index for better performance on CURP lookups (only non-null values)
CREATE INDEX IF NOT EXISTS idx_users_curp_not_null 
ON users (curp) 
WHERE curp IS NOT NULL;
