-- ============================================================
-- Fix 1: calculate_booking_financial_breakdown payment plan exemption
-- Only count exemption where membership_exemption_used = true
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

  total_tour_price := COALESCE(v_booking.total_price, 0);
  agency_commission_amount := COALESCE(v_booking.commission_amount, 0);
  gross_service_charge := COALESCE(v_booking.service_charge, 0) + COALESCE(v_booking.membership_service_fee_saved, 0);
  membership_exemption_total := COALESCE(v_booking.membership_service_fee_saved, 0);
  net_service_charge := COALESCE(v_booking.service_charge, 0);
  agency_net_tour := total_tour_price - agency_commission_amount;

  -- Payment plan: only count exemption when membership_exemption_used = true
  SELECT
    COALESCE(SUM(COALESCE(t.service_charge, 0)), 0),
    COALESCE(SUM(CASE WHEN t.membership_exemption_used = true THEN COALESCE(t.gross_service_charge, 0) - COALESCE(t.service_charge, 0) ELSE 0 END), 0)
  INTO v_pp_sc, v_pp_exemption
  FROM public.booking_payment_plan_transactions t
  WHERE t.booking_id = p_booking_id AND t.status = 'completed';

  payment_plan_service_charges := v_pp_sc;
  payment_plan_membership_exemptions := v_pp_exemption;

  -- Optional services: uses is_cancelled + paid_at
  SELECT
    COALESCE(SUM(bos.subtotal), 0),
    COALESCE(SUM(bos.agency_commission), 0),
    COALESCE(SUM(bos.service_charge), 0)
  INTO v_opt_subtotal, v_opt_commission, v_opt_sc
  FROM public.booking_optional_services bos
  WHERE bos.booking_id = p_booking_id
    AND COALESCE(bos.is_cancelled, false) = false
    AND bos.paid_at IS NOT NULL;

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
-- Fix 2: create_commission_record trigger calls breakdown function
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agency_rate    numeric;
  v_service_rate   numeric;
  v_existing_id    uuid;
  v_breakdown      record;
BEGIN
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN

    SELECT a.commission_rate INTO v_agency_rate
    FROM public.agencies a WHERE a.id = NEW.agency_id;

    SELECT ps.service_charge_percentage / 100.0 INTO v_service_rate
    FROM public.platform_settings ps LIMIT 1;

    v_agency_rate := COALESCE(v_agency_rate, 0.15);
    v_service_rate := COALESCE(v_service_rate, 0.05);

    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(NEW.id);

    SELECT id INTO v_existing_id
    FROM public.commission_records
    WHERE booking_id = NEW.id LIMIT 1;

    IF FOUND THEN
      UPDATE public.commission_records SET
        total_tour_price = NEW.total_price,
        agency_commission_rate = v_agency_rate,
        agency_commission_amount = COALESCE(NEW.commission_amount, 0),
        service_charge_rate = v_service_rate,
        service_charge_amount = v_breakdown.net_service_charge,
        gross_service_charge_amount = v_breakdown.gross_service_charge,
        membership_exemption_total = v_breakdown.membership_exemption_total,
        preventa_comision_descuento = COALESCE(NEW.preventa_comision_descuento, 0),
        payment_plan_service_charges = v_breakdown.payment_plan_service_charges,
        payment_plan_membership_exemptions = v_breakdown.payment_plan_membership_exemptions,
        optional_services_subtotal = v_breakdown.optional_services_subtotal,
        optional_services_commission = v_breakdown.optional_services_commission,
        optional_services_service_charge = v_breakdown.optional_services_service_charge,
        optional_services_agency_net = v_breakdown.optional_services_agency_net,
        supplements_subtotal = v_breakdown.supplements_subtotal,
        supplements_commission = v_breakdown.supplements_commission,
        supplements_service_charge = v_breakdown.supplements_service_charge,
        supplements_agency_net = v_breakdown.supplements_agency_net,
        platform_total_revenue = v_breakdown.platform_total_revenue,
        agency_net_amount = v_breakdown.agency_payout_total,
        travel_insurance_amount = COALESCE(NEW.travel_insurance_cost, 0)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO commission_records (
        booking_id, agency_id, tour_id, total_tour_price,
        agency_commission_rate, agency_commission_amount,
        service_charge_rate, service_charge_amount,
        gross_service_charge_amount, membership_exemption_total,
        preventa_comision_descuento,
        payment_plan_service_charges, payment_plan_membership_exemptions,
        optional_services_subtotal, optional_services_commission,
        optional_services_service_charge, optional_services_agency_net,
        supplements_subtotal, supplements_commission,
        supplements_service_charge, supplements_agency_net,
        platform_total_revenue, agency_net_amount,
        travel_insurance_amount, status
      ) VALUES (
        NEW.id, NEW.agency_id, NEW.tour_id, NEW.total_price,
        v_agency_rate, COALESCE(NEW.commission_amount, 0),
        v_service_rate, v_breakdown.net_service_charge,
        v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
        COALESCE(NEW.preventa_comision_descuento, 0),
        v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
        v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
        v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
        v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
        v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
        v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
        COALESCE(NEW.travel_insurance_cost, 0), 'pending'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- Fix 3: Backfill all existing commission_records
-- ============================================================
DO $$
DECLARE
  v_rec record;
  v_breakdown record;
  v_agency_rate numeric;
BEGIN
  FOR v_rec IN
    SELECT cr.id, cr.booking_id, cr.agency_id, b.preventa_comision_descuento, b.travel_insurance_cost
    FROM public.commission_records cr
    JOIN public.bookings b ON b.id = cr.booking_id
  LOOP
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_rec.booking_id);

    SELECT a.commission_rate INTO v_agency_rate
    FROM public.agencies a WHERE a.id = v_rec.agency_id;
    v_agency_rate := COALESCE(v_agency_rate, 0.15);

    UPDATE public.commission_records SET
      agency_commission_rate = v_agency_rate,
      service_charge_amount = v_breakdown.net_service_charge,
      gross_service_charge_amount = v_breakdown.gross_service_charge,
      membership_exemption_total = v_breakdown.membership_exemption_total,
      preventa_comision_descuento = COALESCE(v_rec.preventa_comision_descuento, 0),
      payment_plan_service_charges = v_breakdown.payment_plan_service_charges,
      payment_plan_membership_exemptions = v_breakdown.payment_plan_membership_exemptions,
      optional_services_subtotal = v_breakdown.optional_services_subtotal,
      optional_services_commission = v_breakdown.optional_services_commission,
      optional_services_service_charge = v_breakdown.optional_services_service_charge,
      optional_services_agency_net = v_breakdown.optional_services_agency_net,
      supplements_subtotal = v_breakdown.supplements_subtotal,
      supplements_commission = v_breakdown.supplements_commission,
      supplements_service_charge = v_breakdown.supplements_service_charge,
      supplements_agency_net = v_breakdown.supplements_agency_net,
      platform_total_revenue = v_breakdown.platform_total_revenue,
      agency_net_amount = v_breakdown.agency_payout_total,
      travel_insurance_amount = COALESCE(v_rec.travel_insurance_cost, 0)
    WHERE id = v_rec.id;
  END LOOP;
END $$;
