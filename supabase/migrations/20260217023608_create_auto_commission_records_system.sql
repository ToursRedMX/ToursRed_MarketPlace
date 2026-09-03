
-- Agregar columna tour_end_date a commission_records para tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records'
    AND column_name = 'tour_end_date'
  ) THEN
    ALTER TABLE commission_records
    ADD COLUMN tour_end_date date;
  END IF;
END $$;

-- Función para crear commission_records para un tour completado
CREATE OR REPLACE FUNCTION create_commission_records_for_tour(p_tour_id uuid)
RETURNS json AS $$
DECLARE
  v_tour_record record;
  v_booking_record record;
  v_commission_record_id uuid;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_result json;
BEGIN
  -- Verificar que el tour existe y ha finalizado
  SELECT t.id, t.agency_id, t.end_date, t.name
  INTO v_tour_record
  FROM tours t
  WHERE t.id = p_tour_id
  AND t.end_date < CURRENT_DATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Tour no encontrado o no ha finalizado',
      'created_count', 0,
      'skipped_count', 0
    );
  END IF;

  -- Iterar sobre todas las reservas confirmadas y pagadas del tour
  FOR v_booking_record IN
    SELECT
      b.id as booking_id,
      b.agency_id,
      b.total_price,
      b.commission_amount,
      b.service_charge,
      b.platform_revenue
    FROM bookings b
    WHERE b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND NOT EXISTS (
      -- Verificar que no exista ya un commission_record para esta reserva
      SELECT 1 FROM commission_records cr
      WHERE cr.booking_id = b.id
    )
  LOOP
    -- Crear commission_record para esta reserva
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
      p_tour_id,
      v_tour_record.end_date,
      v_booking_record.total_price,
      0.10, -- 10% comisión por defecto
      v_booking_record.commission_amount,
      0.03, -- 3% cargo de servicio por defecto
      v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount - v_booking_record.service_charge,
      'pending',
      now()
    )
    RETURNING id INTO v_commission_record_id;

    v_created_count := v_created_count + 1;
  END LOOP;

  -- Contar reservas que ya tenían commission_records
  SELECT COUNT(*)
  INTO v_skipped_count
  FROM bookings b
  WHERE b.tour_id = p_tour_id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
  AND EXISTS (
    SELECT 1 FROM commission_records cr
    WHERE cr.booking_id = b.id
  );

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados exitosamente',
    'tour_name', v_tour_record.name,
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Función para verificar si un tour está listo para pago
CREATE OR REPLACE FUNCTION is_tour_ready_for_payout(p_tour_id uuid)
RETURNS boolean AS $$
DECLARE
  v_end_date date;
  v_days_since_end integer;
BEGIN
  SELECT end_date
  INTO v_end_date
  FROM tours
  WHERE id = p_tour_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_days_since_end := CURRENT_DATE - v_end_date;

  RETURN v_days_since_end >= 3;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Función para obtener tours completados con estado de comisiones
CREATE OR REPLACE FUNCTION get_completed_tours_with_commission_status()
RETURNS TABLE (
  tour_id uuid,
  tour_name text,
  tour_code text,
  agency_id uuid,
  agency_name text,
  end_date date,
  days_completed integer,
  bookings_count bigint,
  total_revenue numeric,
  commission_records_exist boolean,
  commission_records_count bigint,
  total_commission_pending numeric,
  ready_for_payout boolean,
  can_create_commissions boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id as tour_id,
    t.name as tour_name,
    t.tour_code,
    t.agency_id,
    a.name as agency_name,
    t.end_date,
    (CURRENT_DATE - t.end_date)::integer as days_completed,
    COUNT(DISTINCT b.id) as bookings_count,
    COALESCE(SUM(b.total_price), 0)::numeric as total_revenue,
    EXISTS(
      SELECT 1 FROM commission_records cr
      WHERE cr.tour_id = t.id
    ) as commission_records_exist,
    COALESCE((
      SELECT COUNT(*) FROM commission_records cr
      WHERE cr.tour_id = t.id
    ), 0) as commission_records_count,
    COALESCE((
      SELECT SUM(cr.agency_net_amount)
      FROM commission_records cr
      WHERE cr.tour_id = t.id
      AND cr.status = 'pending'
    ), 0)::numeric as total_commission_pending,
    (CURRENT_DATE - t.end_date >= 3) as ready_for_payout,
    (
      NOT EXISTS(SELECT 1 FROM commission_records cr WHERE cr.tour_id = t.id)
      AND EXISTS(SELECT 1 FROM bookings b2 WHERE b2.tour_id = t.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')
    ) as can_create_commissions
  FROM tours t
  INNER JOIN agencies a ON a.id = t.agency_id
  LEFT JOIN bookings b ON b.tour_id = t.id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
  WHERE t.end_date < CURRENT_DATE
  GROUP BY t.id, t.name, t.tour_code, t.agency_id, a.name, t.end_date
  HAVING COUNT(DISTINCT b.id) > 0
  ORDER BY t.end_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_tours_end_date ON tours(end_date);

CREATE INDEX IF NOT EXISTS idx_commission_records_tour_status ON commission_records(tour_id, status);

-- Comentarios para documentación
COMMENT ON FUNCTION create_commission_records_for_tour(uuid) IS
'Crea commission_records para todas las reservas confirmadas y pagadas de un tour completado';

COMMENT ON FUNCTION is_tour_ready_for_payout(uuid) IS
'Verifica si un tour está listo para pago (>= 3 días después de finalizar)';

COMMENT ON FUNCTION get_completed_tours_with_commission_status() IS
'Obtiene todos los tours completados con información detallada sobre el estado de sus comisiones';
