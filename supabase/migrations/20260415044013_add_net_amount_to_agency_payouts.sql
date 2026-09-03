
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agency_payouts' AND column_name = 'net_amount'
  ) THEN
    ALTER TABLE agency_payouts ADD COLUMN net_amount numeric;
    UPDATE agency_payouts SET net_amount = amount WHERE net_amount IS NULL;
  END IF;
END $$;
