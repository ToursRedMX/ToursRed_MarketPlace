-- Add 'standard' as the true default payment option (deposit at booking, rest on tour day to agency)
-- This was the original behavior and should be the default for all tours

-- Drop existing CHECK constraint on tours.payment_option
ALTER TABLE tours DROP CONSTRAINT IF EXISTS tours_payment_option_check;

-- Re-add CHECK constraint including 'standard'
ALTER TABLE tours ADD CONSTRAINT tours_payment_option_check
  CHECK (payment_option IN ('standard', 'full_upfront', 'payment_plan', 'both'));

-- Change column default to 'standard'
ALTER TABLE tours ALTER COLUMN payment_option SET DEFAULT 'standard';

-- Reset all tours that still have 'full_upfront' (the previous wrong default) back to 'standard'
-- Only affects tours that were never explicitly configured by an agency
UPDATE tours SET payment_option = 'standard' WHERE payment_option = 'full_upfront';
