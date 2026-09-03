-- ============================================================
-- 1. Columnas nuevas en tours
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'commission_rate_override'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN commission_rate_override numeric;
    ALTER TABLE public.tours ADD CONSTRAINT tours_commission_rate_override_check
      CHECK (commission_rate_override IS NULL OR (commission_rate_override >= 0 AND commission_rate_override <= 0.5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'commission_override_expires_at'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN commission_override_expires_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'commission_override_reason'
  ) THEN
    ALTER TABLE public.tours ADD COLUMN commission_override_reason text;
  END IF;
END $$;


-- ============================================================
-- 2. get_effective_commission_rates — ahora acepta p_tour_id opcional
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_commission_rates(
  p_agency_id uuid,
  p_tour_id   uuid DEFAULT NULL
)
RETURNS TABLE(
  agency_commission_rate numeric,
  service_charge_rate    numeric,
  rate_source            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tour_override    numeric;
  v_override_expires timestamptz;
  v_agency_rate      numeric;
  v_platform_commission      numeric;
  v_platform_service_charge  numeric;
BEGIN
  -- 1. Verificar override de tour (si se pasó tour_id)
  IF p_tour_id IS NOT NULL THEN
    SELECT t.commission_rate_override, t.commission_override_expires_at
    INTO v_tour_override, v_override_expires
    FROM public.tours t
    WHERE t.id = p_tour_id;

    -- El override es válido si no es NULL y (no tiene fecha de expiración O aún no ha expirado)
    IF v_tour_override IS NOT NULL
       AND (v_override_expires IS NULL OR v_override_expires > now()) THEN
      -- Leer service_charge de platform_settings
      SELECT ps.service_charge_percentage / 100.0
      INTO v_platform_service_charge
      FROM public.platform_settings ps
      LIMIT 1;

      agency_commission_rate := v_tour_override;
      service_charge_rate    := COALESCE(v_platform_service_charge, 0.05);
      rate_source            := 'tour_override';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- 2. Tasa específica de la agencia
  SELECT a.commission_rate
  INTO v_agency_rate
  FROM public.agencies a
  WHERE a.id = p_agency_id;

  -- 3. Defaults de platform_settings
  SELECT
    ps.agency_commission_percentage / 100.0,
    ps.service_charge_percentage / 100.0
  INTO v_platform_commission, v_platform_service_charge
  FROM public.platform_settings ps
  LIMIT 1;

  agency_commission_rate := COALESCE(v_agency_rate, v_platform_commission, 0.15);
  service_charge_rate    := COALESCE(v_platform_service_charge, 0.05);
  rate_source            := CASE
    WHEN v_agency_rate IS NOT NULL THEN 'agency'
    ELSE 'platform'
  END;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_commission_rates(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_commission_rates(uuid, uuid) TO service_role;


-- ============================================================
-- 3. create_commission_records_for_tour — usa tour_id al resolver tasas
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_records_for_tour(p_tour_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tour_record        record;
  v_booking_record     record;
  v_commission_record_id uuid;
  v_created_count      integer := 0;
  v_skipped_count      integer := 0;
  v_rates              record;
BEGIN
  SELECT t.id, t.agency_id, t.end_date, t.name
  INTO v_tour_record
  FROM public.tours t
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

  -- Resolver tasas con prioridad tour → agencia → plataforma
  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_tour_record.agency_id, p_tour_id);

  FOR v_booking_record IN
    SELECT
      b.id          AS booking_id,
      b.agency_id,
      b.total_price,
      b.commission_amount,
      b.service_charge,
      b.platform_revenue
    FROM public.bookings b
    WHERE b.tour_id = p_tour_id
      AND b.status = 'confirmed'
      AND b.payment_status = 'succeeded'
      AND NOT EXISTS (
        SELECT 1 FROM public.commission_records cr
        WHERE cr.booking_id = b.id
      )
  LOOP
    INSERT INTO public.commission_records (
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
      v_rates.agency_commission_rate,
      v_booking_record.commission_amount,
      v_rates.service_charge_rate,
      v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount,
      'pending',
      now()
    )
    RETURNING id INTO v_commission_record_id;

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND EXISTS (
      SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
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
$$;


-- ============================================================
-- 4. create_commission_records_for_receptivo_slot — usa tour_id al resolver tasas
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_record    record;
  v_booking_record record;
  v_created_count  integer := 0;
  v_skipped_count  integer := 0;
  v_rates          record;
BEGIN
  SELECT
    ts.id,
    ts.slot_date,
    ts.departure_time,
    ts.tour_id,
    t.name     AS tour_name,
    t.agency_id,
    t.tour_type
  INTO v_slot_record
  FROM public.tour_slots ts
  INNER JOIN public.tours t ON t.id = ts.tour_id
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

  -- Resolver tasas con prioridad tour → agencia → plataforma
  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_slot_record.agency_id, v_slot_record.tour_id);

  FOR v_booking_record IN
    SELECT
      b.id          AS booking_id,
      b.agency_id,
      b.total_price,
      b.commission_amount,
      b.service_charge,
      b.platform_revenue
    FROM public.bookings b
    WHERE b.slot_id = p_slot_id
      AND b.status = 'confirmed'
      AND b.payment_status = 'succeeded'
      AND NOT EXISTS (
        SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
      )
  LOOP
    INSERT INTO public.commission_records (
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
      v_rates.agency_commission_rate,
      v_booking_record.commission_amount,
      v_rates.service_charge_rate,
      v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount,
      'pending',
      now()
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND EXISTS (
      SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
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
