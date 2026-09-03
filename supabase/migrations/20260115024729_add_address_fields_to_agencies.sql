-- Add structured address fields to agencies table
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS exterior_number TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS interior_number TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS colony TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'México';

-- Add index on city and state for potential location-based searches
CREATE INDEX IF NOT EXISTS idx_agencies_city ON agencies(city) WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agencies_state ON agencies(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agencies_postal_code ON agencies(postal_code) WHERE postal_code IS NOT NULL;
