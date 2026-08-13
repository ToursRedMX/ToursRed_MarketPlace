/*
# Fix auto_cleanup_garbage_bookings: skip + log bookings with succeeded payments

## Problem
The function already excluded bookings with succeeded payment_transactions
via a NOT EXISTS clause in the cursor WHERE. However, this meant bookings
where payment_status was desynchronized from reality (e.g. showed 'pending'
but actually had a succeeded transaction) were silently skipped with no
audit trail — admins had no way to know these bookings existed or needed
manual review.

## Fix
1. Remove the NOT EXISTS filter from the cursor SELECT so the cursor now
   visits ALL bookings matching the age/status criteria — including those
   that might have a succeeded payment.
2. Inside the loop, before each DELETE, check if at least one
   payment_transactions row with status = 'succeeded' exists for that
   booking_id.
   - If YES: insert a log row into booking_auto_cleanup_logs with
     deletion_reason = 'payment_mismatch_skipped' and CONTINUE (do NOT
     delete the booking). This leaves an audit trail for manual review.
   - If NO: proceed as before — log + DELETE.

## Security
- No RLS or policy changes.
- Function remains SECURITY DEFINER, search_path = public, REVOKE ALL FROM PUBLIC.
- Table booking_auto_cleanup_logs is unchanged (created in migration
  20260812004726).
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
  skipped_count int := 0;
  v_has_succeeded_payment boolean;
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
      AND (
        (b.payment_status = 'pending'      AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method != 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
      )
  LOOP
    -- Check if there is at least one succeeded payment transaction
    SELECT EXISTS (
      SELECT 1 FROM payment_transactions pt
      WHERE pt.booking_id = deleted_row.id AND pt.status = 'succeeded'
    ) INTO v_has_succeeded_payment;

    IF v_has_succeeded_payment THEN
      -- Booking has a real succeeded payment but its booking-level payment_status
      -- says pending/processing. Skip deletion and log for manual review.
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
        'payment_mismatch_skipped'
      )
      ON CONFLICT DO NOTHING;

      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

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
  IF deleted_count > 0 OR skipped_count > 0 THEN
    RAISE LOG 'auto_cleanup_garbage_bookings: eliminadas % reservas basura, saltadas % por pago real', deleted_count, skipped_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION auto_cleanup_garbage_bookings() FROM PUBLIC;
