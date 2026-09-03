-- Add commission rate column to agencies table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agencies' AND column_name = 'commission_rate'
  ) THEN
    ALTER TABLE agencies ADD COLUMN commission_rate DECIMAL(5,4) DEFAULT 0.10 NOT NULL;
  END IF;
END $$;

-- Add constraint to ensure commission rate is reasonable (0% to 50%)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'agencies_commission_rate_check'
  ) THEN
    ALTER TABLE agencies ADD CONSTRAINT agencies_commission_rate_check 
    CHECK (commission_rate >= 0 AND commission_rate <= 0.50);
  END IF;
END $$;

-- Add comment to explain the commission rate column
COMMENT ON COLUMN agencies.commission_rate IS 'Commission rate charged by platform (0.10 = 10%)';

-- Update existing agencies to have the default commission rate if they don't have one
UPDATE agencies 
SET commission_rate = 0.10 
WHERE commission_rate IS NULL;
