-- Fix calculate_booking_financial_breakdown: booking_optional_services uses is_cancelled, not status
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

  -- Optional services: uses is_cancelled + paid_at, NOT status
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
