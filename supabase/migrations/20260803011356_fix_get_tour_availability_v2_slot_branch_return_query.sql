/*
# Fix get_tour_availability_v2 slot branch: use RETURN QUERY properly

## Problem
The previous migration's slot branch used a malformed INTO clause that assigned
all columns to the same variables, and a dangling second SELECT without INTO.
The slot branch returned no rows.

## Fix
Replace the slot branch with a clean RETURN QUERY SELECT, same pattern as the
original function, but keeping the new subqueries for blocked seats and holds.
*/

CREATE OR REPLACE FUNCTION public.get_tour_availability_v2(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL
)
RETURNS TABLE (
  available_spots integer,
  total_capacity integer,
  booked_count integer,
  slot_date date,
  departure_time time
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour record;
  v_capacity integer;
  v_booked   integer;
  v_blocked  integer;
  v_held     integer;
BEGIN
  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour not found: %', p_tour_id;
  END IF;

  IF p_slot_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      GREATEST(0, ts.capacity - ts.booked_count
        - (SELECT COUNT(*)::integer FROM public.slot_seat_status sss
           WHERE sss.slot_id = p_slot_id AND sss.status = 'bloqueado_agencia')
        - COALESCE((SELECT SUM(sh.held_count)::integer FROM public.seat_holds sh
           WHERE sh.slot_id = p_slot_id AND sh.seat_number IS NULL
             AND sh.expires_at > now()), 0)
      )::integer AS available_spots,
      ts.capacity AS total_capacity,
      ts.booked_count AS booked_count,
      ts.slot_date AS slot_date,
      ts.departure_time AS departure_time
    FROM public.tour_slots ts
    WHERE ts.id = p_slot_id
      AND ts.tour_id = p_tour_id;
  ELSE
    v_capacity := COALESCE(
      CASE
        WHEN v_tour.available_spots IS NOT NULL AND v_tour.available_spots > 0
          THEN v_tour.available_spots
        ELSE COALESCE(v_tour.max_travelers, 10)
      END,
      10
    );

    SELECT COALESCE(SUM(b.travelers_count), 0)::integer
    INTO v_booked
    FROM public.bookings b
    WHERE b.tour_id = p_tour_id
      AND (
        b.status = 'confirmed'
        OR (b.status = 'pending' AND b.approval_status = 'approved')
      );

    SELECT COUNT(*)::integer
    INTO v_blocked
    FROM public.slot_seat_status sss
    WHERE sss.tour_id = p_tour_id
      AND sss.status = 'bloqueado_agencia'
      AND sss.slot_id IS NULL;

    SELECT COALESCE(SUM(sh.held_count), 0)::integer
    INTO v_held
    FROM public.seat_holds sh
    WHERE sh.tour_id = p_tour_id
      AND sh.slot_id IS NULL
      AND sh.seat_number IS NULL
      AND sh.expires_at > now();

    RETURN QUERY
    SELECT
      GREATEST(0, v_capacity - v_booked - v_blocked - v_held)::integer AS available_spots,
      v_capacity::integer AS total_capacity,
      v_booked::integer AS booked_count,
      v_tour.start_date::date AS slot_date,
      NULL::time AS departure_time;
  END IF;
END;
$$;
