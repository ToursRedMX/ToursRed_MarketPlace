
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memberships' AND column_name = 'price_paid'
  ) THEN
    ALTER TABLE memberships ADD COLUMN price_paid numeric DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memberships' AND column_name = 'renewal_amount'
  ) THEN
    ALTER TABLE memberships ADD COLUMN renewal_amount numeric DEFAULT 0;
  END IF;
END $$;

-- Backfill registros existentes con los precios históricos
UPDATE memberships
SET
  price_paid = CASE WHEN plan_type = 'monthly' THEN 49 ELSE 490 END,
  renewal_amount = CASE WHEN plan_type = 'monthly' THEN 49 ELSE 490 END
WHERE price_paid = 0 AND renewal_amount = 0;
