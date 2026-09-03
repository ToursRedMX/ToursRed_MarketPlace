-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020632
--   name:    create_financial_management_system_part2_batches
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
  # Create Financial Management System - Part 2: Payout Batches

  1. New Tables
    - `payout_batches`
      - `id` (uuid, primary key)
      - `batch_name` (text) - Descriptive name (e.g., "Weekly Payouts - Week 3 Jan 2026")
      - `batch_date` (date) - Date when batch was created/processed
      - `period_start` (date) - Start date of period covered by this batch
      - `period_end` (date) - End date of period covered by this batch
      - `total_amount` (numeric) - Total amount across all payouts in batch
      - `agencies_count` (integer) - Number of agencies included in batch
      - `payouts_count` (integer) - Number of individual payouts in batch
      - `status` (text) - draft, ready, processing, completed, cancelled
      - `processed_by_user_id` (uuid) - Admin who processed the batch
      - `notes` (text, nullable) - Internal notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `completed_at` (timestamptz, nullable)

    - `batch_payouts` (junction table)
      - `id` (uuid, primary key)
      - `batch_id` (uuid, foreign key to payout_batches)
      - `payout_id` (uuid, foreign key to agency_payouts)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Only admins can view and manage batches
*/

-- Create payout_batches table
CREATE TABLE IF NOT EXISTS payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name text NOT NULL,
  batch_date date NOT NULL DEFAULT CURRENT_DATE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  agencies_count integer NOT NULL DEFAULT 0 CHECK (agencies_count >= 0),
  payouts_count integer NOT NULL DEFAULT 0 CHECK (payouts_count >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'processing', 'completed', 'cancelled')),
  processed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
)
;



-- Create batch_payouts junction table
CREATE TABLE IF NOT EXISTS batch_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL REFERENCES agency_payouts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, payout_id)
)
;



-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payout_batches_batch_date ON payout_batches(batch_date DESC)
;


CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON payout_batches(status)
;


CREATE INDEX IF NOT EXISTS idx_payout_batches_period ON payout_batches(period_start, period_end)
;


CREATE INDEX IF NOT EXISTS idx_batch_payouts_batch_id ON batch_payouts(batch_id)
;


CREATE INDEX IF NOT EXISTS idx_batch_payouts_payout_id ON batch_payouts(payout_id)
;



-- Enable RLS
ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY
;


ALTER TABLE batch_payouts ENABLE ROW LEVEL SECURITY
;



-- Policies for payout_batches
CREATE POLICY "Admins can view all batches"
  ON payout_batches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can insert batches"
  ON payout_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can update batches"
  ON payout_batches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can delete batches"
  ON payout_batches
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



-- Policies for batch_payouts
CREATE POLICY "Admins can view all batch payouts"
  ON batch_payouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can manage batch payouts"
  ON batch_payouts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payout_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_payout_batches_updated_at_trigger ON payout_batches
;


CREATE TRIGGER update_payout_batches_updated_at_trigger
  BEFORE UPDATE ON payout_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_payout_batches_updated_at()
;
