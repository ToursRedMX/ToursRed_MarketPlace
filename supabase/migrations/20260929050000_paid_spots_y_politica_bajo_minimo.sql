-- ============================================================================
-- "Garantia de salida" (buyout) para tours receptivos compartidos con minimo
-- de viajeros: hoy nada bloquea ni ofrece pagar los lugares faltantes cuando
-- una reserva queda por debajo de tours.min_travelers_required — se crea
-- igual y queda a esperar que se sumen mas viajeros, indefinidamente.
--
-- ESQUEMA
--   tours.politica_bajo_minimo: mismo patron que transfer_pricing_mode
--   (20260616221229) — texto con CHECK, no enum nuevo.
--     'permite_espera'    (default, comportamiento actual): la reserva queda
--                          pendiente esperando que se sumen mas viajeros.
--     'exige_pago_minimo': no se permite esperar; toda reserva por debajo
--                          del minimo debe pagar los lugares faltantes.
--
--   bookings.paid_spots: lugares que se estan PAGANDO, que puede ser mayor
--   que travelers_count (viajeros reales). Se hace backfill de las filas
--   existentes a paid_spots = travelers_count (el comportamiento de siempre)
--   y se deja NOT NULL con CHECK paid_spots >= travelers_count: nunca se
--   puede pagar por MENOS lugares de los que de verdad van.
--
-- POR QUE DOS COLUMNAS Y NO UNA
--   travelers_count sigue siendo la cuenta de personas reales, y es lo unico
--   que debe limitar contra max_travelers/tour_slots.capacity (asientos
--   fisicos: alguien que "compra" un lugar extra no ocupa un asiento de mas).
--   paid_spots es lo que debe sumar contra min_travelers_required (umbral de
--   RENTABILIDAD, no de capacidad): quien pago el minimo garantizado ya
--   cubrio ese costo aunque nadie mas se sume.
--
-- QUE FUNCION SE TOCA POR ESO
--   Se audito cada funcion que suma travelers_count contra un umbral:
--   get_tour_availability, get_tour_availability_v2 y el chequeo de
--   capacidad de create_booking_atomic SOLO comparan contra capacidad
--   fisica (max_travelers/tour_slots.capacity) — no tocan min_travelers, se
--   quedan igual.
--   La UNICA funcion que escribe min_travelers_reached/confirmed_at es
--   update_slot_booked_count() (trigger AFTER en bookings, 20260310032704).
--   Hoy calcula booked_count Y min_travelers_reached con la MISMA suma de
--   travelers_count en la misma consulta; se separa en dos sumas: booked_count
--   sigue en travelers_count (fisico), min_travelers_reached pasa a sumar
--   paid_spots (rentabilidad). Ninguna otra funcion escribe ese campo.
-- ============================================================================

ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS politica_bajo_minimo text DEFAULT 'permite_espera'
    CHECK (politica_bajo_minimo IN ('permite_espera', 'exige_pago_minimo'));

COMMENT ON COLUMN public.tours.politica_bajo_minimo IS
  'Que pasa con una reserva por debajo de min_travelers_required: permite_espera (default, espera a que se sumen mas viajeros) o exige_pago_minimo (obliga a pagar los lugares faltantes para crear la reserva).';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS paid_spots integer;

UPDATE public.bookings SET paid_spots = travelers_count WHERE paid_spots IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN paid_spots SET NOT NULL,
  ALTER COLUMN paid_spots SET DEFAULT 0;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_paid_spots_check CHECK (paid_spots >= travelers_count);

COMMENT ON COLUMN public.bookings.paid_spots IS
  'Lugares que se pagan en esta reserva; puede ser mayor que travelers_count (viajeros reales) cuando el viajero paga el minimo garantizado de un tour compartido. travelers_count sigue limitando contra capacidad fisica; paid_spots es lo que cuenta contra min_travelers_required.';

-- ----------------------------------------------------------------------------
-- update_slot_booked_count(): separar la suma de capacidad (booked_count,
-- travelers_count) de la suma de rentabilidad (min_travelers_reached,
-- paid_spots). Resto de la funcion identico a 20260310032704.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_slot_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id uuid;
  v_new_count integer;
  v_paid_count integer;
  v_capacity integer;
  v_min_required integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_slot_id := OLD.slot_id;
  ELSE
    v_slot_id := NEW.slot_id;
  END IF;

  IF v_slot_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(b.travelers_count), 0),
    COALESCE(SUM(COALESCE(b.paid_spots, b.travelers_count)), 0),
    ts.capacity
  INTO v_new_count, v_paid_count, v_capacity
  FROM public.tour_slots ts
  LEFT JOIN public.bookings b ON b.slot_id = ts.id
    AND b.status IN ('pending', 'confirmed', 'completed')
  WHERE ts.id = v_slot_id
  GROUP BY ts.capacity;

  IF v_new_count IS NULL THEN
    v_new_count := 0;
    v_paid_count := 0;
    SELECT capacity INTO v_capacity FROM public.tour_slots WHERE id = v_slot_id;
  END IF;

  SELECT t.min_travelers_required INTO v_min_required
  FROM public.tour_slots ts
  JOIN public.tours t ON t.id = ts.tour_id
  WHERE ts.id = v_slot_id;

  UPDATE public.tour_slots SET
    booked_count = v_new_count,
    status = CASE
      WHEN v_new_count >= v_capacity THEN 'lleno'::slot_status_enum
      WHEN status = 'lleno' AND v_new_count < v_capacity THEN 'activo'::slot_status_enum
      ELSE status
    END,
    min_travelers_reached = CASE
      WHEN v_min_required IS NOT NULL AND v_paid_count >= v_min_required THEN true
      ELSE false
    END,
    confirmed_at = CASE
      WHEN v_min_required IS NOT NULL AND v_paid_count >= v_min_required AND confirmed_at IS NULL THEN now()
      ELSE confirmed_at
    END,
    updated_at = now()
  WHERE id = v_slot_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
