/*
# CFDI Relations and Credit Notes Support

## Purpose
Add infrastructure for CFDI sustitución (tipo_relacion "04") and notas de crédito (tipo_relacion "01")
required by partial cancellations of travelers, optional services, and supplements.

## Changes

### 1. New columns on cfdi_invoices
- `related_cfdi_invoice_id` (uuid, nullable) — references the original CFDI that this
  CFDI relates to (for sustitución "04" or nota de crédito "01" relationships).
- `tipo_relacion` (text, nullable) — the SAT relationship type code:
  "01" = nota de crédito de los documentos relacionados
  "04" = sustitución de los CFDI previos
- `booking_partial_cancellation_id` (uuid, nullable) — links a sustituto CFDI to the
  specific partial cancellation that triggered it.
- `credit_note_for_item_type` (text, nullable) — 'optional_service' or 'supplement',
  indicates which kind of item cancellation generated this credit note.

### 2. invoice_type constraint expansion
Add 'credit_note' to the allowed invoice_type values for notas de crédito.

### 3. Indexes
- Index on related_cfdi_invoice_id for quick lookups.
- Index on booking_partial_cancellation_id.

### 4. Foreign keys
- related_cfdi_invoice_id → cfdi_invoices(id) ON DELETE SET NULL
- booking_partial_cancellation_id → booking_partial_cancellations(id) ON DELETE SET NULL

### Security
No RLS changes needed — cfdi_invoices already has RLS enabled with existing policies.
*/

DO $$
BEGIN
  -- related_cfdi_invoice_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'related_cfdi_invoice_id'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN related_cfdi_invoice_id uuid;
  END IF;

  -- tipo_relacion
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'tipo_relacion'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN tipo_relacion text;
  END IF;

  -- booking_partial_cancellation_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'booking_partial_cancellation_id'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN booking_partial_cancellation_id uuid;
  END IF;

  -- credit_note_for_item_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'credit_note_for_item_type'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN credit_note_for_item_type text;
  END IF;
END $$;

-- Add foreign key for related_cfdi_invoice_id (self-reference, ON DELETE SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cfdi_invoices_related_cfdi_invoice_id_fkey'
  ) THEN
    ALTER TABLE cfdi_invoices
      ADD CONSTRAINT cfdi_invoices_related_cfdi_invoice_id_fkey
      FOREIGN KEY (related_cfdi_invoice_id) REFERENCES cfdi_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add foreign key for booking_partial_cancellation_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cfdi_invoices_booking_partial_cancellation_id_fkey'
  ) THEN
    ALTER TABLE cfdi_invoices
      ADD CONSTRAINT cfdi_invoices_booking_partial_cancellation_id_fkey
      FOREIGN KEY (booking_partial_cancellation_id) REFERENCES booking_partial_cancellations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Expand invoice_type constraint to include 'credit_note'
ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
ALTER TABLE cfdi_invoices
  ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'booking'::text, 'booking_installment'::text, 'commission'::text,
    'membership'::text, 'featured_slot'::text, 'supplement'::text,
    'optional_service'::text, 'post_booking_insurance'::text,
    'checkin_wallet'::text, 'manual'::text, 'cancellation_commission'::text,
    'credit_note'::text
  ]));

-- Add credit_note_for_item_type check constraint
ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_credit_note_for_item_type_check;
ALTER TABLE cfdi_invoices
  ADD CONSTRAINT cfdi_invoices_credit_note_for_item_type_check
  CHECK (credit_note_for_item_type IS NULL OR credit_note_for_item_type = ANY (ARRAY['optional_service'::text, 'supplement'::text]));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_related_cfdi_invoice_id ON cfdi_invoices(related_cfdi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_booking_partial_cancellation_id ON cfdi_invoices(booking_partial_cancellation_id);
