-- ── Función de limpieza automática ─────────────────────────────────────────

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

-- ── Programar cron: diariamente a la 01:00 UTC ──────────────────────────────

SELECT cron.schedule(
  'auto-cleanup-garbage-bookings',   -- nombre del job
  '0 1 * * *',                        -- cada dia a la 01:00 UTC
  $$SELECT auto_cleanup_garbage_bookings();$$
);
