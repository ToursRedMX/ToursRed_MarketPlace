/*
# Fix hold_seats: release stale own holds + allow re-selecting own held seats

## Problem
In the specific-seats mode (p_seat_numbers), hold_seats had two bugs:

1. **Holds accumulated without release**: When a user changed their seat selection
   within the same session, the previous holds for that session/tour/slot were never
   released. The old seats stayed in seat_holds, consuming capacity and eventually
   causing "no available seats" errors. Confirmed with real data: seats 2, 5, 6, 11,
   12, 14, 15, 17 all accumulated under the same session without any being released.

2. **Own held seats rejected as unavailable**: When the same session re-requested a
   seat it already held (not expired), the INSERT collided with the unique index
   seat_holds_unique_seat and the seat was reported as "failed" instead of being
   recognized as already held by the same session.

## Fix
Two changes, both in the specific-seats branch of hold_seats:

### Change 1: Release own holds not in the new selection (before the loop)
Before iterating over p_seat_numbers, delete all seat_holds for this session/tour/slot
whose seat_number is NOT in the new selection. This mirrors the cleanup pattern already
used in the generic-capacity mode (which deletes all NULL-seat holds for the session
before inserting a new one).

### Change 2: Recognize own existing hold (inside the loop, before INSERT)
Before attempting the INSERT for each seat, check if the current session already holds
that seat (non-expired). If so, extend expires_at and treat it as success (CONTINUE),
instead of letting the INSERT collide with the unique index.

## Scope
- Only modifies the `hold_seats` function.
- No schema changes, no new tables, no RLS changes.
- The generic-capacity mode and create_booking_atomic are untouched.
- Function signature, return type, SECURITY DEFINER, and grants are unchanged.
*/

CREATE OR REPLACE FUNCTION public.hold_seats(
  p_tour_id uuid,
  p_slot_id uuid,
  p_session_id text,
  p_seat_numbers integer[] DEFAULT NULL,
  p_held_count integer DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_hold_minutes integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz := now() + (p_hold_minutes || ' minutes')::interval;
  v_seat integer;
  v_held integer[] := '{}';
  v_failed integer[] := '{}';
  v_conflicting_count integer;
  v_own_hold_count integer;
BEGIN
  -- Mode A: specific seats
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN

    -- ----------------------------------------------------------------
    -- FIX 1: Release own holds for this tour/slot whose seat_number is
    -- NOT in the new selection. This prevents stale holds from the same
    -- session from accumulating when the user changes their selection.
    -- ----------------------------------------------------------------
    DELETE FROM seat_holds
    WHERE tour_id = p_tour_id
      AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
      AND session_id = p_session_id
      AND seat_number IS NOT NULL
      AND seat_number != ALL(p_seat_numbers);

    FOREACH v_seat IN ARRAY p_seat_numbers LOOP
      -- Check if seat is already permanently taken
      SELECT COUNT(*) INTO v_conflicting_count
      FROM slot_seat_status
      WHERE tour_id = p_tour_id
        AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
        AND seat_number = v_seat
        AND status IN ('reservado_online', 'bloqueado_agencia');

      IF v_conflicting_count > 0 THEN
        v_failed := array_append(v_failed, v_seat);
        CONTINUE;
      END IF;

      -- Delete any EXPIRED hold for this exact seat so the unique index
      -- doesn't block a new user because of a stale row.
      DELETE FROM seat_holds
      WHERE tour_id = p_tour_id
        AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
        AND seat_number = v_seat
        AND expires_at <= now();

      -- ----------------------------------------------------------------
      -- FIX 2: Check if THIS session already holds this seat (non-expired).
      -- If so, extend the expiry and treat it as success without re-inserting.
      -- This avoids a false "failed" when the user re-selects a seat they
      -- already have on hold.
      -- ----------------------------------------------------------------
      SELECT COUNT(*) INTO v_own_hold_count
      FROM seat_holds
      WHERE tour_id = p_tour_id
        AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
        AND seat_number = v_seat
        AND session_id = p_session_id
        AND expires_at > now();

      IF v_own_hold_count > 0 THEN
        UPDATE seat_holds
          SET expires_at = v_expires_at
        WHERE tour_id = p_tour_id
          AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
          AND seat_number = v_seat
          AND session_id = p_session_id;
        v_held := array_append(v_held, v_seat);
        CONTINUE;
      END IF;

      -- Check if there is still an active hold by another session
      SELECT COUNT(*) INTO v_conflicting_count
      FROM seat_holds
      WHERE tour_id = p_tour_id
        AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
        AND seat_number = v_seat
        AND session_id != p_session_id
        AND expires_at > now();

      IF v_conflicting_count > 0 THEN
        v_failed := array_append(v_failed, v_seat);
        CONTINUE;
      END IF;

      -- The unique index now catches concurrent inserts on the same seat
      BEGIN
        INSERT INTO seat_holds (tour_id, slot_id, seat_number, session_id, user_id, expires_at)
        VALUES (p_tour_id, p_slot_id, v_seat, p_session_id, p_user_id, v_expires_at);
        v_held := array_append(v_held, v_seat);
      EXCEPTION WHEN unique_violation THEN
        v_failed := array_append(v_failed, v_seat);
      END;
    END LOOP;

    RETURN jsonb_build_object(
      'mode', 'specific_seats',
      'held', to_jsonb(v_held),
      'failed', to_jsonb(v_failed)
    );
  END IF;

  -- Mode B: generic capacity hold
  IF p_held_count IS NOT NULL AND p_held_count > 0 THEN
    DELETE FROM seat_holds
    WHERE tour_id = p_tour_id
      AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
      AND session_id = p_session_id
      AND seat_number IS NULL;

    INSERT INTO seat_holds (tour_id, slot_id, seat_number, held_count, session_id, user_id, expires_at)
    VALUES (p_tour_id, p_slot_id, NULL, p_held_count, p_session_id, p_user_id, v_expires_at);

    RETURN jsonb_build_object(
      'mode', 'generic_capacity',
      'held_count', p_held_count,
      'expires_at', v_expires_at
    );
  END IF;

  RETURN jsonb_build_object('mode', 'noop', 'message', 'No seats or count provided');
END;
$$;

GRANT EXECUTE ON FUNCTION public.hold_seats TO authenticated;
