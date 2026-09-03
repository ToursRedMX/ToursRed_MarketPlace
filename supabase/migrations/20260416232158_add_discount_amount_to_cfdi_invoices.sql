
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN discount_amount numeric DEFAULT NULL;
  END IF;
END $$;
