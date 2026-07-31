/*
# Fix auto_cleanup_garbage_bookings: use payment_transactions instead of user_payment

## Problem
The function used `COALESCE(b.user_payment, 0) = 0` to detect bookings with
zero payment. Since the recent revert, `user_payment` now represents
"outstanding balance" (not "amount paid") and is preloaded with the full amount
at booking creation — so it is never 0 for a newly created booking, even if
nothing has been paid. This caused the cleanup cron to stop detecting
genuinely abandoned bookings.

## Fix
Replace `COALESCE(b.user_payment, 0) = 0` with:
  AND NOT EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE pt.booking_id = b.id AND pt.status = 'succeeded'
  )

This uses the real source of truth: if there is no successful payment
transaction, the booking is genuinely unpaid and safe to clean up. Bookings
with partial payments (at least one succeeded transaction) are preserved —
those are already handled by the 72h/24h/7d reminder flow.

## Changes
- `CREATE OR REPLACE FUNCTION auto_cleanup_garbage_bookings()`
  - Removed `AND COALESCE(b.user_payment, 0) = 0` condition.
  - Added `AND NOT EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.booking_id = b.id AND pt.status = 'succeeded')`.
  - Everything else unchanged: same SELECT columns, same time thresholds,
    same audit log insertion, same cron schedule.

## Security
- No RLS or policy changes.
- Function remains SECURITY DEFINER, search_path = public, REVOKE ALL FROM PUBLIC.
*/

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
    INSERT INTO booking_cleanup_logs (
      booking_id,
      booking_code,
      total_price,
      payment_status,
      payment_method,
      deleted_by,
      deletion_reason
    ) VALUES (
      deleted_row.id,
      deleted_row.booking_code,
      deleted_row.total_price,
      deleted_row.payment_status,
      deleted_row.payment_method,
      NULL,  -- NULL = eliminación automática por cron
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
