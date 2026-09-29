-- ============================================================================
-- El diagnostico anterior (20260929010000) estaba incompleto. Se asumio que
-- el "No autorizado" que se veia en consola era por no reconocer al
-- ejecutivo de cuenta, pero auditando `audit_logs` para el tour de prueba
-- ("Ruta de los Chenes") el actor real de la creacion fue la propia cuenta
-- de la agencia (aventuraxtours@gmail.com, actor_role='agency') -Axel
-- probaba logueado como la agencia, no como ejecutivo-, asi que
-- `a.user_id = auth.uid()` SI se cumplia y la autorizacion nunca fue el
-- problema para este caso. El fix de autorizacion de la migracion anterior
-- se queda -sigue siendo correcto para el caso real de un ejecutivo
-- gestionando su agencia asignada- pero no era la causa de lo que se vio.
--
-- LA CAUSA REAL, reproducida llamando la funcion directamente:
--
--   ERROR: 23502: null value in column "agency_id" of relation "tour_slots"
--   violates not-null constraint
--
-- El INSERT de auto_generate_slots_for_range nunca incluyo `agency_id` en su
-- lista de columnas -bug de origen, no algo que rompiera un cambio
-- reciente-, y `tour_slots.agency_id` es NOT NULL. CADA llamada a esta
-- funcion fallaba con esta violacion, sin excepcion, para TODO tour
-- receptivo del sistema; el try/catch de AgencyTours.tsx se comia el error
-- en silencio. `v_tour.agency_id` ya esta disponible en el record cargado
-- lineas arriba -no hace falta una consulta nueva-.
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
          tour_id, agency_id, schedule_id, slot_date, departure_time, capacity, booked_count, status
        ) VALUES (
          p_tour_id,
          v_tour.agency_id,
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
