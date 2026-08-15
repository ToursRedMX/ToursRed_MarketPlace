/*
# Refresh commission records on post-anticipo events + late-payment penalty commission

## Context
The trigger `create_commission_record()` on `bookings` only fires once (when `payment_status` transitions to 'succeeded', i.e. the anticipo). After that, when the traveler pays partialities, buys optional services, or pays supplements, the `commission_records` row is NEVER refreshed — so `payment_plan_service_charges`, `optional_services_subtotal`, `supplements_subtotal` etc. stay at 0 even though the money was collected. Additionally, late-payment penalties (`booking_payment_plan_installments.penalty_applied`) are charged to the traveler but ToursRed never takes its commission share on them, and they never reach the financial breakdown.

## Changes
1. New columns on `commission_records`: late_payment_penalty_total, late_payment_penalty_commission, late_payment_penalty_agency_net.
2. `calculate_booking_financial_breakdown` rewritten (DROP + CREATE) to add 3 penalty output columns; penalty commission derived from booking's own commission_amount/total_price.
3. New reusable `refresh_commission_record(p_booking_id)` that UPSERTs the commission row (only updates if row exists; creation stays with the anticipo trigger).
4. `create_commission_record()` trigger rewritten to delegate to refresh_commission_record when a row already exists, and to create the row on first anticipo.
5. Three new triggers call refresh_commission_record on payment_plan_transactions (status->completed), optional_services (is_cancelled/paid_at), supplements (status->paid/cancelled).
6. Backfill re-runs breakdown for every existing commission_records row.

## Security
- All new functions SECURITY DEFINER, search_path='public', granted to authenticated + service_role.
- No new tables, no RLS changes, no data deletion.
*/

-- ============================================================
-- 1. New columns on commission_records
-- ============================================================
ALTER TABLE public.commission_records
  ADD COLUMN IF NOT EXISTS late_payment_penalty_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_payment_penalty_commission numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_payment_penalty_agency_net numeric DEFAULT 0;

