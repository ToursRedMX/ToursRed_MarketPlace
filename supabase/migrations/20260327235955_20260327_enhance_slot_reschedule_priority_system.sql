-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260327235955
--   name:    20260327_enhance_slot_reschedule_priority_system
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

/*
  # Mejoras al Sistema de Reagendado de Slots con Prioridad y Cupos

  ## Descripción
  Amplía el sistema de reagendado de slots receptivos para soportar:
  1. Asignación de cupos por orden de respuesta (quien responde primero tiene lugar asegurado)
  2. Prioridad por fecha de reserva para los que no responden (quien reservó primero tiene prioridad)
  3. Flujo de "sin cupo disponible" cuando el viajero acepta pero ya no hay lugar
  4. Elección de slot alternativo por parte del viajero cuando no hay cupo
  5. Reembolso automático para quienes no alcanzaron cupo al expirar el plazo

  ## Cambios en Tablas Existentes

  ### `slot_reschedule_requests`
  - `available_spots_in_target` (integer) - cupos disponibles al momento de crear el reagendado
  - `new_capacity` (integer) - nueva capacidad configurada por la agencia (para increase_capacity)
  - `new_vehicle_map_type` (text) - nuevo tipo de vehículo seleccionado (si aplica)
  - Ampliar check constraint de `resolution_type` para incluir 'increase_capacity' y 'existing_slot'

  ### `slot_reschedule_responses`
  - `confirmed_spot` (boolean) - si el viajero tiene lugar asegurado en el slot destino
  - `alternative_slot_id` (uuid) - slot alternativo elegido por el viajero si no hay cupo
  - `booking_created_at` (timestamptz) - copia del created_at de la reserva original (para ordenar prioridad)
  - Ampliar check constraint de `response` para incluir 'accepted_no_availability' y 'auto_accepted_no_availability'

  ### `bookings`
  - Ampliar check constraint de `slot_reschedule_response` para incluir los nuevos estados

  ## Seguridad
  - Sin cambios en RLS (usa los roles existentes)
*/

-- 1. Agregar campos a slot_reschedule_requests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_requests' AND column_name = 'available_spots_in_target'
  ) THEN
    ALTER TABLE slot_reschedule_requests ADD COLUMN available_spots_in_target integer
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_requests' AND column_name = 'new_capacity'
  ) THEN
    ALTER TABLE slot_reschedule_requests ADD COLUMN new_capacity integer
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_requests' AND column_name = 'new_vehicle_map_type'
  ) THEN
    ALTER TABLE slot_reschedule_requests ADD COLUMN new_vehicle_map_type text
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_requests' AND column_name = 'no_availability_count'
  ) THEN
    ALTER TABLE slot_reschedule_requests ADD COLUMN no_availability_count integer NOT NULL DEFAULT 0
;


  END IF
;


END $$
;



-- Actualizar check constraint de resolution_type en slot_reschedule_requests
ALTER TABLE slot_reschedule_requests DROP CONSTRAINT IF EXISTS slot_reschedule_requests_resolution_type_check
;


ALTER TABLE slot_reschedule_requests ADD CONSTRAINT slot_reschedule_requests_resolution_type_check
  CHECK (resolution_type IN ('new_slot', 'expand_capacity', 'increase_capacity', 'existing_slot'))
;



-- 2. Agregar campos a slot_reschedule_responses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_responses' AND column_name = 'confirmed_spot'
  ) THEN
    ALTER TABLE slot_reschedule_responses ADD COLUMN confirmed_spot boolean NOT NULL DEFAULT false
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_responses' AND column_name = 'alternative_slot_id'
  ) THEN
    ALTER TABLE slot_reschedule_responses ADD COLUMN alternative_slot_id uuid REFERENCES tour_slots(id)
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slot_reschedule_responses' AND column_name = 'booking_created_at'
  ) THEN
    ALTER TABLE slot_reschedule_responses ADD COLUMN booking_created_at timestamptz
;


  END IF
;


END $$
;



-- Actualizar check constraint de response en slot_reschedule_responses
ALTER TABLE slot_reschedule_responses DROP CONSTRAINT IF EXISTS slot_reschedule_responses_response_check
;


ALTER TABLE slot_reschedule_responses ADD CONSTRAINT slot_reschedule_responses_response_check
  CHECK (response IN (
    'pending',
    'accepted',
    'rejected',
    'auto_accepted',
    'accepted_no_availability',
    'auto_accepted_no_availability'
  ))
;



-- 3. Actualizar check constraint en bookings para slot_reschedule_response
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_slot_reschedule_response_check
;


ALTER TABLE bookings ADD CONSTRAINT bookings_slot_reschedule_response_check
  CHECK (slot_reschedule_response IN (
    'accepted',
    'rejected',
    'auto_accepted',
    'accepted_no_availability',
    'auto_accepted_no_availability'
  ))
;



-- 4. Agregar campo alternative_slot_id a bookings para rastrear si el viajero eligio un slot diferente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'slot_reschedule_alternative_slot_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN slot_reschedule_alternative_slot_id uuid REFERENCES tour_slots(id)
;


  END IF
;


END $$
;



-- 5. Índices adicionales para performance
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_confirmed_spot
  ON slot_reschedule_responses(confirmed_spot) WHERE confirmed_spot = true
;



CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_alternative_slot
  ON slot_reschedule_responses(alternative_slot_id) WHERE alternative_slot_id IS NOT NULL
;



CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_booking_created
  ON slot_reschedule_responses(request_id, booking_created_at)
;



-- 6. Función RPC para obtener cupos confirmados en un reagendado (para verificar disponibilidad en tiempo real)
CREATE OR REPLACE FUNCTION public.get_confirmed_spots_in_reschedule(
  p_request_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed_travelers integer
;


BEGIN
  SELECT COALESCE(SUM(b.travelers_count), 0)
  INTO v_confirmed_travelers
  FROM slot_reschedule_responses srr
  JOIN bookings b ON b.id = srr.booking_id
  WHERE srr.request_id = p_request_id
  AND srr.confirmed_spot = true
  AND b.status IN ('confirmed', 'pending')
;



  RETURN v_confirmed_travelers
;


END
;


$$
;



-- 7. Función RPC para obtener slots alternativos disponibles para un viajero
CREATE OR REPLACE FUNCTION public.get_alternative_slots_for_reschedule(
  p_tour_id uuid,
  p_original_slot_id uuid,
  p_travelers_needed integer
)
RETURNS TABLE (
  slot_id uuid,
  slot_date date,
  departure_time time,
  capacity integer,
  booked_count integer,
  available_spots integer
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
    ts.capacity,
    ts.booked_count,
    (ts.capacity - ts.booked_count) AS available_spots
  FROM tour_slots ts
  WHERE ts.tour_id = p_tour_id
  AND ts.id != p_original_slot_id
  AND ts.status = 'activo'
  AND ts.slot_date >= CURRENT_DATE
  AND (ts.capacity - ts.booked_count) >= p_travelers_needed
  ORDER BY ts.slot_date ASC, ts.departure_time ASC
;


END
;


$$
;



;
