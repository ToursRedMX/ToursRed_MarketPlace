-- Part 11: Add advisory lock to auto_generate_slots_for_range
-- Prevents duplicate slot creation on concurrent calls
CREATE OR REPLACE FUNCTION public.auto_generate_slots_for_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule RECORD;
  v_current_date date;
  v_slot_exists boolean;
  v_created_count int := 0;
  v_tour RECORD;
BEGIN
  -- Advisory lock prevents concurrent slot generation for the same tour
  PERFORM pg_advisory_xact_lock(hashtext(p_tour_id::text));

  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour no encontrado';
  END IF;

  IF v_tour.tour_type <> 'receptivo' THEN
    RAISE EXCEPTION 'Solo tours receptivos soportan generacion automatica de slots';
  END IF;

  FOR v_schedule IN
    SELECT * FROM public.tour_schedules
    WHERE tour_id = p_tour_id
      AND is_active = true
  LOOP
    v_current_date := GREATEST(p_start_date, v_schedule.start_date);
    IF v_schedule.end_date IS NOT NULL THEN
      v_current_date := GREATEST(v_current_date, CURRENT_DATE);
    END IF;

    WHILE v_current_date <= p_end_date
      AND (v_schedule.end_date IS NULL OR v_current_date <= v_schedule.end_date)
    LOOP
      -- Check if slot exists
      SELECT EXISTS (
        SELECT 1 FROM public.tour_slots ts
        WHERE ts.tour_id = p_tour_id
          AND ts.schedule_id = v_schedule.id
          AND ts.slot_date = v_current_date
          AND ts.status != 'cancelado'
      ) INTO v_slot_exists;

      IF NOT v_slot_exists THEN
        INSERT INTO public.tour_slots (
          tour_id, schedule_id, slot_date, departure_time,
          capacity, booked_count, status
        ) VALUES (
          p_tour_id, v_schedule.id, v_current_date, v_schedule.departure_time,
          v_schedule.capacity, 0, 'activo'
        );
        v_created_count := v_created_count + 1;
      END IF;

      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
  END LOOP;

  RETURN v_created_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) TO authenticated, service_role;