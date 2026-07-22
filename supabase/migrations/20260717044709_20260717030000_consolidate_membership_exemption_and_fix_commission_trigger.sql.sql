-- ============================================================
-- 1. Centralized membership exemption function with row-level locking
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_membership_service_fee_exemption(
  p_user_id uuid,
  p_gross_service_charge numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_membership_id   uuid;
  v_exemption_used  numeric;
  v_reset_date      timestamptz;
  v_exemption_available numeric;
  v_exemption_applied   numeric;
  v_net_service_charge  numeric;
  v_monthly_limit numeric := 500;
BEGIN
  -- Lock the membership row to prevent concurrent reads from racing
  SELECT id, service_fee_exemption_used, service_fee_exemption_reset_date
  INTO v_membership_id, v_exemption_used, v_reset_date
  FROM public.memberships
  WHERE user_id = p_user_id
    AND status <> 'expired'
    AND current_period_end > now()
  ORDER BY current_period_end DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'exemption_applied', 0,
      'net_service_charge', p_gross_service_charge,
      'gross_service_charge', p_gross_service_charge
    );
  END IF;

  -- Reset monthly pool if the period has elapsed
  IF now() >= v_reset_date THEN
    UPDATE public.memberships
    SET service_fee_exemption_used = 0,
        service_fee_exemption_reset_date = date_trunc('month', now() + interval '1 month')
    WHERE id = v_membership_id;

    v_exemption_used := 0;
  END IF;

  v_exemption_available := GREATEST(0, v_monthly_limit - COALESCE(v_exemption_used, 0));
  v_exemption_applied := LEAST(v_exemption_available, p_gross_service_charge);
  v_net_service_charge := p_gross_service_charge - v_exemption_applied;

  -- Atomically consume from the pool in the same locked transaction
  IF v_exemption_applied > 0 THEN
    UPDATE public.memberships
    SET service_fee_exemption_used = COALESCE(service_fee_exemption_used, 0) + v_exemption_applied
    WHERE id = v_membership_id;
  END IF;

  RETURN json_build_object(
    'exemption_applied', v_exemption_applied,
    'net_service_charge', v_net_service_charge,
    'gross_service_charge', p_gross_service_charge
  );
END;
$function$;

-- ============================================================
-- 2. Add gross_service_charge column to booking_payment_plan_transactions
-- ============================================================

ALTER TABLE public.booking_payment_plan_transactions
  ADD COLUMN IF NOT EXISTS gross_service_charge numeric DEFAULT 0;

