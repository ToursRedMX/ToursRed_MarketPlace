-- 1. Ampliar el check constraint de invoice_type para incluir 'checkin_wallet'
ALTER TABLE cfdi_invoices
  DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;

ALTER TABLE cfdi_invoices
  ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'booking'::text,
    'commission'::text,
    'membership'::text,
    'manual'::text,
    'checkin_wallet'::text
  ]));

-- 2. Agregar columna checkin_charge_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'checkin_charge_id'
  ) THEN
    ALTER TABLE cfdi_invoices
      ADD COLUMN checkin_charge_id uuid NULL
        REFERENCES wallet_checkin_charges(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Índice para búsquedas de deduplicación por cobro de check-in
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_checkin_charge_id
  ON cfdi_invoices (checkin_charge_id)
  WHERE checkin_charge_id IS NOT NULL;
