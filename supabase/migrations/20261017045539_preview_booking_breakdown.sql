-- Centralizar el desglose de costos de reserva (paso 2 de 2): exponer
-- calculate_booking_breakdown (migracion 20261017021213) al front por RPC,
-- para que BookingFlowStep4.tsx deje de reimplementar el calculo en React.
--
-- preview_booking_breakdown es un espejo SOLO LECTURA de la parte de
-- create_booking_atomic que decide cuanto se puede cobrar: mismo calculo de
-- capacidad y de "garantia de salida" (paid_spots), pero SIN el FOR UPDATE
-- del slot -- aqui no se va a insertar nada, y mantener un candado abierto
-- mientras alguien mira la pantalla de pago es exactamente el tipo de cosa
-- que el FOR UPDATE existe para evitar en la version real. El numero de
-- paid_spots que devuelve sigue siendo una ESTIMACION -- el mismo criterio
-- que ya tenia el front ("el servidor vuelve a calcular el faltante de
-- verdad... al crear la reserva", comentario de BookingFlowStep4.tsx).
--
-- Dos cosas se quedan A PROPOSITO fuera de esta funcion, iguales a
-- create_booking_atomic: no incrementa tour_promotions.times_used (ver el
-- comentario de calculate_booking_breakdown, es la misma razon) y no
-- escribe nada en ninguna tabla -- es pura lectura.

CREATE OR REPLACE FUNCTION public.preview_booking_breakdown(
  p_booking_data jsonb,
  p_travelers jsonb DEFAULT '[]'::jsonb,
  p_optional_services jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_user_id           uuid    := (p_booking_data->>'user_id')::uuid;
v_tour_id           uuid    := (p_booking_data->>'tour_id')::uuid;
v_slot_id           uuid    := NULL;
v_travelers_count   integer := (p_booking_data->>'travelers_count')::integer;

v_tour              record;
v_slot              record;
v_max_capacity      integer;
v_total_booked      integer;
v_blocked           integer;
v_held              integer;
v_available         integer;

v_es_per_vehicle           boolean := false;
v_paid_spots               integer := 0;
v_missing_for_slot         integer := 0;

v_breakdown jsonb;
BEGIN
v_slot_id := NULLIF(p_booking_data->>'slot_id', '')::uuid;

IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_user_id THEN
RETURN jsonb_build_object('success', false, 'error', 'No autorizado: el user_id no coincide con la sesion autenticada');
END IF;

SELECT
t.id,
t.agency_id,
t.activity_type,
t.receptivo_modality,
t.transfer_pricing_mode,
t.min_travelers_required,
t.politica_bajo_minimo
INTO v_tour
FROM tours t
WHERE t.id = v_tour_id;

IF v_tour IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
END IF;

v_es_per_vehicle := (
  v_tour.activity_type = 'transport'
  AND v_tour.receptivo_modality = 'privado'
  AND v_tour.transfer_pricing_mode = 'per_vehicle'
);

-- ---- CAPACITY (solo lectura -- sin FOR UPDATE, esto no reserva nada) ----
IF v_slot_id IS NOT NULL THEN
SELECT ts.capacity, ts.booked_count
INTO v_slot
FROM tour_slots ts
WHERE ts.id = v_slot_id;

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
AND expires_at > now();

v_available := v_max_capacity - v_total_booked - v_blocked - v_held;
END IF;

-- ---- GARANTIA DE SALIDA: misma formula que create_booking_atomic ----
IF v_es_per_vehicle OR v_slot_id IS NULL OR v_tour.min_travelers_required IS NULL OR v_tour.min_travelers_required <= 1 THEN
  v_paid_spots := v_travelers_count;
ELSE
  v_missing_for_slot := GREATEST(0, v_tour.min_travelers_required - v_slot.booked_count - v_travelers_count);
  IF v_tour.politica_bajo_minimo = 'exige_pago_minimo' THEN
    v_paid_spots := v_travelers_count + v_missing_for_slot;
  ELSIF COALESCE((p_booking_data->>'pagar_minimo_garantizado')::boolean, false) THEN
    v_paid_spots := v_travelers_count + v_missing_for_slot;
  ELSE
    v_paid_spots := v_travelers_count;
  END IF;
END IF;

-- p_consume_exemption = false: esta es una vista previa, no debe quemar
-- el cupo mensual de exencion de membresia de nadie (ver migracion
-- 20261017045400).
v_breakdown := public.calculate_booking_breakdown(
  v_tour_id, v_user_id, p_booking_data, p_travelers, p_optional_services,
  v_paid_spots, v_travelers_count, false
);

IF NOT COALESCE((v_breakdown->>'success')::boolean, false) THEN
RETURN v_breakdown;
END IF;

RETURN v_breakdown
  || jsonb_build_object('paid_spots', v_paid_spots)
  || jsonb_build_object('available_spots', v_available)
  || jsonb_build_object('missing_for_slot', v_missing_for_slot);
END;
$function$;

COMMENT ON FUNCTION public.preview_booking_breakdown IS
'Espejo de solo lectura de create_booking_atomic, para que el front pida el desglose de costos sin crear la reserva. No reserva asientos (sin FOR UPDATE), no incrementa usos de promocion, no escribe nada. BookingFlowStep4.tsx la llama para pintar el resumen; create_booking_atomic sigue siendo quien de verdad cobra y recalcula todo al confirmar.';

GRANT EXECUTE ON FUNCTION public.preview_booking_breakdown(jsonb, jsonb, jsonb) TO authenticated;
