-- ============================================================
-- Step 1: Add commission_percentage to agencies
-- NULL means "use platform default" — never written on INSERT
-- ============================================================
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS commission_percentage numeric(5,2) NULL;

-- ============================================================
-- Step 2: Extend contract_acceptances for amendment support
-- ============================================================

-- Fix status constraint to include superseded + failed
ALTER TABLE contract_acceptances
  DROP CONSTRAINT IF EXISTS contract_acceptances_status_check;

ALTER TABLE contract_acceptances
  ADD CONSTRAINT contract_acceptances_status_check
    CHECK (status IN ('pending', 'signed', 'superseded', 'failed'));

-- Add amendment tracking columns
ALTER TABLE contract_acceptances
  ADD COLUMN IF NOT EXISTS amendment_type text NULL
    CHECK (amendment_type IN ('initial', 'commission_change')),
  ADD COLUMN IF NOT EXISTS commission_percentage_at_signing numeric(5,2) NULL,
  ADD COLUMN IF NOT EXISTS commission_percentage_proposed   numeric(5,2) NULL;

-- ============================================================
-- Step 3: Add pending_amendment_id to agencies
-- Points to the in-flight contract_acceptances amendment record
-- ============================================================
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS pending_amendment_id uuid NULL
    REFERENCES contract_acceptances(id) ON DELETE SET NULL;

-- ============================================================
-- Step 4: RLS policy for admin/executive commission updates
-- ============================================================
DROP POLICY IF EXISTS "admin_update_agency_commission" ON agencies;

CREATE POLICY "admin_update_agency_commission" ON agencies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin', 'account_executive')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin', 'account_executive')
    )
  );
