/*
# Fix race condition in seat_holds + traveler column names in create_booking_atomic

## Purpose
Fixes three critical bugs in the atomic booking infrastructure that were identified
before connecting the new 4-screen booking flow to the "Reservar" button.

## Bug 1: Race condition in hold_seats (missing effective unique index)
The existing `seat_holds_unique_seat` index on `(tour_id, slot_id, seat_number)` does
NOT prevent duplicates when `slot_id IS NULL`, because `NULL != NULL` in SQL uniqueness.
Two concurrent sessions holding the same seat on a non-receptivo tour (slot_id = NULL)
both succeed, and the `EXCEPTION WHEN unique_violation` never fires.

Fix: drop the old index and create a new one using `COALESCE(slot_id, '00000000-...')`
so NULL slot_ids are treated as equal for uniqueness purposes. Also, `hold_seats` now
deletes any expired hold for the same seat before inserting, so a stale hold doesn't
block a new user via the unique index before the cleanup cron runs.

## Bug 2: Travelers never saved (wrong column names + silent exception)
`create_booking_atomic` INSERTs into booking_travelers using column names that don't
exist: `tipo_documento`, `numero_documento`, `curp`, `pasaporte`,
`contacto_emergencia_nombre`, `contacto_emergencia_telefono`, `sexo`.
The real columns are: `documento_tipo`, `documento_numero`,
`emergency_contact_name`, `emergency_contact_phone`. There are no separate
`curp`/`pasaporte`/`sexo` columns — CURP/passport go through documento_tipo/documento_numero.

The INSERT was wrapped in `EXCEPTION WHEN OTHERS THEN NULL`, which swallowed the
column-not-found error completely. The booking reported success with zero travelers saved.

Fix: use the correct column names and REMOVE the silent exception handler so any
traveler insert failure propagates and rolls back the entire transaction.

## Bug 3: No verification that seat assignment actually occurred
The `INSERT INTO slot_seat_status ... ON CONFLICT DO NOTHING` silently does nothing
if two sessions race to the same seat. The booking reports success without a real seat.

Fix: after each INSERT, check `GET DIAGNOSTICS v_rows = ROW_COUNT`. If zero rows were
inserted (conflict), raise an exception to roll back the whole booking and return a
clear error instead of continuing with a phantom seat.

## Changes
1. Recreate `seat_holds_unique_seat` index with COALESCE on slot_id.
2. Rewrite `hold_seats` to delete expired holds for the same seat before inserting.
3. Rewrite `create_booking_atomic` traveler INSERT with correct columns, no silent catch.
4. Rewrite `create_booking_atomic` seat INSERT with ROW_COUNT verification.
5. Remove silent `EXCEPTION WHEN OTHERS THEN NULL` from optional services INSERT too.
*/

-- ============================================================
-- BUG 1: Fix unique index on seat_holds
-- ============================================================

DROP INDEX IF EXISTS public.seat_holds_unique_seat;