-- ============================================================
-- 2. calculate_booking_financial_breakdown (DROP + CREATE with new outputs)
-- ============================================================
DROP FUNCTION IF EXISTS public.calculate_booking_financial_breakdown(uuid);

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
  late_payment_penalty_total numeric,
  late_payment_penalty_commission numeric,
  late_payment_penalty_agency_net numeric,
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
  v_penalty_total   numeric := 0;
  v_penalty_comm    numeric := 0;
  v_penalty_net     numeric := 0;
  v_effective_rate  numeric;
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

  -- Derive the exact effective commission rate from the booking's own data.
  -- commission_amount was already calculated at anticipo time with the correct rate
  -- (tour override > agency > platform), so this ratio honours overrides without re-querying.
  v_effective_rate := CASE
    WHEN total_tour_price > 0 THEN agency_commission_amount / total_tour_price
    ELSE 0
  END;

  SELECT
    COALESCE(SUM(COALESCE(t.service_charge, 0)), 0),
    COALESCE(SUM(CASE WHEN t.membership_exemption_used = true THEN COALESCE(t.gross_service_charge, 0) - COALESCE(t.service_charge, 0) ELSE 0 END), 0)
  INTO v_pp_sc, v_pp_exemption
  FROM public.booking_payment_plan_transactions t
  WHERE t.booking_id = p_booking_id AND t.status = 'completed';

  payment_plan_service_charges := v_pp_sc;
  payment_plan_membership_exemptions := v_pp_exemption;

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

  -- Late-payment penalty: only count penalty actually collected on fully-paid installments
  SELECT COALESCE(SUM(inst.penalty_applied), 0)
  INTO v_penalty_total
  FROM public.booking_payment_plan_installments inst
  WHERE inst.booking_id = p_booking_id
    AND inst.status = 'paid'
    AND COALESCE(inst.penalty_applied, 0) > 0;

  v_penalty_comm := v_penalty_total * v_effective_rate;
  v_penalty_net  := v_penalty_total - v_penalty_comm;

  late_payment_penalty_total := v_penalty_total;
  late_payment_penalty_commission := v_penalty_comm;
  late_payment_penalty_agency_net := v_penalty_net;

  platform_total_revenue := agency_commission_amount
    + net_service_charge
    + v_pp_sc
    + v_opt_sc
    + v_supp_sc
    + v_penalty_comm;

  agency_payout_total := agency_net_tour
    + optional_services_agency_net
    + supplements_agency_net
    + v_penalty_net;

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_booking_financial_breakdown(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. refresh_commission_record(p_booking_id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_commission_record(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking         record;
  v_agency_rate     numeric;
  v_service_rate    numeric;
  v_existing_id     uuid;
  v_breakdown       record;
BEGIN
  SELECT b.id, b.agency_id, b.tour_id, b.total_price, b.commission_amount,
         b.service_charge, b.membership_service_fee_saved, b.preventa_comision_descuento,
         b.travel_insurance_cost
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only refresh if a commission_records row already exists (anticipo trigger owns creation).
  SELECT id INTO v_existing_id
  FROM public.commission_records
  WHERE booking_id = p_booking_id LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT agency_commission_rate, service_charge_rate
  INTO v_agency_rate, v_service_rate
  FROM public.get_effective_commission_rates(v_booking.agency_id, v_booking.tour_id);

  v_agency_rate  := COALESCE(v_agency_rate, 0.15);
  v_service_rate := COALESCE(v_service_rate, 0.05);

  SELECT * INTO v_breakdown
  FROM public.calculate_booking_financial_breakdown(p_booking_id);

  UPDATE public.commission_records SET
    total_tour_price = v_booking.total_price,
    agency_commission_rate = v_agency_rate,
    agency_commission_amount = COALESCE(v_booking.commission_amount, 0),
    service_charge_rate = v_service_rate,
    service_charge_amount = v_breakdown.net_service_charge,
    gross_service_charge_amount = v_breakdown.gross_service_charge,
    membership_exemption_total = v_breakdown.membership_exemption_total,
    preventa_comision_descuento = COALESCE(v_booking.preventa_comision_descuento, 0),
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
    late_payment_penalty_total = v_breakdown.late_payment_penalty_total,
    late_payment_penalty_commission = v_breakdown.late_payment_penalty_commission,
    late_payment_penalty_agency_net = v_breakdown.late_payment_penalty_agency_net,
    platform_total_revenue = v_breakdown.platform_total_revenue,
    agency_net_amount = v_breakdown.agency_payout_total,
    travel_insurance_amount = COALESCE(v_booking.travel_insurance_cost, 0)
  WHERE id = v_existing_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_commission_record(uuid) TO authenticated, service_role;

-- ============================================================
-- 4. Rewrite create_commission_record() trigger
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

    SELECT id INTO v_existing_id
    FROM public.commission_records
    WHERE booking_id = NEW.id LIMIT 1;

    IF FOUND THEN
      PERFORM public.refresh_commission_record(NEW.id);
    ELSE
      SELECT agency_commission_rate, service_charge_rate
      INTO v_agency_rate, v_service_rate
      FROM public.get_effective_commission_rates(NEW.agency_id, NEW.tour_id);
      v_agency_rate  := COALESCE(v_agency_rate, 0.15);
      v_service_rate := COALESCE(v_service_rate, 0.05);

      SELECT * INTO v_breakdown
      FROM public.calculate_booking_financial_breakdown(NEW.id);

      INSERT INTO public.commission_records (
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
        late_payment_penalty_total, late_payment_penalty_commission,
        late_payment_penalty_agency_net,
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
        v_breakdown.late_payment_penalty_total, v_breakdown.late_payment_penalty_commission,
        v_breakdown.late_payment_penalty_agency_net,
        v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
        COALESCE(NEW.travel_insurance_cost, 0), 'pending'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 5. Three new triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_commission_on_payment_plan_txn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.refresh_commission_record(NEW.booking_id);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
      PERFORM public.refresh_commission_record(NEW.booking_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS refresh_commission_on_payment_plan_txn_trigger
  ON public.booking_payment_plan_transactions;
CREATE TRIGGER refresh_commission_on_payment_plan_txn_trigger
  AFTER INSERT OR UPDATE OF status ON public.booking_payment_plan_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_commission_on_payment_plan_txn();

CREATE OR REPLACE FUNCTION public.refresh_commission_on_optional_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.refresh_commission_record(NEW.booking_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS refresh_commission_on_optional_service_trigger
  ON public.booking_optional_services;
CREATE TRIGGER refresh_commission_on_optional_service_trigger
  AFTER INSERT OR UPDATE OF is_cancelled, paid_at ON public.booking_optional_services
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_commission_on_optional_service();

CREATE OR REPLACE FUNCTION public.refresh_commission_on_supplement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('paid', 'cancelled') THEN
      PERFORM public.refresh_commission_record(NEW.booking_id);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('paid', 'cancelled') AND (OLD.status IS NULL OR OLD.status <> NEW.status) THEN
      PERFORM public.refresh_commission_record(NEW.booking_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS refresh_commission_on_supplement_trigger
  ON public.booking_supplements;
CREATE TRIGGER refresh_commission_on_supplement_trigger
  AFTER INSERT OR UPDATE OF status ON public.booking_supplements
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_commission_on_supplement();

-- ============================================================
-- 6. Backfill
-- ============================================================
DO $$
DECLARE
  v_rec record;
  v_breakdown record;
  v_agency_rate numeric;
BEGIN
  FOR v_rec IN
    SELECT cr.id, cr.booking_id, cr.agency_id, cr.tour_id,
           b.preventa_comision_descuento, b.travel_insurance_cost
    FROM public.commission_records cr
    JOIN public.bookings b ON b.id = cr.booking_id
  LOOP
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_rec.booking_id);

    SELECT agency_commission_rate INTO v_agency_rate
    FROM public.get_effective_commission_rates(v_rec.agency_id, v_rec.tour_id);
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
      late_payment_penalty_total = v_breakdown.late_payment_penalty_total,
      late_payment_penalty_commission = v_breakdown.late_payment_penalty_commission,
      late_payment_penalty_agency_net = v_breakdown.late_payment_penalty_agency_net,
      platform_total_revenue = v_breakdown.platform_total_revenue,
      agency_net_amount = v_breakdown.agency_payout_total,
      travel_insurance_amount = COALESCE(v_rec.travel_insurance_cost, 0)
    WHERE id = v_rec.id;
  END LOOP;
END $$;
