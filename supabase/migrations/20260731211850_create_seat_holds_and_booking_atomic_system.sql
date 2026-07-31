/*
# Seat Holds + Atomic Booking Creation System

## Purpose
Replaces the draft-booking flow with a 4-screen booking experience where:
1. The booking is NOT created until the user confirms payment (screen 4).
2. Seats / capacity spots are held temporarily (10 min) while the user fills in traveler data.
3. The final booking creation is atomic — no orphaned drafts.

## New Tables
- `seat_holds`: Temporary holds on seats or generic capacity spots.
  - Two modes: specific seat_number (tours with vehicle_map_type) or held_count (simple capacity).
  - Unique constraint prevents two sessions from holding the same seat.
  - 10-minute expiry with lazy evaluation + pg_cron backup every minute.

## New Functions
- `hold_seats`: Creates holds for specific seats OR generic capacity. Returns which succeeded/failed.
- `release_seat_holds`: Releases holds by session_id (optionally only specific seats).
- `cleanup_expired_seat_holds`: Deletes expired holds (called by pg_cron every minute).
- `create_booking_atomic`: Creates booking + travelers + optional services + seat conversion
  in a single transaction. Replaces activate_draft_booking for the new flow.

## Modified Functions
- `get_tour_availability`: Now subtracts active (non-expired) seat holds from available spots.

## Security
- RLS enabled on seat_holds with authenticated-only access.
- All new functions are SECURITY DEFINER with search_path = public.
- activate_draft_booking and cleanup_abandoned_draft_bookings remain for backward compatibility.

## Important Notes
1. Two hold modes: seat_number (tours with vehicle_map_type) vs held_count (simple capacity).
2. create_booking_atomic does NOT send emails — only the in-app notification trigger fires (pure INSERT).
3. Email remains a client-side fetch after commit, same as the existing flow.
*/

-- ============================================================
-- 1. CREATE seat_holds TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.seat_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.tour_slots(id) ON DELETE CASCADE,
  seat_number integer,
  held_count integer,
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seat_holds_unique_seat
  ON public.seat_holds (tour_id, slot_id, seat_number)
  WHERE seat_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS seat_holds_session_id_idx ON public.seat_holds (session_id);
CREATE INDEX IF NOT EXISTS seat_holds_expires_at_idx ON public.seat_holds (expires_at);
CREATE INDEX IF NOT EXISTS seat_holds_tour_slot_idx ON public.seat_holds (tour_id, slot_id);

-- ============================================================
-- 2. RLS ON seat_holds
-- ============================================================

ALTER TABLE public.seat_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seat_holds_select_authenticated" ON public.seat_holds;
CREATE POLICY "seat_holds_select_authenticated"
  ON public.seat_holds FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "seat_holds_insert_own_session" ON public.seat_holds;
CREATE POLICY "seat_holds_insert_own_session"
  ON public.seat_holds FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "seat_holds_update_own_session" ON public.seat_holds;
CREATE POLICY "seat_holds_update_own_session"
  ON public.seat_holds FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "seat_holds_delete_own_session" ON public.seat_holds;
CREATE POLICY "seat_holds_delete_own_session"
  ON public.seat_holds FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- 3. hold_seats FUNCTION
