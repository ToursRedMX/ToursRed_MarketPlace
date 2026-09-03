-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260326224935
--   name:    create_seat_map_system
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
  # Sistema de Mapa de Asientos Interactivo

  ## Descripción
  Implementa un sistema extensible de mapas de asientos para tours (excursiones y receptivos).
  Las agencias pueden configurar un mapa de vehículo por tour, los viajeros seleccionan
  sus asientos al reservar, y las agencias pueden bloquear asientos por ventas externas.

  ## Nuevas Tablas

  ### 1. vehicle_seat_layouts
  Define los layouts disponibles de vehículos con la disposición de cada asiento.
  - `type`: Identificador único del layout (sprinter_20, bus_50, etc.)
  - `name`: Nombre visible para las agencias
  - `capacity`: Total de asientos seleccionables
  - `seats`: JSON con la definición completa de cada asiento (número, fila, columna, lado, tipo)
  - `vehicle_shape`: Metadatos del vehículo (relación de aspecto, filas totales, columnas)

  ### 2. slot_seat_status
  Estado de cada asiento por slot/tour. Soporta tanto tours receptivos (via slot_id)
  como excursiones (via tour_id directamente).
  - `seat_number`: Número del asiento
  - `status`: disponible | reservado_online | bloqueado_agencia
  - `booking_id`: Referencia al booking si está reservado online
  - `block_note`: Nota de la agencia si está bloqueado manualmente

  ## Columnas Agregadas
  - `tours.vehicle_map_type`: Tipo de layout de vehículo configurado (null = sin mapa)
  - `bookings.selected_seats`: Array de números de asientos seleccionados

  ## Seguridad
  - RLS habilitado en ambas tablas
  - Políticas separadas para agencias, viajeros y admins
  - Función RPC atómica para reservar asientos (evita doble reserva)
  - Función RPC para obtener disponibilidad en tiempo real

  ## Notas
  - Extensible: agregar nuevo layout = insertar fila en vehicle_seat_layouts
  - Compatible con tours existentes (vehicle_map_type = null por defecto)
  - Triggers para liberar asientos automáticamente al cancelar bookings
*/

-- ============================================================
-- TABLA: vehicle_seat_layouts
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_seat_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text UNIQUE NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  seats jsonb NOT NULL DEFAULT '[]'::jsonb,
  vehicle_shape jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
;



ALTER TABLE vehicle_seat_layouts ENABLE ROW LEVEL SECURITY
;



CREATE POLICY "Anyone can view active seat layouts"
  ON vehicle_seat_layouts FOR SELECT
  USING (is_active = true)
;



CREATE POLICY "Super admins can manage seat layouts"
  ON vehicle_seat_layouts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role = 'super_admin'
    )
  )
;



CREATE POLICY "Super admins can update seat layouts"
  ON vehicle_seat_layouts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role = 'super_admin'
    )
  )
;



-- ============================================================
-- TABLA: slot_seat_status
-- ============================================================
CREATE TABLE IF NOT EXISTS slot_seat_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES tour_slots(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  seat_number integer NOT NULL CHECK (seat_number > 0),
  status text NOT NULL DEFAULT 'disponible'
    CHECK (status IN ('disponible', 'reservado_online', 'bloqueado_agencia')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  block_note text,
  blocked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_seat_status_unique UNIQUE (tour_id, slot_id, seat_number)
)
;



-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_slot_seat_status_tour_slot ON slot_seat_status(tour_id, slot_id)
;


CREATE INDEX IF NOT EXISTS idx_slot_seat_status_booking ON slot_seat_status(booking_id)
;


CREATE INDEX IF NOT EXISTS idx_slot_seat_status_agency ON slot_seat_status(agency_id)
;


CREATE INDEX IF NOT EXISTS idx_slot_seat_status_status ON slot_seat_status(status)
;



ALTER TABLE slot_seat_status ENABLE ROW LEVEL SECURITY
;



CREATE POLICY "Agencies can view their tour seat status"
  ON slot_seat_status FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
    OR (
      SELECT auth.uid()
    ) IN (
      SELECT user_id FROM bookings WHERE id = booking_id
    )
  )
;



CREATE POLICY "Agencies can insert seat status for their tours"
  ON slot_seat_status FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Agencies can update seat status for their tours"
  ON slot_seat_status FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Agencies can delete seat status for their tours"
  ON slot_seat_status FOR DELETE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



-- ============================================================
-- COLUMNAS EN TABLAS EXISTENTES
-- ============================================================

