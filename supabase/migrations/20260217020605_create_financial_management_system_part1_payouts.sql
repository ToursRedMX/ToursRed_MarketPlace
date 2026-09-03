-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020605
--   name:    create_financial_management_system_part1_payouts
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
  # Create Financial Management System - Part 1: Agency Payouts

  1. New Tables
    - `agency_payouts`
      - `id` (uuid, primary key)
      - `agency_id` (uuid, foreign key to agencies)
      - `payout_date` (date) - Date when payout was processed
      - `amount` (numeric) - Total amount paid to agency
      - `payment_method` (text) - SPEI transfer, international transfer, check, etc.
      - `bank_reference` (text) - Bank transaction reference/confirmation number
      - `receipt_url` (text, nullable) - URL to uploaded receipt/proof of payment
      - `status` (text) - pending, processing, completed, failed
      - `notes` (text, nullable) - Internal admin notes
      - `external_transaction_id` (text, nullable) - For future banking API integration
      - `bank_account_id` (text, nullable) - Reference to bank account used
      - `erp_sync_status` (text, nullable) - synced, pending, failed, not_applicable
      - `erp_invoice_id` (text, nullable) - Invoice ID in external ERP system
      - `erp_reference` (text, nullable) - Additional ERP reference data
      - `processed_by_user_id` (uuid, nullable) - Admin who processed the payout
      - `commission_records_count` (integer) - Number of commission records included
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `agency_payouts` table
    - Agencies can view their own payouts
    - Admins can view and manage all payouts
*/

-- Create agency_payouts table
CREATE TABLE IF NOT EXISTS agency_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  payout_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('spei_transfer', 'international_transfer', 'check', 'cash', 'other')),
  bank_reference text,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  notes text,
  external_transaction_id text,
  bank_account_id text,
  erp_sync_status text CHECK (erp_sync_status IN ('synced', 'pending', 'failed', 'not_applicable')),
  erp_invoice_id text,
  erp_reference text,
  processed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  commission_records_count integer NOT NULL DEFAULT 0 CHECK (commission_records_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
;



-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agency_payouts_agency_id ON agency_payouts(agency_id)
;


CREATE INDEX IF NOT EXISTS idx_agency_payouts_payout_date ON agency_payouts(payout_date DESC)
;


CREATE INDEX IF NOT EXISTS idx_agency_payouts_status ON agency_payouts(status)
;


CREATE INDEX IF NOT EXISTS idx_agency_payouts_created_at ON agency_payouts(created_at DESC)
;



-- Enable RLS
ALTER TABLE agency_payouts ENABLE ROW LEVEL SECURITY
;



-- Policy: Agencies can view their own payouts
CREATE POLICY "Agencies can view own payouts"
  ON agency_payouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = agency_payouts.agency_id
      AND agencies.user_id = auth.uid()
    )
  )
;



-- Policy: Admins can view all payouts
CREATE POLICY "Admins can view all payouts"
  ON agency_payouts
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



-- Policy: Admins can insert payouts
CREATE POLICY "Admins can insert payouts"
  ON agency_payouts
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



-- Policy: Admins can update payouts
CREATE POLICY "Admins can update payouts"
  ON agency_payouts
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



-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agency_payouts_updated_at()
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
DROP TRIGGER IF EXISTS update_agency_payouts_updated_at_trigger ON agency_payouts
;


CREATE TRIGGER update_agency_payouts_updated_at_trigger
  BEFORE UPDATE ON agency_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_agency_payouts_updated_at()
;