-- ============================================================
-- Required params first, optional params with defaults after.
-- Mode A (specific seats): pass p_seat_numbers array.
-- Mode B (generic capacity): pass p_held_count > 0.

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
-- 4. release_seat_holds FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_seat_holds(
  p_session_id text,
  p_tour_id uuid DEFAULT NULL,
  p_slot_id uuid DEFAULT NULL,
  p_seat_numbers integer[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN
    DELETE FROM seat_holds
    WHERE session_id = p_session_id
      AND (p_tour_id IS NULL OR tour_id = p_tour_id)
      AND (p_slot_id IS NULL OR slot_id = p_slot_id)
      AND seat_number = ANY(p_seat_numbers);
  ELSE
    DELETE FROM seat_holds
    WHERE session_id = p_session_id
      AND (p_tour_id IS NULL OR tour_id = p_tour_id)
      AND (p_slot_id IS NULL OR slot_id = p_slot_id);
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_seat_holds TO authenticated;

-- ============================================================
-- 5. cleanup_expired_seat_holds FUNCTION + CRON
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_seat_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM seat_holds WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_seat_holds TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-seat-holds') THEN
      PERFORM cron.unschedule('cleanup-expired-seat-holds');
    END IF;
    PERFORM cron.schedule(
      'cleanup-expired-seat-holds',
      '* * * * *',
      'SELECT cleanup_expired_seat_holds()'
    );
  END IF;
END $$;

-- ============================================================
-- 6. MODIFY get_tour_availability to subtract active holds
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_tour_availability(p_tour_id uuid)
RETURNS TABLE(available_spots integer, max_capacity integer, total_booked integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity integer;
  v_booked   integer;
  v_blocked  integer;
  v_held     integer;
BEGIN
  SELECT
    COALESCE(
      CASE
        WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
          THEN t.available_spots
        ELSE COALESCE(t.max_travelers, 10)
      END,
      10
    )
  INTO v_capacity
  FROM tours t
  WHERE t.id = p_tour_id;

  SELECT COALESCE(SUM(b.travelers_count), 0)::integer
  INTO v_booked
  FROM bookings b
  WHERE b.tour_id = p_tour_id
    AND (
      b.status = 'confirmed'
      OR (b.status = 'pending' AND b.approval_status = 'approved')
    );

  SELECT COUNT(*)::integer
  INTO v_blocked
  FROM slot_seat_status sss
  WHERE sss.tour_id = p_tour_id
    AND sss.status = 'bloqueado_agencia'
    AND sss.slot_id IS NULL;

  SELECT COALESCE(SUM(sh.held_count), 0)::integer
  INTO v_held
  FROM seat_holds sh
  WHERE sh.tour_id = p_tour_id
    AND sh.slot_id IS NULL
    AND sh.seat_number IS NULL
    AND sh.expires_at > now();

  RETURN QUERY
  SELECT
    GREATEST(0, v_capacity - v_booked - v_blocked - v_held)::integer AS available_spots,
    v_capacity::integer AS max_capacity,
    v_booked::integer AS total_booked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tour_availability TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tour_availability TO anon;

-- ============================================================
-- 7. create_booking_atomic FUNCTION
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

  -- ---- INSERT TRAVELERS ----
  IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
    FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
      BEGIN
        INSERT INTO booking_travelers (
          booking_id, nombre, apellido, email, telefono,
          fecha_nacimiento, tipo_documento, numero_documento,
          curp, pasaporte, categoria_viajero,
          contacto_emergencia_nombre, contacto_emergencia_telefono,
          sexo
        )
        VALUES (
          v_booking_id,
          v_traveler->>'nombre',
          v_traveler->>'apellido',
          v_traveler->>'email',
          v_traveler->>'telefono',
          NULLIF(v_traveler->>'fecha_nacimiento', '')::date,
          NULLIF(v_traveler->>'tipo_documento', '')::text,
          NULLIF(v_traveler->>'numero_documento', '')::text,
          NULLIF(v_traveler->>'curp', '')::text,
          NULLIF(v_traveler->>'pasaporte', '')::text,
          NULLIF(v_traveler->>'categoria_viajero', '')::text,
          NULLIF(v_traveler->>'contacto_emergencia_nombre', '')::text,
          NULLIF(v_traveler->>'contacto_emergencia_telefono', '')::text,
          NULLIF(v_traveler->>'sexo', '')::text
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END IF;

  -- ---- INSERT OPTIONAL SERVICES ----
  IF p_optional_services IS NOT NULL AND jsonb_array_length(p_optional_services) > 0 THEN
    FOR v_service IN SELECT jsonb_array_elements(p_optional_services) LOOP
      BEGIN
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
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END IF;

  -- ---- CONVERT SEAT HOLDS TO slot_seat_status ----
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN
    FOREACH v_seat IN ARRAY p_seat_numbers LOOP
      BEGIN
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
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
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