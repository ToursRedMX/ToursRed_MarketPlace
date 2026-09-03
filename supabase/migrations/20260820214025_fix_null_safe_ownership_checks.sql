-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260820214025
--   name:    fix_null_safe_ownership_checks
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- Reemplaza '!=' por 'IS DISTINCT FROM' en los checks de dueño para que
-- no fallen en silencio si auth.uid() llegara a ser NULL (defensa en profundidad,
-- no explotable hoy porque 'anon' no tiene EXECUTE en estas funciones).

CREATE OR REPLACE FUNCTION public.activate_draft_booking(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_slot record;
v_max_capacity integer;
v_total_booked integer;
v_available integer;
BEGIN
-- Authorization: booking must belong to the authenticated user
SELECT b.id, b.status, b.tour_id, b.travelers_count, b.approval_status, b.slot_id, b.user_id
INTO v_booking
FROM bookings b
WHERE b.id = p_booking_id
FOR UPDATE;

IF v_booking IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada');
END IF;

IF v_booking.user_id IS DISTINCT FROM auth.uid() THEN
RAISE EXCEPTION 'No autorizado';
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
-- Serialize concurrent activations for the same slot-less tour
PERFORM pg_advisory_xact_lock(hashtext(v_booking.tour_id::text));

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
$function$;

CREATE OR REPLACE FUNCTION public.reserve_seats(p_tour_id uuid, p_agency_id uuid, p_booking_id uuid, p_seat_numbers integer[], p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_conflicting integer[];
v_seat integer;
v_reserved integer[] := '{}';
v_failed integer[] := '{}';
v_rows integer;
v_booking_user_id uuid;
BEGIN
-- Authorization: booking must belong to the authenticated user
SELECT b.user_id INTO v_booking_user_id
FROM bookings b
WHERE b.id = p_booking_id;

IF v_booking_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada';
END IF;

IF v_booking_user_id IS DISTINCT FROM auth.uid() THEN
RAISE EXCEPTION 'No autorizado';
END IF;

-- Verificar que todos los asientos esten disponibles (con bloqueo FOR UPDATE)
SELECT ARRAY_AGG(seat_number)
INTO v_conflicting
FROM slot_seat_status
WHERE tour_id = p_tour_id
AND (
(p_slot_id IS NULL AND slot_id IS NULL)
OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id)
)
AND seat_number = ANY(p_seat_numbers)
AND status != 'disponible'
FOR UPDATE;

IF v_conflicting IS NOT NULL AND array_length(v_conflicting, 1) > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Algunos asientos ya no estan disponibles',
'conflicting_seats', v_conflicting
);
END IF;

-- Insertar o actualizar estado de cada asiento
FOREACH v_seat IN ARRAY p_seat_numbers LOOP
INSERT INTO slot_seat_status (
tour_id, slot_id, agency_id, seat_number, status, booking_id
) VALUES (
p_tour_id, p_slot_id, p_agency_id, v_seat, 'reservado_online', p_booking_id
)
ON CONFLICT (tour_id, slot_id, seat_number)
DO UPDATE SET
status = 'reservado_online',
booking_id = p_booking_id,
updated_at = now()
WHERE slot_seat_status.booking_id = p_booking_id
OR slot_seat_status.status = 'disponible';

GET DIAGNOSTICS v_rows = ROW_COUNT;

IF v_rows = 0 THEN
v_failed := array_append(v_failed, v_seat);
ELSE
v_reserved := array_append(v_reserved, v_seat);
END IF;
END LOOP;

IF array_length(v_failed, 1) > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Algunos asientos ya no estan disponibles',
'conflicting_seats', v_failed,
'reserved_seats', v_reserved
);
END IF;

RETURN jsonb_build_object(
'success', true,
'reserved_seats', p_seat_numbers
);
END;
$function$;

;
