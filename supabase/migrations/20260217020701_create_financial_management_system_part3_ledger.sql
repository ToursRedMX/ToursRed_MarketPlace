-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020701
--   name:    create_financial_management_system_part3_ledger
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
  # Create Financial Management System - Part 3: Financial Transactions Ledger

  1. New Tables
    - `financial_transactions`
      - `id` (uuid, primary key)
      - `transaction_date` (timestamptz) - When transaction occurred
      - `transaction_type` (text) - booking, cancellation_full, cancellation_partial, no_show, tour_cancellation, adjustment, payout, refund
      - `agency_id` (uuid) - Agency involved
      - `booking_id` (uuid, nullable) - Related booking if applicable
      - `tour_id` (uuid, nullable) - Related tour if applicable
      - `cancellation_id` (uuid, nullable) - Related cancellation if applicable
      - `payout_id` (uuid, nullable) - Related payout if applicable
      - `gross_amount` (numeric) - Original amount before any deductions
      - `platform_commission` (numeric) - Platform's commission/service charge
      - `net_to_agency` (numeric) - Net amount agency receives/received
      - `platform_revenue` (numeric) - Total platform keeps (commission + retained amounts)
      - `description` (text) - Human-readable description
      - `payment_status` (text) - pending, paid, cancelled
      - `reconciliation_status` (text) - reconciled, pending, disputed
      - `metadata` (jsonb, nullable) - Additional flexible data
      - `created_by_user_id` (uuid, nullable) - User who created (for manual adjustments)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Agencies can view their own transactions
    - Admins can view all transactions
*/

-- Create financial_transactions table
CREATE TABLE IF NOT EXISTS financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date timestamptz NOT NULL DEFAULT now(),
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'booking',
    'cancellation_full',
    'cancellation_partial',
    'no_show',
    'tour_cancellation_by_agency',
    'adjustment',
    'payout',
    'refund',
    'commission_correction'
  )),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  tour_id uuid REFERENCES tours(id) ON DELETE SET NULL,
  cancellation_id uuid REFERENCES booking_cancellations(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES agency_payouts(id) ON DELETE SET NULL,
  gross_amount numeric(12, 2) NOT NULL DEFAULT 0,
  platform_commission numeric(12, 2) NOT NULL DEFAULT 0,
  net_to_agency numeric(12, 2) NOT NULL DEFAULT 0,
  platform_revenue numeric(12, 2) NOT NULL DEFAULT 0,
  description text NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cancelled')),
  reconciliation_status text NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('reconciled', 'pending', 'disputed')),
  metadata jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
;



-- Create comprehensive indexes for performance
CREATE INDEX IF NOT EXISTS idx_financial_transactions_agency_id ON financial_transactions(agency_id)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_transaction_date ON financial_transactions(transaction_date DESC)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_transaction_type ON financial_transactions(transaction_type)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_booking_id ON financial_transactions(booking_id)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_tour_id ON financial_transactions(tour_id)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_payout_id ON financial_transactions(payout_id)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_payment_status ON financial_transactions(payment_status)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_reconciliation_status ON financial_transactions(reconciliation_status)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_created_at ON financial_transactions(created_at DESC)
;



-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_financial_transactions_agency_date ON financial_transactions(agency_id, transaction_date DESC)
;


CREATE INDEX IF NOT EXISTS idx_financial_transactions_agency_status ON financial_transactions(agency_id, payment_status)
;



-- Enable RLS
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY
;



-- Policy: Agencies can view their own transactions
CREATE POLICY "Agencies can view own transactions"
  ON financial_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = financial_transactions.agency_id
      AND agencies.user_id = auth.uid()
    )
  )
;



-- Policy: Admins can view all transactions
CREATE POLICY "Admins can view all transactions"
  ON financial_transactions
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



-- Policy: Admins can insert transactions (for manual adjustments)
CREATE POLICY "Admins can insert transactions"
  ON financial_transactions
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



-- Policy: Admins can update transactions (for reconciliation)
CREATE POLICY "Admins can update transactions"
  ON financial_transactions
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



-- Policy: Service role can insert transactions (for automated processes)
CREATE POLICY "Service role can insert transactions"
  ON financial_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (true)
;
