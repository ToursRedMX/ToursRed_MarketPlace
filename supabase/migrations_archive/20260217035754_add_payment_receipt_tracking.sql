
-- Agregar campos para tracking de comprobantes de pago
DO $$
BEGIN
  -- payment_method ya existe, solo verificar que esté
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN payment_method text;
  END IF;

  -- Agregar columna para URL del comprobante
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payment_receipt_url'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN payment_receipt_url text;
  END IF;

  -- Agregar columna para nombre del archivo
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payment_receipt_filename'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN payment_receipt_filename text;
  END IF;

  -- Agregar columna para notas del pago
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payment_notes'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN payment_notes text;
  END IF;

  -- Agregar columna para timestamp de notificación
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'notified_at'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN notified_at timestamptz;
  END IF;
END $$;

-- Crear índice para búsquedas por agencia y estado
CREATE INDEX IF NOT EXISTS idx_commission_records_agency_status 
ON commission_records(agency_id, status);
