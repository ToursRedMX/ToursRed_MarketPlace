-- ============================================================
-- FUNCIÓN AUXILIAR: calculate_booking_financial_breakdown
-- Calcula el desglose financiero completo de un booking,
-- incluyendo tour principal, plan de pagos, opcionales y suplementos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_booking_financial_breakdown(p_booking_id uuid)
RETURNS TABLE(
  total_tour_price           numeric,
  agency_commission_amount   numeric,
  gross_service_charge       numeric,
  membership_exemption_total numeric,
  net_service_charge         numeric,
  agency_net_tour            numeric,
  payment_plan_service_charges        numeric,
  payment_plan_membership_exemptions  numeric,
  optional_services_subtotal      numeric,
  optional_services_commission    numeric,
  optional_services_service_charge numeric,
  optional_services_agency_net    numeric,
  supplements_subtotal      numeric,
  supplements_commission    numeric,
  supplements_service_charge numeric,
  supplements_agency_net    numeric,
  platform_total_revenue    numeric,
  agency_payout_total       numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking         record;
  v_pp_sc           numeric := 0;
  v_pp_exemption    numeric := 0;
  v_opt_subtotal    numeric := 0;
  v_opt_commission  numeric := 0;
  v_opt_sc          numeric := 0;
  v_opt_net         numeric := 0;
  v_supp_subtotal   numeric := 0;
  v_supp_commission numeric := 0;
  v_supp_sc         numeric := 0;
  v_supp_net        numeric := 0;
BEGIN
  SELECT
    b.total_price,
    b.commission_amount,
    b.service_charge,
    b.membership_service_fee_saved
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Tour principal
  total_tour_price := COALESCE(v_booking.total_price, 0);
  agency_commission_amount := COALESCE(v_booking.commission_amount, 0);
  gross_service_charge := COALESCE(v_booking.service_charge, 0) + COALESCE(v_booking.membership_service_fee_saved, 0);
  membership_exemption_total := COALESCE(v_booking.membership_service_fee_saved, 0);
  net_service_charge := COALESCE(v_booking.service_charge, 0);
  agency_net_tour := COALESCE(v_booking.total_price, 0) - COALESCE(v_booking.commission_amount, 0);

  -- Plan de pagos
  SELECT
    COALESCE(SUM(t.service_charge), 0),
    COALESCE(SUM(CASE WHEN t.membership_exemption_used = true THEN t.service_charge ELSE 0 END), 0)
  INTO v_pp_sc, v_pp_exemption
  FROM public.booking_payment_plan_transactions t
  WHERE t.booking_id = p_booking_id
    AND t.status = 'completed';

  payment_plan_service_charges := v_pp_sc;
  payment_plan_membership_exemptions := v_pp_exemption;

  -- Servicios opcionales
  SELECT
    COALESCE(SUM(bos.subtotal), 0),
    COALESCE(SUM(bos.agency_commission), 0),
    COALESCE(SUM(bos.service_charge), 0)
  INTO v_opt_subtotal, v_opt_commission, v_opt_sc
  FROM public.booking_optional_services bos
  WHERE bos.booking_id = p_booking_id
    AND bos.is_cancelled = false;

  optional_services_subtotal := v_opt_subtotal;
  optional_services_commission := v_opt_commission;
  optional_services_service_charge := v_opt_sc;
  optional_services_agency_net := v_opt_subtotal - v_opt_commission;

  -- Suplementos
  SELECT
    COALESCE(SUM(bs.unit_price * bs.quantity), 0),
    COALESCE(SUM(bs.supplement_commission), 0),
    COALESCE(SUM(bs.service_charge), 0)
  INTO v_supp_subtotal, v_supp_commission, v_supp_sc
  FROM public.booking_supplements bs
  WHERE bs.booking_id = p_booking_id
    AND bs.status = 'paid';

  supplements_subtotal := v_supp_subtotal;
  supplements_commission := v_supp_commission;
  supplements_service_charge := v_supp_sc;
  supplements_agency_net := v_supp_subtotal - v_supp_commission;

  -- Totales consolidados
  platform_total_revenue := agency_commission_amount
                            + net_service_charge
                            + payment_plan_service_charges
                            + optional_services_commission + optional_services_service_charge
                            + supplements_commission + supplements_service_charge;

  agency_payout_total := agency_net_tour
                         + optional_services_agency_net
                         + supplements_agency_net;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_booking_financial_breakdown(uuid) TO authenticated, service_role;


-- ============================================================
-- REESCRIBIR: create_commission_records_for_tour
-- Ahora calcula el desglose completo por cada booking
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
  v_breakdown          record;
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

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_tour_record.agency_id);

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
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

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
      gross_service_charge_amount,
      membership_exemption_total,
      payment_plan_service_charges,
      payment_plan_membership_exemptions,
      optional_services_subtotal,
      optional_services_commission,
      optional_services_service_charge,
      optional_services_agency_net,
      supplements_subtotal,
      supplements_commission,
      supplements_service_charge,
      supplements_agency_net,
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
      v_breakdown.gross_service_charge,
      v_breakdown.membership_exemption_total,
      v_breakdown.payment_plan_service_charges,
      v_breakdown.payment_plan_membership_exemptions,
      v_breakdown.optional_services_subtotal,
      v_breakdown.optional_services_commission,
      v_breakdown.optional_services_service_charge,
      v_breakdown.optional_services_agency_net,
      v_breakdown.supplements_subtotal,
      v_breakdown.supplements_commission,
      v_breakdown.supplements_service_charge,
      v_breakdown.supplements_agency_net,
      v_breakdown.platform_total_revenue,
      v_breakdown.agency_payout_total,
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
-- REESCRIBIR: create_commission_records_for_receptivo_slot
-- Con desglose completo igual que create_commission_records_for_tour
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
  v_breakdown      record;
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

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_slot_record.agency_id);

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
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

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
      gross_service_charge_amount,
      membership_exemption_total,
      payment_plan_service_charges,
      payment_plan_membership_exemptions,
      optional_services_subtotal,
      optional_services_commission,
      optional_services_service_charge,
      optional_services_agency_net,
      supplements_subtotal,
      supplements_commission,
      supplements_service_charge,
      supplements_agency_net,
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
      v_breakdown.gross_service_charge,
      v_breakdown.membership_exemption_total,
      v_breakdown.payment_plan_service_charges,
      v_breakdown.payment_plan_membership_exemptions,
      v_breakdown.optional_services_subtotal,
      v_breakdown.optional_services_commission,
      v_breakdown.optional_services_service_charge,
      v_breakdown.optional_services_agency_net,
      v_breakdown.supplements_subtotal,
      v_breakdown.supplements_commission,
      v_breakdown.supplements_service_charge,
      v_breakdown.supplements_agency_net,
      v_breakdown.platform_total_revenue,
      v_breakdown.agency_payout_total,
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
