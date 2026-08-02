/*
# Fix missing precio_aplicado in traveler INSERT of create_booking_atomic

## Purpose
The `create_booking_atomic` function inserts travelers into `booking_travelers`
without setting the `precio_aplicado` column, which is `NOT NULL` with no default.
Every traveler insert would fail with a NOT NULL constraint violation.

## Changes
1. Add `precio_aplicado` to the column list of the INSERT INTO booking_travelers.
2. Use `COALESCE((v_traveler->>'precio_aplicado')::numeric, 0)` so the value
   comes from the traveler JSON (the frontend already calculates the per-category
   price — adulto/niño/infante/etc.) and defaults to 0 if somehow missing.
*/

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

  IF NOT EXISTS (SELECT 1 FROM tours WHERE id = v_tour_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
  END IF;

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
      COALESCE(p_booking_data->>'approval_status', 'approved')::approval_status,
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

  IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
    FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
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
        categoria_viajero, precio_aplicado,
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
        COALESCE((v_traveler->>'precio_aplicado')::numeric, 0),
        NULLIF(v_traveler->>'emergency_contact_name', '')::text,
        NULLIF(v_traveler->>'emergency_contact_phone', '')::text
      );
    END LOOP;
  END IF;

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
        RAISE EXCEPTION 'El asiento % ya fue asignado a otra persona. Intenta de nuevo.', v_seat
          USING ERRCODE = 'unique_violation';
      END IF;
    END LOOP;
  END IF;

  IF p_session_id IS NOT NULL THEN
    DELETE FROM seat_holds WHERE session_id = p_session_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_atomic TO authenticated;
