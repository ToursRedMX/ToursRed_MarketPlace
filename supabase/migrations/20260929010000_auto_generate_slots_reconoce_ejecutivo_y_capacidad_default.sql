-- ============================================================================
-- auto_generate_slots_for_range() tenia dos bugs que se detectaron probando
-- el flujo de tours "a demanda" con un tour nuevo creado por un ejecutivo de
-- cuenta (rol account_executive): el calendario de reservas no mostraba
-- NINGUNA fecha disponible.
--
-- BUG 1 — AUTORIZACION
-- AgencyTours.tsx llama a esta funcion automaticamente al guardar un tour
-- receptivo, envuelto en un try/catch que solo hace console.warn si falla
-- -el error se traga en silencio y el tour queda creado sin slots-. La
-- funcion solo autorizaba `agencies.user_id = auth.uid()` o admin/super_admin,
-- sin reconocer al ejecutivo de cuenta asignado a la agencia
-- (`agencies.account_executive_id -> account_executives.user_id`), que es un
-- vinculo que YA usan otras politicas del repo (ver
-- "Account executives can read their agencies bookings",
-- migracion 20260609063440). Un ejecutivo gestionando los tours de su
-- agencia asignada -caso real, no hipotetico- disparaba 'No autorizado' y
-- se quedaba sin slots sin enterarse.
--
-- BUG 2 — CAPACIDAD, INDEPENDIENTE DEL ANTERIOR
-- Cada slot se creaba con COALESCE(schedule.slot_capacity, 0): si el horario
-- no trae capacidad propia (campo opcional en el formulario), el slot nace
-- con capacidad 0 -el tour se ve "lleno" en cada fecha, aunque el tour si
-- tenga default_slot_capacity configurado-. La funcion hermana
-- sync_tour_slots_capacity_on_schedule_update() SI usa ese fallback
-- (migracion 20260616183352); esta no lo hacia. Se agrega el mismo fallback:
-- COALESCE(schedule.slot_capacity, tour.default_slot_capacity, 0).
--
-- Nada mas cambia: la logica de fechas, el candado advisory, el chequeo de
-- tour_type='receptivo' y el resto del flujo quedan identicos a la version
-- de 20260911110000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_generate_slots_for_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_schedule record;
  v_current_date date;
  v_slot_exists boolean;
  v_created_count int := 0;
  v_tour record;
  v_is_owner boolean;
  v_is_admin boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM public.tours t
    JOIN public.agencies a ON a.id = t.agency_id
    WHERE t.id = p_tour_id
      AND (
        a.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.account_executives ae
          WHERE ae.id = a.account_executive_id AND ae.user_id = auth.uid()
        )
      )
  ) INTO v_is_owner;

  v_is_admin := public.is_admin_user();
  IF NOT v_is_owner AND NOT v_is_admin THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tour_id::text));

  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour no encontrado';
  END IF;
  IF v_tour.tour_type <> 'receptivo' THEN
    RAISE EXCEPTION 'Solo tours receptivos soportan generacion automatica de slots';
  END IF;

  FOR v_schedule IN
    SELECT * FROM public.tour_schedules WHERE tour_id = p_tour_id AND is_active = true
  LOOP
    v_current_date := GREATEST(p_start_date, v_schedule.valid_from);
    IF v_schedule.valid_until IS NOT NULL THEN
      v_current_date := GREATEST(v_current_date, CURRENT_DATE);
    END IF;

    WHILE v_current_date <= p_end_date
      AND (v_schedule.valid_until IS NULL OR v_current_date <= v_schedule.valid_until)
    LOOP
      SELECT EXISTS(
        SELECT 1 FROM public.tour_slots ts
        WHERE ts.tour_id = p_tour_id
          AND ts.schedule_id = v_schedule.id
          AND ts.slot_date = v_current_date
          AND ts.status <> 'cancelado'
      ) INTO v_slot_exists;

      IF NOT v_slot_exists THEN
        INSERT INTO public.tour_slots (
          tour_id, schedule_id, slot_date, departure_time, capacity, booked_count, status
        ) VALUES (
          p_tour_id,
          v_schedule.id,
          v_current_date,
          v_schedule.departure_time,
          COALESCE(v_schedule.slot_capacity, v_tour.default_slot_capacity, 0),
          0,
          'activo'
        );
        v_created_count := v_created_count + 1;
      END IF;

      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
  END LOOP;

  RETURN v_created_count;
END;
$function$;