CREATE UNIQUE INDEX seat_holds_unique_seat
  ON public.seat_holds (
    tour_id,
    COALESCE(slot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    seat_number
  )
  WHERE seat_number IS NOT NULL;

-- ============================================================
-- BUG 1 + 2 + 3: Rewrite hold_seats function
-- ============================================================

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
BEGIN
  -- Mode A: specific seats
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN
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

-- ============================================================
-- BUG 2 + 3: Rewrite create_booking_atomic (travelers + seat verification)
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_booking_data jsonb,
  p_travelers jsonb DEFAULT '[]'::jsonb,
  p_optional_services jsonb DEFAULT '[]'::jsonb,
  p_session_id text DEFAULT NULL,
  p_seat_numbers integer[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour_id uuid := (p_booking_data->>'tour_id')::uuid;
  v_slot_id uuid := NULL;
  v_travelers_count integer := (p_booking_data->>'travelers_count')::integer;
  v_booking_id uuid;
  v_slot record;
  v_max_capacity integer;
  v_total_booked integer;
  v_blocked integer;
  v_held integer;
  v_available integer;
  v_traveler jsonb;
  v_service jsonb;
  v_seat integer;
  v_rows integer;
  v_doc_tipo text;
  v_doc_numero text;
BEGIN
  v_slot_id := NULLIF(p_booking_data->>'slot_id', '')::uuid;

  -- Validate tour exists
  IF NOT EXISTS (SELECT 1 FROM tours WHERE id = v_tour_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
  END IF;

  -- ---- CAPACITY VALIDATION ----
  IF v_slot_id IS NOT NULL THEN
    SELECT ts.capacity, ts.booked_count
    INTO v_slot
    FROM tour_slots ts
    WHERE ts.id = v_slot_id
    FOR UPDATE;

    IF v_slot IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El horario seleccionado ya no existe');
    END IF;

    SELECT COUNT(*)::integer INTO v_blocked
    FROM slot_seat_status
    WHERE slot_id = v_slot_id
      AND status = 'bloqueado_agencia';

    SELECT COALESCE(SUM(held_count), 0)::integer INTO v_held
    FROM seat_holds
    WHERE slot_id = v_slot_id
      AND seat_number IS NULL
      AND session_id IS DISTINCT FROM p_session_id
      AND expires_at > now();

    v_available := v_slot.capacity - v_slot.booked_count - v_blocked - v_held;
  ELSE
    SELECT
      COALESCE(
        CASE
          WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
            THEN t.available_spots
          ELSE COALESCE(t.max_travelers, 10)
        END,
        10
      )
    INTO v_max_capacity
    FROM tours t WHERE t.id = v_tour_id;

    SELECT COALESCE(SUM(b.travelers_count), 0)::integer
    INTO v_total_booked
    FROM bookings b
    WHERE b.tour_id = v_tour_id
      AND (
        b.status = 'confirmed'
        OR (b.status = 'pending' AND b.approval_status = 'approved')
      );

    SELECT COUNT(*)::integer INTO v_blocked
    FROM slot_seat_status
    WHERE tour_id = v_tour_id
      AND status = 'bloqueado_agencia'
      AND slot_id IS NULL;

    SELECT COALESCE(SUM(held_count), 0)::integer INTO v_held
    FROM seat_holds
    WHERE tour_id = v_tour_id
      AND slot_id IS NULL
      AND seat_number IS NULL
      AND session_id IS DISTINCT FROM p_session_id
      AND expires_at > now();

    v_available := v_max_capacity - v_total_booked - v_blocked - v_held;
  END IF;

  IF v_travelers_count > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No hay suficientes lugares disponibles',
      'available_spots', v_available,
      'requested', v_travelers_count
    );
  END IF;

  -- ---- INSERT BOOKING ----
  BEGIN
    INSERT INTO bookings (
      user_id, tour_id, agency_id, travelers_count, total_price,
      deposit_amount, commission_amount, service_charge, user_payment,
      platform_revenue, booking_date, slot_id, selected_date, selected_time,
      status, payment_status, approval_status,
      count_adultos, count_ninos, count_infantes, count_adultos_mayores, count_mascotas,
      points_used, toursred_cash_used, discount_code_id, discount_amount,
      service_charge_discount, payment_provider, conekta_method,
      promotion_id, promo_discount_amount,
      pickup_type, pickup_zone_name, pickup_zone_extra_cost, pickup_cost_type,
      selected_language, language_extra_cost, language_cost_type,
      restrictions_accepted, selected_seats,
      es_reserva_preventa, travel_insurance_included, travel_insurance_cost,
      insurance_days, insurance_discount_code_id, insurance_discount_amount,
      selected_payment_mode, membership_purchased, membership_plan, membership_cost,
      initial_payment_amount
    )
    VALUES (
      (p_booking_data->>'user_id')::uuid,
      v_tour_id,
      (p_booking_data->>'agency_id')::uuid,
      v_travelers_count,
      (p_booking_data->>'total_price')::numeric,
      (p_booking_data->>'deposit_amount')::numeric,
      (p_booking_data->>'commission_amount')::numeric,
      (p_booking_data->>'service_charge')::numeric,
      (p_booking_data->>'user_payment')::numeric,
      (p_booking_data->>'platform_revenue')::numeric,
      (p_booking_data->>'booking_date')::date,
      v_slot_id,
      NULLIF(p_booking_data->>'selected_date', '')::date,
      NULLIF(p_booking_data->>'selected_time', '')::time,
      COALESCE(p_booking_data->>'status', 'pending'),
      COALESCE(p_booking_data->>'payment_status', 'pending'),
      COALESCE(p_booking_data->>'approval_status', 'approved'),
      COALESCE((p_booking_data->>'count_adultos')::integer, 0),
      COALESCE((p_booking_data->>'count_ninos')::integer, 0),
      COALESCE((p_booking_data->>'count_infantes')::integer, 0),
      COALESCE((p_booking_data->>'count_adultos_mayores')::integer, 0),
      COALESCE((p_booking_data->>'count_mascotas')::integer, 0),
      COALESCE((p_booking_data->>'points_used')::integer, 0),
      COALESCE((p_booking_data->>'toursred_cash_used')::numeric, 0),
      NULLIF(p_booking_data->>'discount_code_id', '')::uuid,
      COALESCE((p_booking_data->>'discount_amount')::numeric, 0),
      COALESCE((p_booking_data->>'service_charge_discount')::numeric, 0),
      p_booking_data->>'payment_provider',
      NULLIF(p_booking_data->>'conekta_method', '')::text,
      NULLIF(p_booking_data->>'promotion_id', '')::uuid,
      COALESCE((p_booking_data->>'promo_discount_amount')::numeric, 0),
      NULLIF(p_booking_data->>'pickup_type', '')::text,
      NULLIF(p_booking_data->>'pickup_zone_name', '')::text,
      COALESCE((p_booking_data->>'pickup_zone_extra_cost')::numeric, 0),
      NULLIF(p_booking_data->>'pickup_cost_type', '')::text,
      NULLIF(p_booking_data->>'selected_language', '')::text,
      COALESCE((p_booking_data->>'language_extra_cost')::numeric, 0),
      NULLIF(p_booking_data->>'language_cost_type', '')::text,
      COALESCE((p_booking_data->>'restrictions_accepted')::boolean, false),
      CASE
        WHEN p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0
        THEN p_seat_numbers
        ELSE NULL
      END,
      COALESCE((p_booking_data->>'es_reserva_preventa')::boolean, false),
      COALESCE((p_booking_data->>'travel_insurance_included')::boolean, false),
      COALESCE((p_booking_data->>'travel_insurance_cost')::numeric, 0),
      NULLIF(p_booking_data->>'insurance_days', '')::integer,
      NULLIF(p_booking_data->>'insurance_discount_code_id', '')::uuid,
      COALESCE((p_booking_data->>'insurance_discount_amount')::numeric, 0),
      COALESCE(p_booking_data->>'selected_payment_mode', 'standard'),
      COALESCE((p_booking_data->>'membership_purchased')::boolean, false),
      NULLIF(p_booking_data->>'membership_plan', '')::text,
      COALESCE((p_booking_data->>'membership_cost')::numeric, 0),
      NULLIF(p_booking_data->>'initial_payment_amount', '')::numeric
    )
    RETURNING id INTO v_booking_id;

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Error al crear la reserva: ' || SQLERRM);
  END;

  -- ---- INSERT TRAVELERS (correct column names, NO silent exception) ----
  IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
    FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
      -- Normalize document fields: curp/pasaporte map to documento_tipo/documento_numero
      v_doc_tipo := NULLIF(v_traveler->>'documento_tipo', '')::text;
      v_doc_numero := NULLIF(v_traveler->>'documento_numero', '')::text;

      IF v_doc_tipo IS NULL AND NULLIF(v_traveler->>'curp', '') IS NOT NULL THEN
        v_doc_tipo := 'curp';
        v_doc_numero := v_traveler->>'curp';
      ELSIF v_doc_tipo IS NULL AND NULLIF(v_traveler->>'pasaporte', '') IS NOT NULL THEN
        v_doc_tipo := 'pasaporte';
        v_doc_numero := v_traveler->>'pasaporte';
      END IF;

      INSERT INTO booking_travelers (
        booking_id, nombre, apellido, email, telefono,
        fecha_nacimiento, documento_tipo, documento_numero,
        categoria_viajero,
        emergency_contact_name, emergency_contact_phone
      )
      VALUES (
        v_booking_id,
        v_traveler->>'nombre',
        v_traveler->>'apellido',
        v_traveler->>'email',
        v_traveler->>'telefono',
        NULLIF(v_traveler->>'fecha_nacimiento', '')::date,
        v_doc_tipo,
        v_doc_numero,
        NULLIF(v_traveler->>'categoria_viajero', '')::text,
        NULLIF(v_traveler->>'emergency_contact_name', '')::text,
        NULLIF(v_traveler->>'emergency_contact_phone', '')::text
      );
    END LOOP;
  END IF;

  -- ---- INSERT OPTIONAL SERVICES (NO silent exception) ----
  IF p_optional_services IS NOT NULL AND jsonb_array_length(p_optional_services) > 0 THEN
    FOR v_service IN SELECT jsonb_array_elements(p_optional_services) LOOP
      INSERT INTO booking_optional_services (
        booking_id, tour_optional_service_id, service_kind,
        description, quantity, unit_price, subtotal,
        service_charge, agency_commission, total_paid
      )
      VALUES (
        v_booking_id,
        NULLIF(v_service->>'tour_optional_service_id', '')::uuid,
        COALESCE(v_service->>'service_kind', 'optional_service'),
        v_service->>'description',
        (v_service->>'quantity')::integer,
        (v_service->>'unit_price')::numeric,
        (v_service->>'subtotal')::numeric,
        (v_service->>'service_charge')::numeric,
        (v_service->>'agency_commission')::numeric,
        (v_service->>'total_paid')::numeric
      );
    END LOOP;
  END IF;

  -- ---- CONVERT SEAT HOLDS TO slot_seat_status (with ROW_COUNT verification) ----
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN
    FOREACH v_seat IN ARRAY p_seat_numbers LOOP
      INSERT INTO slot_seat_status (
        tour_id, slot_id, agency_id, seat_number, status, booking_id
      )
      VALUES (
        v_tour_id,
        v_slot_id,
        (p_booking_data->>'agency_id')::uuid,
        v_seat,
        'reservado_online',
        v_booking_id
      )
      ON CONFLICT (tour_id, slot_id, seat_number) DO NOTHING;

      GET DIAGNOSTICS v_rows = ROW_COUNT;

      IF v_rows = 0 THEN
        -- Another session grabbed this seat between hold and commit.
        -- Roll back the entire booking so we don't leave a phantom reservation.
        RAISE EXCEPTION 'El asiento % ya fue asignado a otra persona. Intenta de nuevo.', v_seat
          USING ERRCODE = 'unique_violation';
      END IF;
    END LOOP;
  END IF;

  -- ---- RELEASE ALL HOLDS FOR THIS SESSION ----
  IF p_session_id IS NOT NULL THEN
    DELETE FROM seat_holds WHERE session_id = p_session_id;
  END IF;

  -- The AFTER INSERT trigger handle_booking_approval_notification fires automatically
  -- and inserts the in-app notification row (pure INSERT, no HTTP).
  -- Email is sent client-side after this function returns successfully.

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_atomic TO authenticated;
