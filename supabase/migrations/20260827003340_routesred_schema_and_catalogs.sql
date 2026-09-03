-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003340
--   name:    routesred_schema_and_catalogs
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
# RoutesRed — Schema and Base Catalogs (applied to ToursRed project)

Creates the routesred schema with vehicle_types and amenities catalogs.
RLS enabled with public read policies.
*/

CREATE SCHEMA IF NOT EXISTS routesred;

CREATE OR REPLACE FUNCTION routesred.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TABLE IF NOT EXISTS routesred.vehicle_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  icon         text,
  min_capacity integer,
  max_capacity integer,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE routesred.vehicle_types ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vehicle_types_updated_at ON routesred.vehicle_types;
CREATE TRIGGER vehicle_types_updated_at BEFORE UPDATE ON routesred.vehicle_types
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

DROP POLICY IF EXISTS "public_read_vehicle_types" ON routesred.vehicle_types;
CREATE POLICY "public_read_vehicle_types"
  ON routesred.vehicle_types FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS routesred.amenities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  icon         text,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE routesred.amenities ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS amenities_updated_at ON routesred.amenities;
CREATE TRIGGER amenities_updated_at BEFORE UPDATE ON routesred.amenities
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

DROP POLICY IF EXISTS "public_read_amenities" ON routesred.amenities;
CREATE POLICY "public_read_amenities"
  ON routesred.amenities FOR SELECT TO anon, authenticated USING (true);

INSERT INTO routesred.vehicle_types (code, name, description, min_capacity, max_capacity, active, sort_order)
VALUES
  ('car', 'Car', 'Automovil sedan estandar', 1, 4, true, 1),
  ('suv', 'SUV', 'Vehiculo utilitario deportivo', 1, 7, true, 2),
  ('van', 'Van', 'Van de pasajeros', 1, 15, true, 3),
  ('sprinter', 'Sprinter', 'Mercedes Sprinter o similar', 1, 19, true, 4),
  ('minibus', 'Minibus', 'Microbus de mediana capacidad', 16, 35, true, 5),
  ('bus', 'Bus', 'Autobus estandar', 36, 55, true, 6),
  ('executive_bus', 'Executive Bus', 'Autobus ejecutivo de lujo', 36, 55, true, 7),
  ('other', 'Other', 'Otro tipo de vehiculo no clasificado', null, null, true, 99)
ON CONFLICT (code) DO NOTHING;

INSERT INTO routesred.amenities (code, name, description, active, sort_order)
VALUES
  ('air_conditioning', 'Air Conditioning', 'Aire acondicionado', true, 1),
  ('wifi', 'WiFi', 'Conexion WiFi a bordo', true, 2),
  ('usb', 'USB', 'Puertos de carga USB', true, 3),
  ('usb_c', 'USB-C', 'Puertos de carga USB-C', true, 4),
  ('restroom', 'Restroom', 'Sanitario a bordo', true, 5),
  ('entertainment_screen', 'Entertainment Screen', 'Pantallas de entretenimiento', true, 6),
  ('seat_belts', 'Seat Belts', 'Cinturones de seguridad', true, 7),
  ('gps', 'GPS', 'Sistema de navegacion GPS', true, 8),
  ('luggage_space', 'Luggage Space', 'Espacio de equipaje', true, 9),
  ('accessibility', 'Accessibility', 'Accesibilidad para sillas de ruedas', true, 10),
  ('reclining_seats', 'Reclining Seats', 'Asientos reclinables', true, 11),
  ('power_outlets', 'Power Outlets', 'Enchufes de corriente', true, 12)
ON CONFLICT (code) DO NOTHING;

;
