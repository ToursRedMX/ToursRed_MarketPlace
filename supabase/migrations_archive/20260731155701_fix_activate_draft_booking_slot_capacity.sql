/*
# Fix activate_draft_booking: validate capacity per slot, not tour-wide

## Problem
The `activate_draft_booking` function validated availability by summing
`travelers_count` of all confirmed/approved bookings across the ENTIRE tour,
then comparing against `tours.max_travelers` / `tours.available_spots`
(defaulting to 10 when NULL). This caused false "no availability" rejections
on tours that use the slot system (`tour_slots`), where each date/slot has its
own independent capacity.

## Fix
When the booking has a `slot_id` (tours with the slot system), the function now
locks the specific `tour_slots` row and validates against that slot's remaining
capacity (`capacity - booked_count`) — the same source of truth the rest of the
availability system uses.

When the booking has NO `slot_id` (tours without the slot system), the function
keeps the existing fallback: tour-wide `max_travelers` / `available_spots`
(default 10) minus confirmed/approved bookings across the tour.

## Changes
- `CREATE OR REPLACE FUNCTION activate_draft_booking(p_booking_id uuid)`
  - Now reads `slot_id` from the booking record.
  - Branch 1 (slot_id IS NOT NULL): `SELECT ... FROM tour_slots WHERE id = slot_id FOR UPDATE`,
    compute `v_available = capacity - booked_count`.
  - Branch 2 (slot_id IS NULL): unchanged tour-wide fallback logic.
  - Status transition, return contract, SECURITY DEFINER, and GRANT unchanged.

## Security
- No RLS or policy changes.
- Function remains SECURITY DEFINER, search_path = public, EXECUTE granted to authenticated.
*/

CREATE OR REPLACE FUNCTION activate_draft_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_slot record;
  v_max_capacity integer;
  v_total_booked integer;
  v_available integer;
BEGIN
  SELECT b.id, b.status, b.tour_id, b.travelers_count, b.approval_status, b.slot_id
  INTO v_booking
  FROM bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada');
  END IF;

  IF v_booking.status != 'draft' THEN
    RETURN jsonb_build_object('success', true, 'message', 'La reserva ya fue activada');
  END IF;

  IF v_booking.slot_id IS NOT NULL THEN
    -- Tours with the slot system: validate against the specific slot's capacity
    SELECT ts.capacity, ts.booked_count
    INTO v_slot
    FROM tour_slots ts
    WHERE ts.id = v_booking.slot_id
    FOR UPDATE;

    IF v_slot IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El slot seleccionado ya no existe');
    END IF;

    v_available := v_slot.capacity - v_slot.booked_count;
  ELSE
    -- Tours without the slot system: fallback to tour-wide capacity
    SELECT
      COALESCE(
        CASE
          WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
          THEN t.available_spots
          ELSE COALESCE(t.max_travelers, 10)
        END,
        10
      ),
      COALESCE(SUM(ob.travelers_count), 0)::integer
    INTO v_max_capacity, v_total_booked
    FROM tours t
    LEFT JOIN bookings ob
      ON ob.tour_id = t.id
      AND ob.id != p_booking_id
      AND (
        ob.status = 'confirmed'
        OR (ob.status = 'pending' AND ob.approval_status = 'approved')
      )
    WHERE t.id = v_booking.tour_id
    GROUP BY t.id, t.available_spots, t.max_travelers;

    v_available := v_max_capacity - v_total_booked;
  END IF;

  IF v_booking.travelers_count > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No hay suficientes lugares disponibles',
      'available_spots', v_available,
      'requested', v_booking.travelers_count
    );
  END IF;

  UPDATE bookings
  SET status = 'pending',
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'available_spots', v_available - v_booking.travelers_count);
END;
$$;

GRANT EXECUTE ON FUNCTION activate_draft_booking TO authenticated;
