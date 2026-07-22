-- ============================================================
-- FUNCIÓN AUXILIAR: get_effective_commission_rates
-- Devuelve (agency_commission_rate, service_charge_rate) para una agencia dada.
-- agency_commission_rate es la fracción decimal (ej: 0.15)
-- service_charge_rate es la fracción decimal (ej: 0.05)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_commission_rates(p_agency_id uuid)
RETURNS TABLE(agency_commission_rate numeric, service_charge_rate numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_rate numeric;
  v_platform_commission numeric;
  v_platform_service_charge numeric;
BEGIN
  -- Obtener la tasa específica de la agencia
  SELECT a.commission_rate
  INTO v_agency_rate
  FROM public.agencies a
  WHERE a.id = p_agency_id;

  -- Obtener los defaults de platform_settings
  SELECT
    ps.agency_commission_percentage / 100.0,
    ps.service_charge_percentage / 100.0
  INTO v_platform_commission, v_platform_service_charge
  FROM public.platform_settings ps
  LIMIT 1;

  -- Usar tasa de la agencia si está configurada, si no el default de platform_settings
  agency_commission_rate := COALESCE(v_agency_rate, v_platform_commission, 0.15);
  service_charge_rate    := COALESCE(v_platform_service_charge, 0.05);

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_commission_rates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_commission_rates(uuid) TO service_role;


-- ============================================================
-- 1. calculate_commission_breakdown
-- Cambia DEFAULT 0.10/0.03 a NULL; si son NULL, lee platform_settings.
-- Mantiene compatibilidad con llamadas que ya pasan rates explícitos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_commission_breakdown(
  p_total_price numeric,
  p_agency_commission_rate numeric DEFAULT NULL,
  p_service_charge_rate numeric DEFAULT NULL
)
RETURNS TABLE(
  agency_commission numeric,
  service_charge numeric,
  platform_revenue numeric,
  agency_net_amount numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_commission_rate numeric;
  v_service_rate numeric;
  v_platform_commission numeric;
  v_platform_service_charge numeric;
BEGIN
  -- Si no se pasaron rates, leer de platform_settings
  IF p_agency_commission_rate IS NULL OR p_service_charge_rate IS NULL THEN
    SELECT
      ps.agency_commission_percentage / 100.0,
      ps.service_charge_percentage / 100.0
    INTO v_platform_commission, v_platform_service_charge
    FROM public.platform_settings ps
    LIMIT 1;
  END IF;

  v_commission_rate := COALESCE(p_agency_commission_rate, v_platform_commission, 0.15);
  v_service_rate    := COALESCE(p_service_charge_rate,    v_platform_service_charge, 0.05);

  agency_commission := p_total_price * v_commission_rate;
  service_charge    := p_total_price * v_service_rate;
  platform_revenue  := agency_commission + service_charge;
  agency_net_amount := p_total_price - agency_commission;

  RETURN NEXT;
END;
$$;


-- ============================================================
-- 2. calculate_payment_breakdown
-- Agrega parámetros opcionales; si no se pasan, lee platform_settings.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_payment_breakdown(
  p_price numeric,
  p_deposit_percentage integer,
  p_travelers_count integer DEFAULT 1,
  p_agency_commission_rate numeric DEFAULT NULL,
  p_service_charge_rate numeric DEFAULT NULL
)
RETURNS TABLE(
  total_price numeric,
  deposit_amount numeric,
  agency_commission numeric,
  service_charge numeric,
  user_payment numeric,
  platform_revenue numeric,
  agency_receives numeric,
  balance_due numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_commission_rate numeric;
  v_service_rate numeric;
  v_platform_commission numeric;
  v_platform_service_charge numeric;
BEGIN
  -- Si no se pasaron rates, leer de platform_settings
  IF p_agency_commission_rate IS NULL OR p_service_charge_rate IS NULL THEN
    SELECT
      ps.agency_commission_percentage / 100.0,
      ps.service_charge_percentage / 100.0
    INTO v_platform_commission, v_platform_service_charge
    FROM public.platform_settings ps
    LIMIT 1;
  END IF;

  v_commission_rate := COALESCE(p_agency_commission_rate, v_platform_commission, 0.15);
  v_service_rate    := COALESCE(p_service_charge_rate,    v_platform_service_charge, 0.05);

  -- Calcular el precio total
  total_price    := p_price * p_travelers_count;

  -- Calcular el depósito
  deposit_amount := total_price * (p_deposit_percentage / 100.0);

  -- Calcular comisiones con los rates efectivos
  agency_commission := total_price * v_commission_rate;
  service_charge    := total_price * v_service_rate;

  -- Lo que paga el usuario
  user_payment := deposit_amount + service_charge;

  -- Lo que recibe la plataforma
  platform_revenue := agency_commission + service_charge;

  -- Lo que recibe la agencia
  agency_receives := deposit_amount - agency_commission;

  -- Saldo pendiente
  balance_due := total_price - deposit_amount;

  RETURN NEXT;
END;
$$;


-- ============================================================
-- 3. create_commission_records_for_tour
-- Lee la tasa real de la agencia y el service_charge de platform_settings.
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
  -- Verificar que el tour existe y ha finalizado
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

  -- Obtener las tasas efectivas para la agencia del tour
  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_tour_record.agency_id);

  -- Iterar sobre todas las reservas confirmadas y pagadas del tour
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

  -- Contar reservas que ya tenían commission_records
  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND EXISTS (
      SELECT 1 FROM public.commission_records cr
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
$$;


-- ============================================================
-- 4. create_commission_records_for_receptivo_slot
-- Lee la tasa real de la agencia del slot y el service_charge de platform_settings.
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
  -- Verificar que el slot existe, ya pasó su fecha y el tour es receptivo
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

  -- Obtener las tasas efectivas para la agencia del slot
  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_slot_record.agency_id);

  -- Iterar sobre reservas confirmadas y pagadas del slot que aún no tienen commission_record
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

  -- Contar reservas que ya tenían commission_record
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


-- ============================================================
-- 5. record_booking_financial_transaction (trigger)
-- Reemplaza COALESCE(..., 0.10) y COALESCE(..., 0.03) con lecturas reales.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_booking_financial_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_breakdown  record;
  v_agency_id  uuid;
  v_tour_id    uuid;
  v_rates      record;
  v_comm_rate  numeric;
  v_svc_rate   numeric;
BEGIN
  -- Solo procesar cuando la reserva pasa a confirmada con pago exitoso
  IF NEW.status = 'confirmed' AND NEW.payment_status = 'succeeded'
     AND (OLD.status != 'confirmed' OR OLD.payment_status != 'succeeded') THEN

    SELECT agency_id, tour_id INTO v_agency_id, v_tour_id
    FROM public.bookings
    WHERE id = NEW.id;

    -- Obtener tasas efectivas: primero intentar derivar de los montos ya guardados
    -- en el booking; si no están disponibles, leer de la configuración
    IF NEW.commission_amount IS NOT NULL AND NEW.total_price > 0 THEN
      v_comm_rate := NEW.commission_amount / NEW.total_price;
    ELSE
      SELECT agency_commission_rate INTO v_comm_rate
      FROM public.get_effective_commission_rates(v_agency_id);
    END IF;

    IF NEW.service_charge IS NOT NULL AND NEW.total_price > 0 THEN
      v_svc_rate := NEW.service_charge / NEW.total_price;
    ELSE
      SELECT service_charge_rate INTO v_svc_rate
      FROM public.get_effective_commission_rates(v_agency_id);
    END IF;

    -- Calcular breakdown
    SELECT * INTO v_breakdown
    FROM public.calculate_transaction_breakdown(
      'booking',
      NEW.total_price,
      v_comm_rate,
      v_svc_rate,
      NULL
    );

    INSERT INTO public.financial_transactions (
      transaction_date,
      transaction_type,
      agency_id,
      booking_id,
      tour_id,
      gross_amount,
      platform_commission,
      net_to_agency,
      platform_revenue,
      description,
      payment_status,
      reconciliation_status
    ) VALUES (
      NEW.paid_at,
      'booking',
      v_agency_id,
      NEW.id,
      v_tour_id,
      v_breakdown.gross_amount,
      v_breakdown.platform_commission,
      v_breakdown.net_to_agency,
      v_breakdown.platform_revenue,
      'Booking confirmed - ' || NEW.booking_code,
      'pending',
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 6. record_cancellation_financial_transaction (trigger)
-- Reemplaza COALESCE(..., 0.10) y COALESCE(..., 0.03) con lecturas reales.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_cancellation_financial_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_breakdown        record;
  v_booking          record;
  v_transaction_type text;
  v_comm_rate        numeric;
  v_svc_rate         numeric;
BEGIN
  -- Obtener detalles de la reserva
  SELECT b.*, b.agency_id, b.tour_id INTO v_booking
  FROM public.bookings b
  WHERE b.id = NEW.booking_id;

  -- Determinar tipo de transacción según la política de cancelación
  CASE NEW.cancellation_policy_type
    WHEN '100_percent'      THEN v_transaction_type := 'cancellation_full';
    WHEN '50_percent'       THEN v_transaction_type := 'cancellation_partial';
    WHEN 'no_refund'        THEN v_transaction_type := 'no_show';
    WHEN 'no_show'          THEN v_transaction_type := 'no_show';
    WHEN 'pending_approval' THEN v_transaction_type := 'cancellation_full';
    ELSE                         v_transaction_type := 'cancellation_full';
  END CASE;

  -- Derivar tasas de los montos guardados en el booking;
  -- si no están disponibles, leer de la configuración real
  IF v_booking.commission_amount IS NOT NULL AND v_booking.total_price > 0 THEN
    v_comm_rate := v_booking.commission_amount / v_booking.total_price;
  ELSE
    SELECT agency_commission_rate INTO v_comm_rate
    FROM public.get_effective_commission_rates(v_booking.agency_id);
  END IF;

  IF v_booking.service_charge IS NOT NULL AND v_booking.total_price > 0 THEN
    v_svc_rate := v_booking.service_charge / v_booking.total_price;
  ELSE
    SELECT service_charge_rate INTO v_svc_rate
    FROM public.get_effective_commission_rates(v_booking.agency_id);
  END IF;

  -- Calcular breakdown
  SELECT * INTO v_breakdown
  FROM public.calculate_transaction_breakdown(
    v_transaction_type,
    NEW.original_deposit_amount,
    v_comm_rate,
    v_svc_rate,
    NEW.cancellation_policy_type
  );

  INSERT INTO public.financial_transactions (
    transaction_date,
    transaction_type,
    agency_id,
    booking_id,
    tour_id,
    cancellation_id,
    gross_amount,
    platform_commission,
    net_to_agency,
    platform_revenue,
    description,
    payment_status,
    reconciliation_status,
    metadata
  ) VALUES (
    NEW.cancelled_at,
    v_transaction_type,
    v_booking.agency_id,
    NEW.booking_id,
    v_booking.tour_id,
    NEW.id,
    v_breakdown.gross_amount,
    v_breakdown.platform_commission,
    v_breakdown.net_to_agency,
    v_breakdown.platform_revenue,
    'Cancellation - ' || NEW.cancellation_policy_type || ' policy',
    CASE WHEN v_breakdown.net_to_agency > 0 THEN 'pending' ELSE 'cancelled' END,
    'pending',
    jsonb_build_object(
      'cancellation_policy', NEW.cancellation_policy_type,
      'days_before_tour',    NEW.days_before_tour,
      'refund_to_traveler',  NEW.refund_amount_to_traveler
    )
  );

  RETURN NEW;
END;
$$;
