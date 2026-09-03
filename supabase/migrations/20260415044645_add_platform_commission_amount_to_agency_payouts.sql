
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agency_payouts' AND column_name = 'platform_commission_amount'
  ) THEN
    ALTER TABLE agency_payouts ADD COLUMN platform_commission_amount numeric DEFAULT 0;
  END IF;
END $$;
