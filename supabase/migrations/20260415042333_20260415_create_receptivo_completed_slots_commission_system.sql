-- ============================================================
-- FUNCION: get_completed_receptivo_slots_with_commission_status
-- Retorna slots de tours receptivos cuya fecha ya paso
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_completed_receptivo_slots_with_commission_status()
RETURNS TABLE(
  slot_id uuid,
  tour_id uuid,
  tour_name text,
  agency_id uuid,
  agency_name text,
  slot_date date,
  selected_time time,
  days_completed integer,
  bookings_count bigint,
  total_revenue numeric,
  commission_records_exist boolean,
  commission_records_count bigint,
  total_commission_pending numeric,
  total_commission_processed numeric,
  total_platform_commission_pending numeric,
  total_platform_commission_processed numeric,
  payment_status text,
  ready_for_payout boolean,
  can_create_commissions boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id AS slot_id,
    t.id AS tour_id,
    t.name AS tour_name,
    t.agency_id,
    a.name AS agency_name,
    ts.slot_date,
    ts.departure_time AS selected_time,
    (CURRENT_DATE - ts.slot_date)::integer AS days_completed,
    COUNT(DISTINCT b.id) AS bookings_count,
    COALESCE(SUM(b.total_price), 0)::numeric AS total_revenue,
    EXISTS(
      SELECT 1 FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      )
    ) AS commission_records_exist,
    COALESCE((
      SELECT COUNT(*) FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      )
    ), 0) AS commission_records_count,
    COALESCE((
      SELECT SUM(cr.agency_net_amount) FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      ) AND cr.status = 'pending'
    ), 0)::numeric AS total_commission_pending,
    COALESCE((
      SELECT SUM(cr.agency_net_amount) FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      ) AND cr.status = 'processed'
    ), 0)::numeric AS total_commission_processed,
    COALESCE((
      SELECT SUM(cr.agency_commission_amount) FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      ) AND cr.status = 'pending'
    ), 0)::numeric AS total_platform_commission_pending,
    COALESCE((
      SELECT SUM(cr.agency_commission_amount) FROM commission_records cr
      WHERE cr.booking_id IN (
        SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
          AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      ) AND cr.status = 'processed'
    ), 0)::numeric AS total_platform_commission_processed,
    CASE
      WHEN NOT EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        )
      ) THEN 'no_commissions'
      WHEN NOT EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        ) AND cr.status = 'pending'
      ) AND EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        ) AND cr.status = 'processed'
      ) THEN 'processed'
      WHEN EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        ) AND cr.status = 'pending'
      ) AND EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        ) AND cr.status = 'processed'
      ) THEN 'partial'
      ELSE 'pending'
    END AS payment_status,
    (
      (CURRENT_DATE - ts.slot_date >= 3)
      AND EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        ) AND cr.status = 'pending'
      )
    ) AS ready_for_payout,
    (
      NOT EXISTS(
        SELECT 1 FROM commission_records cr
        WHERE cr.booking_id IN (
          SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id
            AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
        )
      )
      AND EXISTS(
        SELECT 1 FROM bookings b2
        WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'
      )
    ) AS can_create_commissions
  FROM tour_slots ts
  INNER JOIN tours t ON t.id = ts.tour_id AND t.tour_type = 'receptivo'
  INNER JOIN agencies a ON a.id = t.agency_id
  LEFT JOIN bookings b ON b.slot_id = ts.id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
  WHERE ts.slot_date < CURRENT_DATE
    AND ts.status NOT IN ('cancelado')
  GROUP BY ts.id, t.id, t.name, t.agency_id, a.name, ts.slot_date, ts.departure_time
  HAVING COUNT(DISTINCT b.id) > 0
  ORDER BY ts.slot_date DESC;
END;
$$;

COMMENT ON FUNCTION public.get_completed_receptivo_slots_with_commission_status() IS
'Retorna slots de tours receptivos cuya fecha ya paso y tienen reservas confirmadas y pagadas. Equivalente a get_completed_tours_with_commission_status pero para tours de tipo receptivo.';


-- ============================================================
-- FUNCION: create_commission_records_for_receptivo_slot
-- Crea commission_records para un slot receptivo completado
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_record record;
  v_booking_record record;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
BEGIN
  -- Verificar que el slot existe, ya paso su fecha y el tour es receptivo
  SELECT
    ts.id,
    ts.slot_date,
    ts.departure_time,
    ts.tour_id,
    t.name AS tour_name,
    t.agency_id,
    t.tour_type
  INTO v_slot_record
  FROM tour_slots ts
  INNER JOIN tours t ON t.id = ts.tour_id
  WHERE ts.id = p_slot_id
    AND ts.slot_date < CURRENT_DATE
    AND t.tour_type = 'receptivo';

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Slot no encontrado, no pertenece a un tour receptivo, o su fecha aun no ha pasado',
      'created_count', 0,
      'skipped_count', 0
    );
  END IF;

  -- Iterar sobre reservas confirmadas y pagadas del slot que aun no tienen commission_record
  FOR v_booking_record IN
    SELECT
      b.id AS booking_id,
      b.agency_id,
      b.total_price,
      b.commission_amount,
      b.service_charge,
      b.platform_revenue
    FROM bookings b
    WHERE b.slot_id = p_slot_id
      AND b.status = 'confirmed'
      AND b.payment_status = 'succeeded'
      AND NOT EXISTS (
        SELECT 1 FROM commission_records cr WHERE cr.booking_id = b.id
      )
  LOOP
    INSERT INTO commission_records (
      booking_id,
      agency_id,
      tour_id,
      tour_end_date,
      total_tour_price,
      agency_commission_rate,
      agency_commission_amount,
      service_charge_rate,
      service_charge_amount,
      platform_total_revenue,
      agency_net_amount,
      status,
      created_at
    ) VALUES (
      v_booking_record.booking_id,
      v_booking_record.agency_id,
      v_slot_record.tour_id,
      v_slot_record.slot_date,
      v_booking_record.total_price,
      0.10,
      v_booking_record.commission_amount,
      0.03,
      v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount - v_booking_record.service_charge,
      'pending',
      now()
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  -- Contar reservas que ya tenian commission_record
  SELECT COUNT(*)
  INTO v_skipped_count
  FROM bookings b
  WHERE b.slot_id = p_slot_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND EXISTS (
      SELECT 1 FROM commission_records cr WHERE cr.booking_id = b.id
    );

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados exitosamente',
    'tour_name', v_slot_record.tour_name,
    'slot_date', v_slot_record.slot_date::text,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'message', 'Error al crear commission records: ' || SQLERRM,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

COMMENT ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid) IS
'Crea commission_records para todas las reservas confirmadas y pagadas de un slot receptivo completado. Usa slot_date como tour_end_date.';


-- ============================================================
-- INDICES para mejorar rendimiento de consultas de receptivos
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tour_slots_slot_date_status
  ON tour_slots(slot_date, status);

CREATE INDEX IF NOT EXISTS idx_tour_slots_tour_id_slot_date
  ON tour_slots(tour_id, slot_date);

CREATE INDEX IF NOT EXISTS idx_bookings_slot_id_status_payment
  ON bookings(slot_id, status, payment_status)
  WHERE slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commission_records_booking_id_status
  ON commission_records(booking_id, status);
