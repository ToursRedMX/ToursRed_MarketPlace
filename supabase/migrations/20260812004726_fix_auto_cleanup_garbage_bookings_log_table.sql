/*
# Fix auto_cleanup_garbage_bookings: dedicated log table

## Problem
The `auto_cleanup_garbage_bookings()` function inserted per-booking audit
records into `booking_cleanup_logs`, but that table has a different schema:
(id, deleted_count, deleted_by NOT NULL FK auth.users, deleted_at, criteria).
It is a batch-level log for manual admin cleanups, not a per-booking log.
The INSERT used columns (booking_id, booking_code, total_price, payment_status,
payment_method, deleted_by, deletion_reason) that do not exist in that table,
causing every cleanup run to fail.

## Fix
1. Create a new dedicated table `booking_auto_cleanup_logs` for the cron's
   per-booking audit records.
2. Enable RLS, add admin-only SELECT policy, revoke public access.
3. Add an index on `deleted_at` for report queries.
4. Recreate `auto_cleanup_garbage_bookings()` with the same logic as the
   latest version (migration 20260731175121 — includes NOT EXISTS against
   payment_transactions), but change the INSERT to target
   `booking_auto_cleanup_logs` without the `deleted_by` column.

## New Tables
- `booking_auto_cleanup_logs`
  - `id` (uuid, PK)
  - `booking_id` (uuid, NOT NULL) — the deleted booking's ID
  - `booking_code` (text, NOT NULL) — human-readable booking code
  - `total_price` (numeric) — booking total at time of deletion
  - `payment_status` (text) — payment status at time of deletion
  - `payment_method` (text) — payment method at time of deletion
  - `deletion_reason` (text) — reason string (e.g. 'auto_cron: abandoned')
  - `deleted_at` (timestamptz, DEFAULT now()) — when the cron deleted it

## Security
- RLS enabled on `booking_auto_cleanup_logs`.
- SELECT policy: admins only (users.role = 'admin' via auth.uid()).
- REVOKE ALL FROM PUBLIC on the table.
- Function remains SECURITY DEFINER, search_path = public, REVOKE ALL FROM PUBLIC.
*/

-- ── 1. Create dedicated log table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_auto_cleanup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  booking_code text NOT NULL,
  total_price numeric,
  payment_status text,
  payment_method text,
  deletion_reason text,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking_auto_cleanup_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON booking_auto_cleanup_logs FROM PUBLIC;

DROP POLICY IF EXISTS "Admins can view auto cleanup logs" ON booking_auto_cleanup_logs;
CREATE POLICY "Admins can view auto cleanup logs"
  ON booking_auto_cleanup_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_booking_auto_cleanup_logs_deleted_at
  ON booking_auto_cleanup_logs (deleted_at DESC);

-- ── 2. Recreate function with corrected INSERT ──────────────────────────────

CREATE OR REPLACE FUNCTION auto_cleanup_garbage_bookings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_row RECORD;
  deleted_count int := 0;
BEGIN
  FOR deleted_row IN
    SELECT
      b.id,
      b.booking_code,
      b.total_price,
      b.payment_status,
      b.payment_method,
      CASE
        WHEN b.payment_status = 'pending'                                          THEN 'abandoned'
        WHEN b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria' THEN 'unconfirmed_transfer'
        WHEN b.payment_status = 'processing'                                       THEN 'expired_processing'
        ELSE 'other'
      END AS reason
    FROM bookings b
    WHERE b.status IN ('pending', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM payment_transactions pt
        WHERE pt.booking_id = b.id AND pt.status = 'succeeded'
      )
      AND (
        (b.payment_status = 'pending'      AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method != 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
      )
  LOOP
    -- Registrar en audit log antes de eliminar
    INSERT INTO booking_auto_cleanup_logs (
      booking_id,
      booking_code,
      total_price,
      payment_status,
      payment_method,
      deletion_reason
    ) VALUES (
      deleted_row.id,
      deleted_row.booking_code,
      deleted_row.total_price,
      deleted_row.payment_status,
      deleted_row.payment_method,
      'auto_cron: ' || deleted_row.reason
    )
    ON CONFLICT DO NOTHING;

    -- Eliminar la reserva
    DELETE FROM bookings WHERE id = deleted_row.id;

    deleted_count := deleted_count + 1;
  END LOOP;

  -- Log de resumen en pg_log para visibilidad
  IF deleted_count > 0 THEN
    RAISE LOG 'auto_cleanup_garbage_bookings: eliminadas % reservas basura', deleted_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION auto_cleanup_garbage_bookings() FROM PUBLIC;