-- ============================================================
-- 3. Fix calculate_booking_financial_breakdown: payment_plan_membership_exemptions
--    Use gross_service_charge from transactions instead of reverse-engineering
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_booking_financial_breakdown(p_booking_id uuid)
RETURNS TABLE(
  total_tour_price numeric,
  agency_commission_amount numeric,
  gross_service_charge numeric,
  membership_exemption_total numeric,
  net_service_charge numeric,
  agency_net_tour numeric,
  payment_plan_service_charges numeric,
  payment_plan_membership_exemptions numeric,
  optional_services_subtotal numeric,
  optional_services_commission numeric,
  optional_services_service_charge numeric,
  optional_services_agency_net numeric,
  supplements_subtotal numeric,
  supplements_commission numeric,
  supplements_service_charge numeric,
  supplements_agency_net numeric,
  platform_total_revenue numeric,
  agency_payout_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    b.membership_service_fee_saved,
    b.preventa_comision_descuento
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
  agency_net_tour := total_tour_price - agency_commission_amount;

  -- Payment plan transactions: use gross_service_charge column for accurate exemption
  SELECT
    COALESCE(SUM(COALESCE(t.service_charge, 0)), 0),
    COALESCE(SUM(COALESCE(t.gross_service_charge, 0) - COALESCE(t.service_charge, 0)), 0)
  INTO v_pp_sc, v_pp_exemption
  FROM public.booking_payment_plan_transactions t
  WHERE t.booking_id = p_booking_id AND t.status = 'completed';

  payment_plan_service_charges := v_pp_sc;
  payment_plan_membership_exemptions := v_pp_exemption;

  -- Optional services
  SELECT
    COALESCE(SUM(bos.subtotal), 0),
    COALESCE(SUM(bos.subtotal * 0.10), 0),
    COALESCE(SUM(bos.service_charge), 0)
  INTO v_opt_subtotal, v_opt_commission, v_opt_sc
  FROM public.booking_optional_services bos
  WHERE bos.booking_id = p_booking_id AND bos.status = 'paid';

  optional_services_subtotal := v_opt_subtotal;
  optional_services_commission := v_opt_commission;
  optional_services_service_charge := v_opt_sc;
  optional_services_agency_net := v_opt_subtotal - v_opt_commission;

  -- Supplements
  SELECT
    COALESCE(SUM(bs.unit_price * bs.quantity), 0),
    COALESCE(SUM(bs.supplement_commission), 0),
    COALESCE(SUM(bs.service_charge), 0)
  INTO v_supp_subtotal, v_supp_commission, v_supp_sc
  FROM public.booking_supplements bs
  WHERE bs.booking_id = p_booking_id AND bs.status = 'paid';

  supplements_subtotal := v_supp_subtotal;
  supplements_commission := v_supp_commission;
  supplements_service_charge := v_supp_sc;
  supplements_agency_net := v_supp_subtotal - v_supp_commission;

  platform_total_revenue := agency_commission_amount
    + net_service_charge
    + v_pp_sc
    + v_opt_sc
    + v_supp_sc;

  agency_payout_total := agency_net_tour
    + optional_services_agency_net
    + supplements_agency_net;

  RETURN NEXT;
END;
$function$;

-- ============================================================
-- 4. Fix create_commission_record() trigger: use NEW.commission_amount
--    (already has preventa discount) instead of recalculating
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_commission_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agency_rate numeric;
  v_service_rate numeric;
  v_service_charge numeric;
  v_platform_revenue numeric;
  v_agency_net numeric;
  v_existing_id uuid;
BEGIN
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN

    SELECT a.commission_rate INTO v_agency_rate
    FROM public.agencies a WHERE a.id = NEW.agency_id;

    SELECT ps.service_charge_percentage / 100.0 INTO v_service_rate
    FROM public.platform_settings ps LIMIT 1;

    v_agency_rate := COALESCE(v_agency_rate, 0.15);
    v_service_rate := COALESCE(v_service_rate, 0.05);

    -- Use NEW.commission_amount (already includes preventa discount if applicable)
    v_service_charge := COALESCE(NEW.service_charge, 0);
    v_platform_revenue := COALESCE(NEW.commission_amount, 0) + v_service_charge;
    v_agency_net := NEW.total_price - COALESCE(NEW.commission_amount, 0);

    -- Check if record already exists (idempotency for re-fires)
    SELECT id INTO v_existing_id
    FROM public.commission_records
    WHERE booking_id = NEW.id LIMIT 1;

    IF FOUND THEN
      -- Update existing record with corrected values
      UPDATE public.commission_records SET
        total_tour_price = NEW.total_price,
        agency_commission_rate = v_agency_rate,
        agency_commission_amount = COALESCE(NEW.commission_amount, 0),
        service_charge_rate = v_service_rate,
        service_charge_amount = v_service_charge,
        gross_service_charge_amount = v_service_charge + COALESCE(NEW.membership_service_fee_saved, 0),
        membership_exemption_total = COALESCE(NEW.membership_service_fee_saved, 0),
        preventa_comision_descuento = COALESCE(NEW.preventa_comision_descuento, 0),
        platform_total_revenue = v_platform_revenue,
        agency_net_amount = v_agency_net,
        travel_insurance_amount = COALESCE(NEW.travel_insurance_cost, 0),
        updated_at = now()
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO commission_records (
        booking_id, agency_id, tour_id, total_tour_price,
        agency_commission_rate, agency_commission_amount,
        service_charge_rate, service_charge_amount,
        gross_service_charge_amount, membership_exemption_total,
        preventa_comision_descuento,
        platform_total_revenue, agency_net_amount,
        travel_insurance_amount, status
      ) VALUES (
        NEW.id, NEW.agency_id, NEW.tour_id, NEW.total_price,
        v_agency_rate, COALESCE(NEW.commission_amount, 0),
        v_service_rate, v_service_charge,
        v_service_charge + COALESCE(NEW.membership_service_fee_saved, 0),
        COALESCE(NEW.membership_service_fee_saved, 0),
        COALESCE(NEW.preventa_comision_descuento, 0),
        v_platform_revenue, v_agency_net,
        COALESCE(NEW.travel_insurance_cost, 0), 'pending'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 5. Convert create_commission_records_for_tour to UPSERT
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_commission_records_for_tour(p_tour_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tour_record        record;
  v_booking_record     record;
  v_breakdown          record;
  v_commission_record_id uuid;
  v_created_count      integer := 0;
  v_updated_count      integer := 0;
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
      'created_count', 0, 'skipped_count', 0
    );
  END IF;

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_tour_record.agency_id);

  FOR v_booking_record IN
    SELECT
      b.id AS booking_id, b.agency_id, b.total_price,
      b.commission_amount, b.service_charge, b.platform_revenue,
      b.membership_service_fee_saved, b.preventa_comision_descuento,
      b.travel_insurance_cost
    FROM public.bookings b
    WHERE b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
  LOOP
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

    INSERT INTO public.commission_records (
      booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
      agency_commission_rate, agency_commission_amount,
      service_charge_rate, service_charge_amount,
      gross_service_charge_amount, membership_exemption_total,
      preventa_comision_descuento,
      payment_plan_service_charges, payment_plan_membership_exemptions,
      optional_services_subtotal, optional_services_commission,
      optional_services_service_charge, optional_services_agency_net,
      supplements_subtotal, supplements_commission,
      supplements_service_charge, supplements_agency_net,
      platform_total_revenue, agency_net_amount, status, created_at
    ) VALUES (
      v_booking_record.booking_id, v_booking_record.agency_id,
      p_tour_id, v_tour_record.end_date, v_booking_record.total_price,
      v_rates.agency_commission_rate, v_booking_record.commission_amount,
      v_rates.service_charge_rate, v_booking_record.service_charge,
      v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
      COALESCE(v_booking_record.preventa_comision_descuento, 0),
      v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
      v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
      v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
      v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
      v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
      v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
      'pending', now()
    )
    ON CONFLICT (booking_id) DO UPDATE SET
      total_tour_price = EXCLUDED.total_tour_price,
      agency_commission_amount = EXCLUDED.agency_commission_amount,
      service_charge_amount = EXCLUDED.service_charge_amount,
      gross_service_charge_amount = EXCLUDED.gross_service_charge_amount,
      membership_exemption_total = EXCLUDED.membership_exemption_total,
      preventa_comision_descuento = EXCLUDED.preventa_comision_descuento,
      payment_plan_service_charges = EXCLUDED.payment_plan_service_charges,
      payment_plan_membership_exemptions = EXCLUDED.payment_plan_membership_exemptions,
      optional_services_subtotal = EXCLUDED.optional_services_subtotal,
      optional_services_commission = EXCLUDED.optional_services_commission,
      optional_services_service_charge = EXCLUDED.optional_services_service_charge,
      optional_services_agency_net = EXCLUDED.optional_services_agency_net,
      supplements_subtotal = EXCLUDED.supplements_subtotal,
      supplements_commission = EXCLUDED.supplements_commission,
      supplements_service_charge = EXCLUDED.supplements_service_charge,
      supplements_agency_net = EXCLUDED.supplements_agency_net,
      platform_total_revenue = EXCLUDED.platform_total_revenue,
      agency_net_amount = EXCLUDED.agency_net_amount,
      updated_at = now()
    RETURNING id INTO v_commission_record_id;

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.tour_id = p_tour_id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
  );

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados/actualizados exitosamente',
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
$function$;

