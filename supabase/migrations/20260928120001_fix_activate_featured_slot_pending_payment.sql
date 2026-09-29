-- Fix regression: activate_featured_slot was inserting slots with status='active'
-- directly (reintroduced by 20260814204756_add_advisory_lock_activate_featured_slot.sql,
-- which was based on the pre-payment version of this function). That made
-- create-featured-slot-checkout always fail with 404 ("Slot not found or not in
-- pending_payment status"), since it looks up the slot with status='pending_payment',
-- which the RPC never produced. It also meant tours were marked as featured for
-- free, without any payment ever being taken.
--
-- Restores the pending_payment flow from
-- 20260610022404_20260610120001_add_featured_tours_financial_system.sql
-- (slot starts as pending_payment; confirm_featured_slot_payment flips it to
-- active once a payment provider confirms payment), while keeping the
-- ownership/admin authorization check and advisory lock added afterwards.
CREATE OR REPLACE FUNCTION public.activate_featured_slot(p_tour_id uuid, p_agency_id uuid, p_plan_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active_count  int;
  v_slot_id       uuid;
  v_plan          record;
  v_existing_slot uuid;
  v_is_owner      boolean;
  v_is_admin      boolean;
  v_subtotal      numeric(10,2);
  v_tax           numeric(10,2);
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.agencies WHERE id = p_agency_id AND user_id = auth.uid()) INTO v_is_owner;
  v_is_admin := public.is_admin_user();
  IF NOT v_is_owner AND NOT v_is_admin THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('featured_slots'::text));

  SELECT count(*) INTO v_active_count
  FROM public.featured_tour_slots
  WHERE status = 'active' AND expires_at > now();

  IF v_active_count >= 50 THEN
    RAISE EXCEPTION 'Maximum of 50 active featured slots reached';
  END IF;

  SELECT id INTO v_existing_slot
  FROM public.featured_tour_slots
  WHERE tour_id = p_tour_id AND status = 'active' AND expires_at > now()
  FOR UPDATE;

  IF v_existing_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Tour already has an active featured slot';
  END IF;

  SELECT * INTO v_plan FROM public.featured_plans WHERE id = p_plan_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or inactive';
  END IF;

  v_subtotal := ROUND((v_plan.price / 1.16)::numeric, 2);
  v_tax      := v_plan.price - v_subtotal;

  -- Slot starts as pending_payment; confirm_featured_slot_payment (called from the
  -- payment provider webhooks) sets status='active' and finalizes starts_at/expires_at
  -- once payment is confirmed.
  INSERT INTO public.featured_tour_slots (
    tour_id, agency_id, plan_id, status,
    starts_at, expires_at,
    subtotal, tax_amount, total_amount
  )
  VALUES (
    p_tour_id, p_agency_id, p_plan_id, 'pending_payment',
    now(), now() + (v_plan.duration_days || ' days')::interval,
    v_subtotal, v_tax, v_plan.price
  )
  RETURNING id INTO v_slot_id;

  RETURN v_slot_id;
END;
$function$;
