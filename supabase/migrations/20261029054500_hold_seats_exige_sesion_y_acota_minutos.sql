-- hold_seats: exige una sesion y acota los minutos del apartado (hallazgo SEG-08 del pre-UAT, 29-oct-2026).
--
-- Lo que se encontro (por lectura de codigo, sin explotarlo para no ocupar cupos reales):
--   1. public.hold_seats es SECURITY DEFINER y estaba ejecutable por `anon` (GRANT a PUBLIC), sin ningun chequeo de
--      auth.uid(): cualquiera con la llave publica del sitio podia apartar lugares de cualquier tour.
--   2. `p_hold_minutes` lo decide quien llama y se usaba tal cual para el vencimiento: con p_hold_minutes = 100000 el apartado
--      dura semanas, y el cron cleanup-expired-seat-holds solo borra lo VENCIDO. Era una negacion de servicio del inventario.
--   3. `p_user_id` tambien lo decide quien llama: se podia apartar a nombre de otra persona.
--
-- Lo unico que llama a hold_seats es el flujo de reserva (BookingFlowStep3.tsx), y ese flujo exige sesion (BookingFlowLayout
-- redirige a /login sin ella), asi que cerrar el acceso anonimo no cambia lo que ve el viajero. El front no manda p_hold_minutes:
-- usa el valor por omision (10).
--
-- Que cambia (el resto del cuerpo es identico al de 20260803205937):
--   - Sin sesion y con rol `anon` o `authenticated` sin uid: ERROR 42501. Una llamada sin claims (psql como postgres, el service role
--     de una Edge Function o la prueba test-external-sales-db.mjs) sigue funcionando.
--   - Los minutos se acotan a 1..15 (el flujo usa 10).
--   - El apartado se guarda a nombre de auth.uid(); `p_user_id` solo se usa cuando no hay sesion (llamadas internas).
--   - EXECUTE queda solo para authenticated y service_role.
--
-- release_seat_holds NO se toca aqui: solo borra apartados de un session_id que el llamador ya conoce (un texto aleatorio del navegador).

CREATE OR REPLACE FUNCTION public.hold_seats(
  p_tour_id uuid,
  p_slot_id uuid,
  p_session_id text,
  p_seat_numbers integer[] DEFAULT NULL::integer[],
  p_held_count integer DEFAULT NULL::integer,
  p_user_id uuid DEFAULT NULL::uuid,
  p_hold_minutes integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expires_at timestamptz := now() + (LEAST(GREATEST(COALESCE(p_hold_minutes, 10), 1), 15) || ' minutes')::interval;
  v_seat integer;
  v_held integer[] := '{}';
  v_failed integer[] := '{}';
  v_conflicting_count integer;
  v_own_hold_count integer;
BEGIN
  -- Sin claims (psql, service role de una funcion) auth.role() es NULL y se deja pasar; con claims de anon, o de un rol sin uid, no.
  IF v_uid IS NULL AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso no autorizado' USING ERRCODE = '42501';
  END IF;

  PERFORM toursred_ops.lock_inventory(p_tour_id);
  IF COALESCE(array_length(p_seat_numbers,1),p_held_count,0) >
     COALESCE((SELECT i.available FROM toursred_ops.inventory(p_tour_id,p_slot_id,NULL,NULL,p_session_id) i),0)
  THEN RAISE EXCEPTION 'No hay suficientes lugares disponibles'; END IF;

  -- Mode A: specific seats
  IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN

    -- Release own holds for this tour/slot whose seat_number is NOT in the new selection, so stale holds
    -- from the same session do not accumulate when the user changes their selection.
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

      -- Delete any EXPIRED hold for this exact seat so the unique index does not block a new user because of a stale row.
      DELETE FROM seat_holds
      WHERE tour_id = p_tour_id
        AND (slot_id = p_slot_id OR (slot_id IS NULL AND p_slot_id IS NULL))
        AND seat_number = v_seat
        AND expires_at <= now();

      -- If THIS session already holds this seat (non-expired), extend the expiry and treat it as success.
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

      -- The unique index catches concurrent inserts on the same seat
      BEGIN
        INSERT INTO seat_holds (tour_id, slot_id, seat_number, session_id, user_id, expires_at)
        VALUES (p_tour_id, p_slot_id, v_seat, p_session_id, COALESCE(v_uid, p_user_id), v_expires_at);
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
    VALUES (p_tour_id, p_slot_id, NULL, p_held_count, p_session_id, COALESCE(v_uid, p_user_id), v_expires_at);

    RETURN jsonb_build_object(
      'mode', 'generic_capacity',
      'held_count', p_held_count,
      'expires_at', v_expires_at
    );
  END IF;

  RETURN jsonb_build_object('mode', 'noop', 'message', 'No seats or count provided');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hold_seats(uuid, uuid, text, integer[], integer, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_seats(uuid, uuid, text, integer[], integer, uuid, integer) TO authenticated, service_role;

-- Si el REVOKE no surtio efecto, la migracion falla en vez de dejar el hueco abierto.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.hold_seats(uuid, uuid, text, integer[], integer, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'hold_seats sigue ejecutable por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.hold_seats(uuid, uuid, text, integer[], integer, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'hold_seats dejo de ser ejecutable por authenticated: el flujo de reserva se rompe';
  END IF;
END;
$$;