-- ============================================================
-- 6. Convert create_commission_records_for_receptivo_slot to UPSERT
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot_record    record;
  v_booking_record record;
  v_breakdown      record;
  v_created_count  integer := 0;
  v_skipped_count  integer := 0;
  v_rates          record;
BEGIN
  SELECT
    ts.id, ts.slot_date, ts.departure_time, ts.tour_id,
    t.name AS tour_name, t.agency_id, t.tour_type
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
      'created_count', 0, 'skipped_count', 0
    );
  END IF;

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_slot_record.agency_id);

  FOR v_booking_record IN
    SELECT
      b.id AS booking_id, b.agency_id, b.total_price,
      b.commission_amount, b.service_charge, b.platform_revenue,
      b.membership_service_fee_saved, b.preventa_comision_descuento,
      b.travel_insurance_cost
    FROM public.bookings b
    WHERE b.slot_id = p_slot_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
  LOOP
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

    INSERT INTO public.commission_records (
      booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
      agency_commission_rate, agency_commission_amount,
      service_charge_rate, service_charge_amount,
      gross_service_charge_amount, membership_exemption_total,
      preventa_comision_descuento,
      payment_plan_service_charges, payment_plan_membership_exemptions,
      optional_services_subtotal, optional_services_commission,
      optional_services_service_charge, optional_services_agency_net,
      supplements_subtotal, supplements_commission,
      supplements_service_charge, supplements_agency_net,
      platform_total_revenue, agency_net_amount, status, created_at
    ) VALUES (
      v_booking_record.booking_id, v_booking_record.agency_id,
      v_slot_record.tour_id, v_slot_record.slot_date, v_booking_record.total_price,
      v_rates.agency_commission_rate, v_booking_record.commission_amount,
      v_rates.service_charge_rate, v_booking_record.service_charge,
      v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
      COALESCE(v_booking_record.preventa_comision_descuento, 0),
      v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
      v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
      v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
      v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
      v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
      v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
      'pending', now()
    )
    ON CONFLICT (booking_id) DO UPDATE SET
      total_tour_price = EXCLUDED.total_tour_price,
      agency_commission_amount = EXCLUDED.agency_commission_amount,
      service_charge_amount = EXCLUDED.service_charge_amount,
      gross_service_charge_amount = EXCLUDED.gross_service_charge_amount,
      membership_exemption_total = EXCLUDED.membership_exemption_total,
      preventa_comision_descuento = EXCLUDED.preventa_comision_descuento,
      payment_plan_service_charges = EXCLUDED.payment_plan_service_charges,
      payment_plan_membership_exemptions = EXCLUDED.payment_plan_membership_exemptions,
      optional_services_subtotal = EXCLUDED.optional_services_subtotal,
      optional_services_commission = EXCLUDED.optional_services_commission,
      optional_services_service_charge = EXCLUDED.optional_services_service_charge,
      optional_services_agency_net = EXCLUDED.optional_services_agency_net,
      supplements_subtotal = EXCLUDED.supplements_subtotal,
      supplements_commission = EXCLUDED.supplements_commission,
      supplements_service_charge = EXCLUDED.supplements_service_charge,
      supplements_agency_net = EXCLUDED.supplements_agency_net,
      platform_total_revenue = EXCLUDED.platform_total_revenue,
      agency_net_amount = EXCLUDED.agency_net_amount,
      updated_at = now();

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
  );

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados/actualizados exitosamente',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$function$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.apply_membership_service_fee_exemption(uuid, numeric) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.calculate_booking_financial_breakdown(uuid) TO authenticated;
