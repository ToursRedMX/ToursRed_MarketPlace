-- get_tour_availability no descontaba asientos bloqueados (bloqueado_agencia) del conteo.
-- Ahora se resta tambien el numero de asientos con status 'bloqueado_agencia' en slot_seat_status
-- (sin slot_id, es decir bloqueos de tour general sin fecha especifica).
-- Esto afecta tours no-receptivos donde la agencia bloquea asientos para ventas externas.

CREATE OR REPLACE FUNCTION public.get_tour_availability(p_tour_id uuid)
RETURNS TABLE(available_spots integer, max_capacity integer, total_booked integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity integer;
  v_booked   integer;
  v_blocked  integer;
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

  -- Asientos bloqueados por agencia a nivel tour (sin slot especifico)
  SELECT COUNT(*)::integer
  INTO v_blocked
  FROM slot_seat_status sss
  WHERE sss.tour_id = p_tour_id
    AND sss.status = 'bloqueado_agencia'
    AND sss.slot_id IS NULL;

  RETURN QUERY
  SELECT
    GREATEST(0, v_capacity - v_booked - v_blocked)::integer AS available_spots,
    v_capacity::integer AS max_capacity,
    v_booked::integer AS total_booked;
END;
$function$;
