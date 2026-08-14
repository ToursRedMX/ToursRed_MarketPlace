-- Part 13: Add advisory lock to activate_featured_slot
-- Prevents race condition on the 50-slot cap and per-tour uniqueness check
CREATE OR REPLACE FUNCTION public.activate_featured_slot(
  p_tour_id   uuid,
  p_agency_id uuid,
  p_plan_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count  int;
  v_slot_id       uuid;
  v_plan          RECORD;
  v_existing_slot uuid;
BEGIN
  -- Advisory lock prevents concurrent activations from exceeding the cap
  PERFORM pg_advisory_xact_lock(hashtext('featured_slots'::text));

  -- Global cap on active slots
  SELECT COUNT(*) INTO v_active_count
  FROM public.featured_tour_slots
  WHERE status = 'active' AND expires_at > now();

  IF v_active_count >= 50 THEN
    RAISE EXCEPTION 'Maximum of 50 active featured slots reached';
  END IF;

  -- No active slot for this tour
  SELECT id INTO v_existing_slot
  FROM public.featured_tour_slots
  WHERE tour_id = p_tour_id AND status = 'active' AND expires_at > now()
  FOR UPDATE;

  IF v_existing_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Tour already has an active featured slot';
  END IF;

  -- Get plan details
  SELECT * INTO v_plan FROM public.featured_tour_plans WHERE id = p_plan_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or inactive';
  END IF;

  -- Insert the new slot
  INSERT INTO public.featured_tour_slots (
    tour_id, agency_id, plan_id, status, activated_at, expires_at, total_amount
  ) VALUES (
    p_tour_id, p_agency_id, p_plan_id, 'active', now(),
    now() + (v_plan.duration_days || ' days')::interval,
    v_plan.price
  )
  RETURNING id INTO v_slot_id;

  RETURN v_slot_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) TO authenticated, service_role;