
-- Create cities table
CREATE TABLE IF NOT EXISTS cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  state text NOT NULL,
  country text DEFAULT 'México',
  bbox_north double precision NOT NULL,
  bbox_south double precision NOT NULL,
  bbox_east double precision NOT NULL,
  bbox_west double precision NOT NULL,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create transport systems table
CREATE TABLE IF NOT EXISTS transport_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name text NOT NULL,
  system_type text NOT NULL,
  operator text,
  osm_query jsonb NOT NULL,
  icon text,
  color text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create OSM sync logs table
CREATE TABLE IF NOT EXISTS osm_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  total_processed integer DEFAULT 0,
  total_inserted integer DEFAULT 0,
  total_updated integer DEFAULT 0,
  total_errors integer DEFAULT 0,
  error_details jsonb,
  executed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  execution_mode text DEFAULT 'manual'
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_cities_active ON cities(is_active);
CREATE INDEX IF NOT EXISTS idx_cities_priority ON cities(priority DESC);
CREATE INDEX IF NOT EXISTS idx_transport_systems_city ON transport_systems(city_id);
CREATE INDEX IF NOT EXISTS idx_transport_systems_type ON transport_systems(system_type);
CREATE INDEX IF NOT EXISTS idx_osm_sync_logs_status ON osm_sync_logs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_osm_sync_logs_city ON osm_sync_logs(city_id, started_at DESC);

-- Enable RLS
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE osm_sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for cities
CREATE POLICY "Anyone can view active cities"
  ON cities FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage cities"
  ON cities FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for transport_systems
CREATE POLICY "Anyone can view active transport systems"
  ON transport_systems FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage transport systems"
  ON transport_systems FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for osm_sync_logs
CREATE POLICY "Admins can view sync logs"
  ON osm_sync_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert sync logs"
  ON osm_sync_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update sync logs"
  ON osm_sync_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Create trigger function
CREATE OR REPLACE FUNCTION update_cities_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS update_cities_updated_at_trigger ON cities;
CREATE TRIGGER update_cities_updated_at_trigger
  BEFORE UPDATE ON cities
  FOR EACH ROW
  EXECUTE FUNCTION update_cities_updated_at();

-- Seed cities data
INSERT INTO cities (name, state, bbox_north, bbox_south, bbox_east, bbox_west, priority) VALUES
  ('Ciudad de México', 'CDMX', 19.593, 19.048, -98.941, -99.365, 1),
  ('Guadalajara', 'Jalisco', 20.769, 20.615, -103.268, -103.436, 2),
  ('Monterrey', 'Nuevo León', 25.772, 25.602, -100.204, -100.403, 3),
  ('Puebla', 'Puebla', 19.116, 18.965, -98.143, -98.276, 4),
  ('Querétaro', 'Querétaro', 20.639, 20.545, -100.340, -100.447, 5),
  ('Toluca', 'Estado de México', 19.334, 19.237, -99.608, -99.709, 6),
  ('Cuernavaca', 'Morelos', 18.960, 18.876, -99.180, -99.274, 7),
  ('Pachuca', 'Hidalgo', 20.143, 20.063, -98.708, -98.787, 8)
ON CONFLICT (name) DO NOTHING;

-- Seed transport systems for CDMX
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Metro CDMX',
  'metro',
  'STC Metro',
  '{"railway": ["station", "subway_entrance"], "network": "Metro de la Ciudad de México"}'::jsonb,
  'train',
  '#F54291'
FROM cities WHERE name = 'Ciudad de México'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Metrobús',
  'brt',
  'Metrobús',
  '{"highway": "bus_stop", "network": "Metrobús"}'::jsonb,
  'bus',
  '#E11F26'
FROM cities WHERE name = 'Ciudad de México'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Tren Ligero',
  'light_rail',
  'STE',
  '{"railway": "station", "operator": "STE"}'::jsonb,
  'train',
  '#FF6B00'
FROM cities WHERE name = 'Ciudad de México'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Tren Suburbano',
  'commuter_rail',
  'Ferrocarriles Suburbanos',
  '{"railway": "station", "operator": "Ferrocarriles Suburbanos"}'::jsonb,
  'train',
  '#D6006C'
FROM cities WHERE name = 'Ciudad de México'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Cablebús',
  'gondola',
  'Cablebús',
  '{"aerialway": "station", "operator": "Cablebús"}'::jsonb,
  'cable-car',
  '#0071BC'
FROM cities WHERE name = 'Ciudad de México'
ON CONFLICT DO NOTHING;

-- Seed transport systems for Guadalajara
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Tren Ligero Guadalajara',
  'light_rail',
  'SITEUR',
  '{"railway": "station", "network": ["Tren Ligero de Guadalajara", "SITEUR"]}'::jsonb,
  'train',
  '#ED1C24'
FROM cities WHERE name = 'Guadalajara'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Macrobús',
  'brt',
  'Macrobús',
  '{"highway": "bus_stop", "network": "Macrobús"}'::jsonb,
  'bus',
  '#009FE3'
FROM cities WHERE name = 'Guadalajara'
ON CONFLICT DO NOTHING;

-- Seed transport systems for Monterrey
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Metrorrey',
  'metro',
  'Metrorrey',
  '{"railway": "station", "network": "Metrorrey"}'::jsonb,
  'train',
  '#EE7F00'
FROM cities WHERE name = 'Monterrey'
ON CONFLICT DO NOTHING;

INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Ecovía',
  'brt',
  'Ecovía',
  '{"highway": "bus_stop", "network": "Ecovía"}'::jsonb,
  'bus',
  '#00A859'
FROM cities WHERE name = 'Monterrey'
ON CONFLICT DO NOTHING;

-- Add bus stations for all cities
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Terminales de Autobuses',
  'bus_station',
  NULL,
  '{"amenity": "bus_station"}'::jsonb,
  'bus',
  '#6B7280'
FROM cities
ON CONFLICT DO NOTHING;

-- Add tourist attractions for all cities
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Atracciones Turísticas',
  'attraction',
  NULL,
  '{"tourism": ["attraction", "museum", "monument"]}'::jsonb,
  'landmark',
  '#8B5CF6'
FROM cities
ON CONFLICT DO NOTHING;

-- Add airports for major cities
INSERT INTO transport_systems (city_id, name, system_type, operator, osm_query, icon, color) 
SELECT 
  id,
  'Aeropuertos',
  'airport',
  NULL,
  '{"aeroway": "aerodrome"}'::jsonb,
  'plane',
  '#3B82F6'
FROM cities WHERE name IN ('Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Querétaro')
ON CONFLICT DO NOTHING;
