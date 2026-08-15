-- ============================================================
-- FUNCION: auto_create_receptivo_slot_commissions
-- Crea comisiones para todos los slots receptivos completados
-- que aun no las tienen. Devuelve resumen de lo procesado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_create_receptivo_slot_commissions()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_id uuid;
  v_result json;
  v_total_created integer := 0;
  v_slots_processed integer := 0;
  v_slots_skipped integer := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  -- Iterar sobre todos los slots de tours receptivos cuya fecha ya paso
  -- y que tienen reservas confirmadas sin commission_records
  FOR v_slot_id IN
    SELECT DISTINCT ts.id
    FROM tour_slots ts
    INNER JOIN tours t ON t.id = ts.tour_id AND t.tour_type = 'receptivo'
    WHERE ts.slot_date < CURRENT_DATE
      AND ts.status NOT IN ('cancelado')
      AND EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.slot_id = ts.id
          AND b.status = 'confirmed'
          AND b.payment_status = 'succeeded'
          AND NOT EXISTS (
            SELECT 1 FROM commission_records cr WHERE cr.booking_id = b.id
          )
      )
    ORDER BY ts.id
  LOOP
    BEGIN
      SELECT public.create_commission_records_for_receptivo_slot(v_slot_id)
      INTO v_result;

      IF (v_result->>'success')::boolean THEN
        v_total_created := v_total_created + (v_result->>'created_count')::integer;
        v_slots_processed := v_slots_processed + 1;
      ELSE
        v_errors := array_append(v_errors, 'slot ' || v_slot_id::text || ': ' || (v_result->>'message'));
        v_slots_skipped := v_slots_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'slot ' || v_slot_id::text || ': ' || SQLERRM);
      v_slots_skipped := v_slots_skipped + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'total_commission_records_created', v_total_created,
    'slots_processed', v_slots_processed,
    'slots_skipped', v_slots_skipped,
    'errors', to_json(v_errors),
    'executed_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.auto_create_receptivo_slot_commissions() IS
'Crea automaticamente commission_records para todos los slots de tours receptivos completados que aun no los tienen. Llamada por cron job diario.';


-- ============================================================
-- CRON JOB: Ejecutar diariamente a las 02:00 UTC
-- ============================================================

SELECT cron.unschedule('auto-create-receptivo-slot-commissions')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-create-receptivo-slot-commissions'
);

SELECT cron.schedule(
  'auto-create-receptivo-slot-commissions',
  '0 2 * * *',
  $$SELECT public.auto_create_receptivo_slot_commissions();$$
);
