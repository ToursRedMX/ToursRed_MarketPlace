
-- Drop the old address column
ALTER TABLE users DROP COLUMN IF EXISTS address;

-- Add structured address fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS exterior_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS interior_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS colony TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'México';

-- Add index on postal_code for potential searches
CREATE INDEX IF NOT EXISTS idx_users_postal_code ON users(postal_code) WHERE postal_code IS NOT NULL;