-- Agregar vehicle_map_type a tours
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'vehicle_map_type'
  ) THEN
    ALTER TABLE tours ADD COLUMN vehicle_map_type text DEFAULT NULL
;


  END IF
;


END $$
;



-- Agregar selected_seats a bookings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'selected_seats'
  ) THEN
    ALTER TABLE bookings ADD COLUMN selected_seats integer[] DEFAULT NULL
;


  END IF
;


END $$
;



-- ============================================================
-- FUNCIÓN RPC: get_seat_map_availability
-- Devuelve el estado de todos los asientos de un tour/slot
-- ============================================================
CREATE OR REPLACE FUNCTION get_seat_map_availability(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL
)
RETURNS TABLE(
  seat_number integer,
  status text,
  booking_id uuid,
  block_note text,
  traveler_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sss.seat_number,
    sss.status,
    sss.booking_id,
    sss.block_note,
    CASE
      WHEN sss.status = 'reservado_online' AND sss.booking_id IS NOT NULL THEN
        COALESCE(
          (SELECT u.name FROM users u
           JOIN bookings b ON b.user_id = u.id
           WHERE b.id = sss.booking_id LIMIT 1),
          'Viajero'
        )
      WHEN sss.status = 'bloqueado_agencia' THEN
        COALESCE(sss.block_note, 'Bloqueado')
      ELSE NULL
    END AS traveler_name
  FROM slot_seat_status sss
  WHERE sss.tour_id = p_tour_id
    AND (
      (p_slot_id IS NULL AND sss.slot_id IS NULL)
      OR (p_slot_id IS NOT NULL AND sss.slot_id = p_slot_id)
    )
;


END
;


$$
;



-- ============================================================
-- FUNCIÓN RPC: reserve_seats (atómica, evita doble reserva)
-- ============================================================
CREATE OR REPLACE FUNCTION reserve_seats(
  p_tour_id uuid,
  p_agency_id uuid,
  p_booking_id uuid,
  p_seat_numbers integer[],
  p_slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicting integer[]
;


  v_seat integer
;


BEGIN
  -- Verificar que todos los asientos estén disponibles (con bloqueo FOR UPDATE)
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
  FOR UPDATE
;



  IF v_conflicting IS NOT NULL AND array_length(v_conflicting, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Algunos asientos ya no están disponibles',
      'conflicting_seats', v_conflicting
    )
;


  END IF
;



  -- Insertar o actualizar estado de cada asiento
  FOREACH v_seat IN ARRAY p_seat_numbers
  LOOP
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
;


  END LOOP
;



  RETURN jsonb_build_object(
    'success', true,
    'reserved_seats', p_seat_numbers
  )
;


END
;


$$
;



-- ============================================================
-- FUNCIÓN RPC: release_seats (libera asientos de un booking)
-- ============================================================
CREATE OR REPLACE FUNCTION release_seats(
  p_booking_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM slot_seat_status
  WHERE booking_id = p_booking_id
    AND status = 'reservado_online'
;


END
;


$$
;



-- ============================================================
-- FUNCIÓN RPC: toggle_agency_seat_block
-- Agencia bloquea/desbloquea un asiento manualmente
-- ============================================================
CREATE OR REPLACE FUNCTION toggle_agency_seat_block(
  p_tour_id uuid,
  p_agency_id uuid,
  p_seat_number integer,
  p_block boolean,
  p_block_note text DEFAULT NULL,
  p_slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text
;


BEGIN
  -- Verificar que la agencia es dueña del tour
  IF NOT EXISTS (
    SELECT 1 FROM tours WHERE id = p_tour_id AND agency_id = p_agency_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin autorización')
;


  END IF
;



  -- Obtener estado actual
  SELECT status INTO v_current_status
  FROM slot_seat_status
  WHERE tour_id = p_tour_id
    AND (
      (p_slot_id IS NULL AND slot_id IS NULL)
      OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id)
    )
    AND seat_number = p_seat_number
;



  IF p_block THEN
    -- Bloquear: solo si está disponible
    IF v_current_status = 'reservado_online' THEN
      RETURN jsonb_build_object('success', false, 'error', 'El asiento tiene una reserva activa')
;


    END IF
;



    INSERT INTO slot_seat_status (
      tour_id, slot_id, agency_id, seat_number, status, block_note, blocked_by, blocked_at
    ) VALUES (
      p_tour_id, p_slot_id, p_agency_id, p_seat_number,
      'bloqueado_agencia', p_block_note, (SELECT auth.uid()), now()
    )
    ON CONFLICT (tour_id, slot_id, seat_number)
    DO UPDATE SET
      status = 'bloqueado_agencia',
      block_note = p_block_note,
      blocked_by = (SELECT auth.uid()),
      blocked_at = now(),
      booking_id = NULL,
      updated_at = now()
;


  ELSE
    -- Desbloquear: solo si está bloqueado por agencia
    IF v_current_status != 'bloqueado_agencia' THEN
      RETURN jsonb_build_object('success', false, 'error', 'El asiento no está bloqueado por la agencia')
;


    END IF
;



    DELETE FROM slot_seat_status
    WHERE tour_id = p_tour_id
      AND (
        (p_slot_id IS NULL AND slot_id IS NULL)
        OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id)
      )
      AND seat_number = p_seat_number
      AND status = 'bloqueado_agencia'
;


  END IF
;



  RETURN jsonb_build_object('success', true)
;


END
;


$$
;



-- ============================================================
-- TRIGGER: libera asientos cuando se cancela un booking
-- ============================================================
CREATE OR REPLACE FUNCTION handle_booking_cancellation_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    DELETE FROM slot_seat_status
    WHERE booking_id = NEW.id
      AND status = 'reservado_online'
;


  END IF
;


  RETURN NEW
;


END
;


$$
;



DROP TRIGGER IF EXISTS trg_release_seats_on_cancellation ON bookings
;


CREATE TRIGGER trg_release_seats_on_cancellation
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION handle_booking_cancellation_seats()
;



-- ============================================================
-- DATOS INICIALES: Layouts de Vehículos
-- ============================================================

-- Sprinter 20 pasajeros
INSERT INTO vehicle_seat_layouts (type, name, capacity, display_order, seats, vehicle_shape)
VALUES (
  'sprinter_20',
  'Sprinter / Van (20 pasajeros)',
  20,
  1,
  '[
    {"number": 1, "row": 0, "col": 3, "side": "right", "type": "normal"},
    {"number": 2, "row": 1, "col": 0, "side": "left", "type": "normal"},
    {"number": 3, "row": 1, "col": 1, "side": "left", "type": "normal"},
    {"number": 4, "row": 1, "col": 3, "side": "right", "type": "normal"},
    {"number": 5, "row": 2, "col": 0, "side": "left", "type": "normal"},
    {"number": 6, "row": 2, "col": 1, "side": "left", "type": "normal"},
    {"number": 7, "row": 2, "col": 3, "side": "right", "type": "normal"},
    {"number": 8, "row": 3, "col": 0, "side": "left", "type": "normal"},
    {"number": 9, "row": 3, "col": 1, "side": "left", "type": "normal"},
    {"number": 10, "row": 3, "col": 3, "side": "right", "type": "normal"},
    {"number": 11, "row": 4, "col": 0, "side": "left", "type": "normal"},
    {"number": 12, "row": 4, "col": 1, "side": "left", "type": "normal"},
    {"number": 13, "row": 4, "col": 3, "side": "right", "type": "normal"},
    {"number": 14, "row": 5, "col": 0, "side": "left", "type": "normal"},
    {"number": 15, "row": 5, "col": 1, "side": "left", "type": "normal"},
    {"number": 16, "row": 5, "col": 3, "side": "right", "type": "normal"},
    {"number": 17, "row": 6, "col": 0, "side": "left", "type": "normal"},
    {"number": 18, "row": 6, "col": 1, "side": "left", "type": "normal"},
    {"number": 19, "row": 6, "col": 2, "side": "right", "type": "normal"},
    {"number": 20, "row": 6, "col": 3, "side": "right", "type": "normal"}
  ]'::jsonb,
  '{
    "totalRows": 7,
    "totalCols": 4,
    "aisleAfterCol": 2,
    "driverRow": 0,
    "driverCol": 0,
    "hasDriver": true,
    "hasBathroom": false,
    "aspectRatio": "tall"
  }'::jsonb
)
ON CONFLICT (type) DO NOTHING
;



-- Autobús 50 pasajeros
INSERT INTO vehicle_seat_layouts (type, name, capacity, display_order, seats, vehicle_shape)
VALUES (
  'bus_50',
  'Autobús (50 pasajeros)',
  50,
  2,
  '[
    {"number": 1,  "row": 0, "col": 0, "side": "left",  "type": "normal"},
    {"number": 2,  "row": 0, "col": 1, "side": "left",  "type": "normal"},
    {"number": 3,  "row": 0, "col": 3, "side": "right", "type": "normal"},
    {"number": 4,  "row": 0, "col": 4, "side": "right", "type": "normal"},
    {"number": 5,  "row": 1, "col": 0, "side": "left",  "type": "normal"},
    {"number": 6,  "row": 1, "col": 1, "side": "left",  "type": "normal"},
    {"number": 7,  "row": 1, "col": 3, "side": "right", "type": "normal"},
    {"number": 8,  "row": 1, "col": 4, "side": "right", "type": "normal"},
    {"number": 9,  "row": 2, "col": 0, "side": "left",  "type": "normal"},
    {"number": 10, "row": 2, "col": 1, "side": "left",  "type": "normal"},
    {"number": 11, "row": 2, "col": 3, "side": "right", "type": "normal"},
    {"number": 12, "row": 2, "col": 4, "side": "right", "type": "normal"},
    {"number": 13, "row": 3, "col": 0, "side": "left",  "type": "normal"},
    {"number": 14, "row": 3, "col": 1, "side": "left",  "type": "normal"},
    {"number": 15, "row": 3, "col": 3, "side": "right", "type": "normal"},
    {"number": 16, "row": 3, "col": 4, "side": "right", "type": "normal"},
    {"number": 17, "row": 4, "col": 0, "side": "left",  "type": "normal"},
    {"number": 18, "row": 4, "col": 1, "side": "left",  "type": "normal"},
    {"number": 19, "row": 4, "col": 3, "side": "right", "type": "normal"},
    {"number": 20, "row": 4, "col": 4, "side": "right", "type": "normal"},
    {"number": 21, "row": 5, "col": 0, "side": "left",  "type": "normal"},
    {"number": 22, "row": 5, "col": 1, "side": "left",  "type": "normal"},
    {"number": 23, "row": 5, "col": 3, "side": "right", "type": "normal"},
    {"number": 24, "row": 5, "col": 4, "side": "right", "type": "normal"},
    {"number": 25, "row": 6, "col": 0, "side": "left",  "type": "normal"},
    {"number": 26, "row": 6, "col": 1, "side": "left",  "type": "normal"},
    {"number": 27, "row": 6, "col": 3, "side": "right", "type": "normal"},
    {"number": 28, "row": 6, "col": 4, "side": "right", "type": "normal"},
    {"number": 29, "row": 7, "col": 0, "side": "left",  "type": "normal"},
    {"number": 30, "row": 7, "col": 1, "side": "left",  "type": "normal"},
    {"number": 31, "row": 7, "col": 3, "side": "right", "type": "normal"},
    {"number": 32, "row": 7, "col": 4, "side": "right", "type": "normal"},
    {"number": 33, "row": 8, "col": 0, "side": "left",  "type": "normal"},
    {"number": 34, "row": 8, "col": 1, "side": "left",  "type": "normal"},
    {"number": 35, "row": 8, "col": 3, "side": "right", "type": "normal"},
    {"number": 36, "row": 8, "col": 4, "side": "right", "type": "normal"},
    {"number": 37, "row": 9, "col": 0, "side": "left",  "type": "normal"},
    {"number": 38, "row": 9, "col": 1, "side": "left",  "type": "normal"},
    {"number": 39, "row": 9, "col": 3, "side": "right", "type": "normal"},
    {"number": 40, "row": 9, "col": 4, "side": "right", "type": "normal"},
    {"number": 41, "row": 10, "col": 0, "side": "left", "type": "normal"},
    {"number": 42, "row": 10, "col": 1, "side": "left", "type": "normal"},
    {"number": 43, "row": 10, "col": 3, "side": "right","type": "normal"},
    {"number": 44, "row": 10, "col": 4, "side": "right","type": "normal"},
    {"number": 45, "row": 11, "col": 0, "side": "left", "type": "normal"},
    {"number": 46, "row": 11, "col": 1, "side": "left", "type": "normal"},
    {"number": 47, "row": 11, "col": 3, "side": "right","type": "normal"},
    {"number": 48, "row": 11, "col": 4, "side": "right","type": "normal"},
    {"number": 49, "row": 12, "col": 0, "side": "left", "type": "normal"},
    {"number": 50, "row": 12, "col": 1, "side": "left", "type": "normal"}
  ]'::jsonb,
  '{
    "totalRows": 13,
    "totalCols": 5,
    "aisleAfterCol": 2,
    "driverRow": -1,
    "driverCol": -1,
    "hasDriver": true,
    "hasBathroom": true,
    "bathroomRow": 12,
    "bathroomCol": 3,
    "aspectRatio": "tall"
  }'::jsonb
)
ON CONFLICT (type) DO NOTHING
;



;
