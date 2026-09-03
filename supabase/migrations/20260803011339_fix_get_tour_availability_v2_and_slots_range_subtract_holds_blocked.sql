/*
# Fix availability functions to subtract seat holds and blocked agency seats

## Problem
Three availability functions were returning inflated numbers:
1. `get_tour_availability_v2` (NULL branch): read `tours.available_spots` directly as
   "available", but no trigger keeps that column updated when bookings are confirmed.
   It becomes stale and shows places that are already taken.
2. `get_tour_availability_v2` (slot branch): computed `capacity - booked_count` only,
   ignoring active seat_holds and blocked agency seats — unlike `create_booking_atomic`
   which subtracts all three.
3. `get_tour_slots_by_range`: same issue — `available_count` was `capacity - booked_count`
   with no hold or blocked subtraction, so the calendar showed slots as more available
   than they really were.

## Fix
All three functions now subtract the same three things that `create_booking_atomic`
already subtracts at booking time:

- **Confirmed/approved bookings**: `SUM(travelers_count)` from `bookings` with
  `status = 'confirmed' OR (status = 'pending' AND approval_status = 'approved')`.
  For the slot branch, `tour_slots.booked_count` already reflects this (kept in sync
  by `update_slot_booked_count` trigger), so it is reused.
- **Blocked agency seats**: `COUNT(*)` from `slot_seat_status` with
  `status = 'bloqueado_agencia'`.
- **Active generic holds**: `COALESCE(SUM(held_count), 0)` from `seat_holds` with
  `seat_number IS NULL AND expires_at > now()`.

## Functions modified (all SECURITY DEFINER, search_path = public)
1. `get_tour_availability_v2(p_tour_id, p_slot_id DEFAULT NULL)`
   - NULL branch: now computes capacity from `tours.available_spots`/`max_travelers`
     (as a capacity ceiling, NOT as remaining spots), then subtracts real bookings,
     blocked seats, and active holds — same logic as the old `get_tour_availability`.
   - Slot branch: now subtracts blocked seats and active holds in addition to
     `booked_count`.
2. `get_tour_slots_by_range(p_tour_id, p_start_date, p_end_date)`
   - `available_count` now subtracts blocked seats and active holds per slot.

## Security
- No RLS or policy changes.
- All functions remain SECURITY DEFINER, search_path = public.
- No grants changed (existing grants on these functions are preserved).
*/

-- ============================================================
-- 1. Rewrite get_tour_availability_v2
-- ============================================================

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

  -- Si hay slot_id, calcular disponibilidad del slot específico
  IF p_slot_id IS NOT NULL THEN
    SELECT
      GREATEST(0, ts.capacity - ts.booked_count
        - (SELECT COUNT(*)::integer FROM public.slot_seat_status sss
           WHERE sss.slot_id = p_slot_id AND sss.status = 'bloqueado_agencia')
        - COALESCE((SELECT SUM(sh.held_count)::integer FROM public.seat_holds sh
           WHERE sh.slot_id = p_slot_id AND sh.seat_number IS NULL
             AND sh.expires_at > now()), 0)
      ) AS available_spots,
      ts.capacity AS total_capacity,
      ts.booked_count,
      ts.slot_date,
      ts.departure_time
    INTO v_capacity, v_capacity, v_booked, v_capacity, v_capacity
    FROM public.tour_slots ts
    WHERE ts.id = p_slot_id
      AND ts.tour_id = p_tour_id;

    -- Use proper variables for return
    SELECT
      GREATEST(0, ts.capacity - ts.booked_count
        - (SELECT COUNT(*)::integer FROM public.slot_seat_status sss
           WHERE sss.slot_id = p_slot_id AND sss.status = 'bloqueado_agencia')
        - COALESCE((SELECT SUM(sh.held_count)::integer FROM public.seat_holds sh
           WHERE sh.slot_id = p_slot_id AND sh.seat_number IS NULL
             AND sh.expires_at > now()), 0)
      ),
      ts.capacity,
      ts.booked_count,
      ts.slot_date,
      ts.departure_time
    FROM public.tour_slots ts
    WHERE ts.id = p_slot_id
      AND ts.tour_id = p_tour_id;

  ELSE
    -- Comportamiento para tours de fecha única (sin slots)
    -- Capacity: available_spots is a manual override of capacity, NOT remaining spots
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
    RETURN;
  END IF;
END;
$$;

-- ============================================================
-- 2. Rewrite get_tour_slots_by_range to subtract holds + blocked
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_tour_slots_by_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  id uuid,
  tour_id uuid,
  agency_id uuid,
  schedule_id uuid,
  slot_date date,
  departure_time time without time zone,
  end_date date,
  capacity integer,
  booked_count integer,
  available_count integer,
  status slot_status_enum,
  is_auto_generated boolean,
  min_travelers_reached boolean,
  notes text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.tour_id,
    ts.agency_id,
    ts.schedule_id,
    ts.slot_date,
    ts.departure_time,
    ts.end_date,
    ts.capacity,
    ts.booked_count,
    GREATEST(0,
      ts.capacity - ts.booked_count
      - (SELECT COUNT(*)::integer FROM public.slot_seat_status sss
         WHERE sss.slot_id = ts.id AND sss.status = 'bloqueado_agencia')
      - COALESCE((SELECT SUM(sh.held_count)::integer FROM public.seat_holds sh
         WHERE sh.slot_id = ts.id AND sh.seat_number IS NULL
           AND sh.expires_at > now()), 0)
    ) AS available_count,
    ts.status,
    ts.is_auto_generated,
    ts.min_travelers_reached,
    ts.notes,
    ts.created_at
  FROM public.tour_slots ts
  WHERE ts.tour_id = p_tour_id
    AND ts.slot_date >= p_start_date
    AND ts.slot_date <= p_end_date
    AND ts.status != 'cancelado'
    AND NOT EXISTS (
      SELECT 1
      FROM public.tour_slot_blackouts b
      WHERE b.tour_id = p_tour_id
        AND ts.slot_date >= b.blackout_start::date
        AND ts.slot_date <= b.blackout_end::date
    )
  ORDER BY ts.slot_date ASC, ts.departure_time ASC;
END;
$$;
