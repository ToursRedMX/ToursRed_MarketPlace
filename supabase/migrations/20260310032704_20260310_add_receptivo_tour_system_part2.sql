-- ============================================================
-- COLUMNAS NUEVAS EN bookings
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'slot_id'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN slot_id uuid REFERENCES public.tour_slots(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'selected_date'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN selected_date date;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'selected_time'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN selected_time time;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON public.bookings(slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_selected_date ON public.bookings(selected_date) WHERE selected_date IS NOT NULL;

-- ============================================================
-- FUNCIÓN: get_tour_slots_by_range
-- Retorna slots con disponibilidad calculada para un rango de fechas
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_tour_slots_by_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  id uuid,
  tour_id uuid,
  agency_id uuid,
  schedule_id uuid,
  slot_date date,
  departure_time time,
  end_date date,
  capacity integer,
  booked_count integer,
  available_count integer,
  status slot_status_enum,
  is_auto_generated boolean,
  min_travelers_reached boolean,
  notes text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.tour_id,
    ts.agency_id,
    ts.schedule_id,
    ts.slot_date,
    ts.departure_time,
    ts.end_date,
    ts.capacity,
    ts.booked_count,
    GREATEST(0, ts.capacity - ts.booked_count) AS available_count,
    ts.status,
    ts.is_auto_generated,
    ts.min_travelers_reached,
    ts.notes,
    ts.created_at
  FROM public.tour_slots ts
  WHERE ts.tour_id = p_tour_id
    AND ts.slot_date >= p_start_date
    AND ts.slot_date <= p_end_date
    AND ts.status != 'cancelado'
  ORDER BY ts.slot_date ASC, ts.departure_time ASC;
END;
$$;

-- ============================================================
-- FUNCIÓN: get_or_create_slot
-- Obtiene un slot existente o lo crea para fecha+horario dado
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_slot(
  p_tour_id uuid,
  p_schedule_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id uuid;
  v_schedule record;
  v_tour record;
BEGIN
  -- Buscar slot existente
  SELECT id INTO v_slot_id
  FROM public.tour_slots
  WHERE tour_id = p_tour_id
    AND schedule_id = p_schedule_id
    AND slot_date = p_date
    AND status != 'cancelado'
  LIMIT 1;

  -- Si existe, retornarlo
  IF v_slot_id IS NOT NULL THEN
    RETURN v_slot_id;
  END IF;

  -- Obtener datos del horario
  SELECT * INTO v_schedule FROM public.tour_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found: %', p_schedule_id;
  END IF;

  -- Obtener datos del tour
  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour not found: %', p_tour_id;
  END IF;

  -- Crear nuevo slot
  INSERT INTO public.tour_slots (
    tour_id,
    agency_id,
    schedule_id,
    slot_date,
    departure_time,
    end_date,
    capacity,
    status,
    is_auto_generated
  ) VALUES (
    p_tour_id,
    v_tour.agency_id,
    p_schedule_id,
    p_date,
    v_schedule.departure_time,
    p_date + COALESCE(v_tour.slot_duration_days, 1) - 1,
    COALESCE(v_schedule.slot_capacity, v_tour.default_slot_capacity, COALESCE(v_tour.max_travelers, 20)),
    'activo',
    true
  )
  RETURNING id INTO v_slot_id;

  RETURN v_slot_id;
END;
$$;

-- ============================================================
-- FUNCIÓN: get_next_available_slot
-- Retorna el próximo slot activo con cupos disponibles
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_next_available_slot(
  p_tour_id uuid
)
RETURNS TABLE (
  slot_id uuid,
  slot_date date,
  departure_time time,
  available_count integer,
  capacity integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id AS slot_id,
    ts.slot_date,
    ts.departure_time,
    GREATEST(0, ts.capacity - ts.booked_count) AS available_count,
    ts.capacity
  FROM public.tour_slots ts
  WHERE ts.tour_id = p_tour_id
    AND ts.status = 'activo'
    AND ts.slot_date >= CURRENT_DATE
    AND ts.booked_count < ts.capacity
  ORDER BY ts.slot_date ASC, ts.departure_time ASC
  LIMIT 1;
END;
$$;

-- ============================================================
-- FUNCIÓN: auto_generate_slots_for_range
-- Genera slots automáticamente para un rango de fechas basándose en
-- los horarios configurados y respetando blackouts y días de operación
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_generate_slots_for_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour record;
  v_current_date date;
  v_day_of_week integer;
  v_month integer;
  v_schedule record;
  v_slots_created integer := 0;
  v_is_blackout boolean;
  v_slot_exists boolean;
BEGIN
  -- Obtener datos del tour
  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND OR v_tour.tour_type != 'receptivo' THEN
    RAISE EXCEPTION 'Tour not found or not receptivo type: %', p_tour_id;
  END IF;

  -- Iterar por cada día en el rango
  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date)::integer;
    v_month := EXTRACT(MONTH FROM v_current_date)::integer;

    -- Verificar si el día está en operating_days
    IF v_tour.operating_days IS NOT NULL AND 
       NOT (v_day_of_week = ANY(v_tour.operating_days)) THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;

    -- Verificar si el mes está en operating_months
    IF v_tour.operating_months IS NOT NULL AND 
       NOT (v_month = ANY(v_tour.operating_months)) THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;

    -- Verificar si hay blackout para esta fecha
    SELECT EXISTS (
      SELECT 1 FROM public.tour_slot_blackouts b
      WHERE b.tour_id = p_tour_id
        AND b.is_partial_day = false
        AND v_current_date BETWEEN b.blackout_start AND b.blackout_end
    ) INTO v_is_blackout;

    IF v_is_blackout THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;

    -- Para cada horario activo del tour
    FOR v_schedule IN
      SELECT * FROM public.tour_schedules
      WHERE tour_id = p_tour_id
        AND is_active = true
        AND valid_from <= v_current_date
        AND (valid_until IS NULL OR valid_until >= v_current_date)
        AND (days_of_week IS NULL OR v_day_of_week = ANY(days_of_week))
    LOOP
      -- Verificar si el slot ya existe
      SELECT EXISTS (
        SELECT 1 FROM public.tour_slots ts
        WHERE ts.tour_id = p_tour_id
          AND ts.schedule_id = v_schedule.id
          AND ts.slot_date = v_current_date
          AND ts.status != 'cancelado'
      ) INTO v_slot_exists;

      IF NOT v_slot_exists THEN
        -- Verificar blackout parcial para este horario
        SELECT EXISTS (
          SELECT 1 FROM public.tour_slot_blackouts b
          WHERE b.tour_id = p_tour_id
            AND b.is_partial_day = true
            AND v_current_date BETWEEN b.blackout_start AND b.blackout_end
            AND (b.blocked_schedule_ids IS NULL OR v_schedule.id = ANY(b.blocked_schedule_ids))
        ) INTO v_is_blackout;

        IF NOT v_is_blackout THEN
          INSERT INTO public.tour_slots (
            tour_id,
            agency_id,
            schedule_id,
            slot_date,
            departure_time,
            end_date,
            capacity,
            status,
            is_auto_generated
          ) VALUES (
            p_tour_id,
            v_tour.agency_id,
            v_schedule.id,
            v_current_date,
            v_schedule.departure_time,
            v_current_date + COALESCE(v_tour.slot_duration_days, 1) - 1,
            COALESCE(v_schedule.slot_capacity, v_tour.default_slot_capacity, COALESCE(v_tour.max_travelers, 20)),
            'activo',
            true
          );
          v_slots_created := v_slots_created + 1;
        END IF;
      END IF;
    END LOOP;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN v_slots_created;
END;
$$;

-- ============================================================
-- FUNCIÓN: get_tour_availability_v2
-- Versión mejorada de disponibilidad que soporta slots (receptivos)
-- y fechas fijas (excursiones)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_tour_availability_v2(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL
)
RETURNS TABLE (
  available_spots integer,
  total_capacity integer,
  booked_count integer,
  slot_date date,
  departure_time time
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour record;
BEGIN
  SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour not found: %', p_tour_id;
  END IF;

  -- Si hay slot_id, calcular disponibilidad del slot específico
  IF p_slot_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      GREATEST(0, ts.capacity - ts.booked_count) AS available_spots,
      ts.capacity AS total_capacity,
      ts.booked_count,
      ts.slot_date,
      ts.departure_time
    FROM public.tour_slots ts
    WHERE ts.id = p_slot_id
      AND ts.tour_id = p_tour_id;
  ELSE
    -- Comportamiento original: disponibilidad del tour completo (excursión)
    RETURN QUERY
    SELECT
      COALESCE(v_tour.available_spots, v_tour.max_travelers, 0) AS available_spots,
      COALESCE(v_tour.max_travelers, 0) AS total_capacity,
      COALESCE(v_tour.max_travelers, 0) - COALESCE(v_tour.available_spots, COALESCE(v_tour.max_travelers, 0)) AS booked_count,
      v_tour.start_date::date AS slot_date,
      NULL::time AS departure_time;
  END IF;
END;
$$;

-- ============================================================
-- TRIGGER: update_slot_booked_count
-- Actualiza booked_count en tour_slots cuando cambian las reservas
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_slot_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id uuid;
  v_new_count integer;
  v_capacity integer;
  v_tour record;
  v_min_required integer;
BEGIN
  -- Determinar el slot_id afectado
  IF TG_OP = 'DELETE' THEN
    v_slot_id := OLD.slot_id;
  ELSE
    v_slot_id := NEW.slot_id;
  END IF;

  IF v_slot_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recalcular booked_count
  SELECT
    COALESCE(SUM(travelers_count), 0),
    ts.capacity
  INTO v_new_count, v_capacity
  FROM public.tour_slots ts
  LEFT JOIN public.bookings b ON b.slot_id = ts.id
    AND b.status IN ('pending', 'confirmed', 'completed')
  WHERE ts.id = v_slot_id
  GROUP BY ts.capacity;

  IF v_new_count IS NULL THEN
    v_new_count := 0;
    SELECT capacity INTO v_capacity FROM public.tour_slots WHERE id = v_slot_id;
  END IF;

  -- Obtener min_travelers_required del tour
  SELECT t.min_travelers_required INTO v_min_required
  FROM public.tour_slots ts
  JOIN public.tours t ON t.id = ts.tour_id
  WHERE ts.id = v_slot_id;

  -- Actualizar el slot
  UPDATE public.tour_slots SET
    booked_count = v_new_count,
    status = CASE
      WHEN v_new_count >= v_capacity THEN 'lleno'::slot_status_enum
      WHEN status = 'lleno' AND v_new_count < v_capacity THEN 'activo'::slot_status_enum
      ELSE status
    END,
    min_travelers_reached = CASE
      WHEN v_min_required IS NOT NULL AND v_new_count >= v_min_required THEN true
      ELSE false
    END,
    confirmed_at = CASE
      WHEN v_min_required IS NOT NULL AND v_new_count >= v_min_required AND confirmed_at IS NULL THEN now()
      ELSE confirmed_at
    END,
    updated_at = now()
  WHERE id = v_slot_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_update_slot_booked_count ON public.bookings;
CREATE TRIGGER trg_update_slot_booked_count
  AFTER INSERT OR UPDATE OF slot_id, status, travelers_count OR DELETE
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_slot_booked_count();

-- ============================================================
-- COMENTARIOS
-- ============================================================

COMMENT ON TABLE public.tour_schedules IS 'Horarios recurrentes de salida para tours receptivos';
COMMENT ON TABLE public.tour_slots IS 'Instancias concretas de salida (fecha + hora) para tours receptivos';
COMMENT ON TABLE public.tour_slot_blackouts IS 'Fechas bloqueadas para tours receptivos';
COMMENT ON COLUMN public.tours.tour_type IS 'excursion = fecha fija (comportamiento actual), receptivo = opera con horarios recurrentes';
COMMENT ON COLUMN public.tours.receptivo_modality IS 'compartido o privado - informativo para el viajero';
COMMENT ON COLUMN public.bookings.slot_id IS 'Referencia al slot reservado para tours receptivos';
COMMENT ON COLUMN public.bookings.selected_date IS 'Fecha de salida elegida (redundante para consultas rápidas)';
COMMENT ON COLUMN public.bookings.selected_time IS 'Hora de salida elegida';
