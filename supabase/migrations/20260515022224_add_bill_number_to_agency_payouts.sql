
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agency_payouts' AND column_name = 'bill_number'
  ) THEN
    ALTER TABLE agency_payouts ADD COLUMN bill_number text;
    ALTER TABLE agency_payouts ADD CONSTRAINT agency_payouts_bill_number_unique UNIQUE (bill_number);
  END IF;
END $$;
