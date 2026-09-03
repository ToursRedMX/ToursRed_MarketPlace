-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020819
--   name:    update_commission_records_with_payout_fields_fixed
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
  # Update Commission Records with Payout Fields

  1. New Columns in `commission_records`
    - `payout_id` (uuid, nullable) - Links to agency_payouts when paid
    - `payout_scheduled_date` (date, nullable) - When payout is scheduled
    - `reconciliation_status` (text) - reconciled, pending, disputed
    - `reconciliation_notes` (text, nullable) - Admin notes for disputed records
    - `tour_completion_date` (date, nullable) - When tour was completed (end_date)
    - `days_since_completion` (integer, nullable) - Calculated field for reporting

  2. Indexes
    - Add indexes for payout_id and reconciliation_status for performance

  3. Notes
    - These fields enable linking commission records to payouts
    - Reconciliation tracking for financial auditing
    - Tour completion tracking for payout timing
*/

-- Add new columns to commission_records table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payout_id'
  ) THEN
    ALTER TABLE commission_records ADD COLUMN payout_id uuid REFERENCES agency_payouts(id) ON DELETE SET NULL
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'payout_scheduled_date'
  ) THEN
    ALTER TABLE commission_records ADD COLUMN payout_scheduled_date date
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'reconciliation_status'
  ) THEN
    ALTER TABLE commission_records ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('reconciled', 'pending', 'disputed'))
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'reconciliation_notes'
  ) THEN
    ALTER TABLE commission_records ADD COLUMN reconciliation_notes text
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'tour_completion_date'
  ) THEN
    ALTER TABLE commission_records ADD COLUMN tour_completion_date date
;


  END IF
;


END $$
;



-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_commission_records_payout_id ON commission_records(payout_id)
;


CREATE INDEX IF NOT EXISTS idx_commission_records_reconciliation_status ON commission_records(reconciliation_status)
;


CREATE INDEX IF NOT EXISTS idx_commission_records_scheduled_date ON commission_records(payout_scheduled_date)
;


CREATE INDEX IF NOT EXISTS idx_commission_records_completion_date ON commission_records(tour_completion_date)
;



-- Composite index for common queries (pending payouts for an agency)
CREATE INDEX IF NOT EXISTS idx_commission_records_agency_pending ON commission_records(agency_id, status) WHERE payout_id IS NULL
;



-- Create or replace function to auto-populate tour_completion_date when commission_record is created
CREATE OR REPLACE FUNCTION set_commission_tour_completion_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Get the tour end_date and set it as tour_completion_date
  SELECT end_date INTO NEW.tour_completion_date
  FROM tours
  WHERE id = NEW.tour_id
;


  
  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Create trigger to auto-set tour completion date
DROP TRIGGER IF EXISTS set_commission_tour_completion_date_trigger ON commission_records
;


CREATE TRIGGER set_commission_tour_completion_date_trigger
  BEFORE INSERT ON commission_records
  FOR EACH ROW
  EXECUTE FUNCTION set_commission_tour_completion_date()
;



-- Create view for easy calculation of days since completion
CREATE OR REPLACE VIEW commission_records_with_days_pending AS
SELECT 
  cr.*,
  CASE 
    WHEN cr.tour_completion_date IS NOT NULL THEN 
      (CURRENT_DATE - cr.tour_completion_date)::integer
    ELSE NULL
  END as days_since_completion,
  CASE
    WHEN cr.payout_id IS NOT NULL THEN false
    WHEN cr.tour_completion_date IS NULL THEN false
    WHEN cr.tour_completion_date > CURRENT_DATE THEN false
    ELSE true
  END as is_ready_for_payout,
  a.name as agency_name,
  t.name as tour_name,
  t.start_date as tour_start_date,
  t.end_date as tour_end_date
FROM commission_records cr
JOIN agencies a ON cr.agency_id = a.id
JOIN tours t ON cr.tour_id = t.id
;
