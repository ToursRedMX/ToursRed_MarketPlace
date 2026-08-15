
-- Create the featured_pois table
CREATE TABLE IF NOT EXISTS featured_pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'poi',
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'Ciudad de México',
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  keywords text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE featured_pois ENABLE ROW LEVEL SECURITY;

-- Public read access for active POIs
CREATE POLICY "Anyone can view active featured POIs"
  ON featured_pois
  FOR SELECT
  USING (is_active = true);

-- Admin write access
CREATE POLICY "Admins can manage featured POIs"
  ON featured_pois
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_featured_pois_city ON featured_pois(city);
CREATE INDEX IF NOT EXISTS idx_featured_pois_category ON featured_pois(category);
CREATE INDEX IF NOT EXISTS idx_featured_pois_active ON featured_pois(is_active);

-- Create a function to search featured POIs
CREATE OR REPLACE FUNCTION search_featured_pois(
  search_query text,
  limit_results int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  category text,
  address text,
  city text,
  state text,
  latitude numeric,
  longitude numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fp.id,
    fp.name,
    fp.description,
    fp.category,
    fp.address,
    fp.city,
    fp.state,
    fp.latitude,
    fp.longitude
  FROM featured_pois fp
  WHERE fp.is_active = true
    AND (
      fp.name ILIKE '%' || search_query || '%'
      OR fp.address ILIKE '%' || search_query || '%'
      OR EXISTS (
        SELECT 1 FROM unnest(fp.keywords) kw
        WHERE kw ILIKE '%' || search_query || '%'
      )
    )
  ORDER BY 
    CASE
      WHEN fp.name ILIKE search_query || '%' THEN 1
      WHEN fp.name ILIKE '%' || search_query || '%' THEN 2
      ELSE 3
    END,
    fp.name
  LIMIT limit_results;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- Insert popular POIs in Mexico City and surrounding areas
INSERT INTO featured_pois (name, description, category, address, city, state, latitude, longitude, keywords) VALUES
-- Monuments & Landmarks
('Monumento a la Revolución', 'Monumento histórico y mirador', 'monument', 'Plaza de la República S/N, Tabacalera, Cuauhtémoc, 06030 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4363, -99.1544, ARRAY['monumento', 'revolucion', 'memorial', 'mirador']),
('Ángel de la Independencia', 'Monumento emblemático de la Ciudad de México', 'monument', 'Av. Paseo de la Reforma S/N, Cuauhtémoc, 06600 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4270, -99.1677, ARRAY['angel', 'independencia', 'reforma', 'monumento']),
('Palacio de Bellas Artes', 'Centro cultural y arquitectónico', 'landmark', 'Av. Juárez S/N, Centro Histórico, Cuauhtémoc, 06050 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4352, -99.1412, ARRAY['bellas artes', 'palacio', 'cultura', 'centro']),
('Basílica de Guadalupe', 'Santuario religioso más visitado de México', 'landmark', 'Plaza de las Américas 1, Villa de Guadalupe, Gustavo A. Madero, 07050 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4847, -99.1172, ARRAY['basilica', 'guadalupe', 'virgen', 'santuario']),
('Castillo de Chapultepec', 'Castillo histórico y museo', 'landmark', 'Bosque de Chapultepec I Secc, Miguel Hidalgo, 11580 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4204, -99.1818, ARRAY['castillo', 'chapultepec', 'bosque', 'museo']),

-- Metro Stations (Major hubs)
('Metro Toreo', 'Estación del Metro Línea 7', 'metro_station', 'Av. Gustavo Baz, Naucalpan de Juárez, 53390 Estado de México', 'Naucalpan', 'Estado de México', 19.4969, -99.2047, ARRAY['metro', 'toreo', 'linea 7', 'estacion']),
('Metro Indios Verdes', 'Estación del Metro Línea 3', 'metro_station', 'Av. de los Insurgentes Norte, Gustavo A. Madero, 07700 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.5953, -99.1199, ARRAY['metro', 'indios verdes', 'linea 3', 'terminal']),
('Metro Pantitlán', 'Estación de transferencia múltiple', 'metro_station', 'Calle 7, Pantitlán, Iztacalco, 08100 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4153, -99.0727, ARRAY['metro', 'pantitlan', 'transferencia']),
('Metro Cuatro Caminos', 'Estación del Metro Línea 2', 'metro_station', 'Av. Ingenieros Militares, Cuauhtémoc, 11200 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4594, -99.2085, ARRAY['metro', 'cuatro caminos', 'linea 2']),
('Metro Balderas', 'Estación de transferencia Líneas 1 y 3', 'metro_station', 'Av. Chapultepec, Juárez, 06600 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4277, -99.1527, ARRAY['metro', 'balderas', 'centro']),

-- Shopping Centers
('Centro Comercial Toreo Parque Central', 'Centro comercial moderno', 'shopping', 'Vía Gustavo Baz 15, Naucalpan Centro, 53000 Naucalpan de Juárez', 'Naucalpan', 'Estado de México', 19.4977, -99.2025, ARRAY['toreo', 'parque central', 'comercial', 'shopping']),
('Perisur', 'Centro comercial del sur de la ciudad', 'shopping', 'Anillo Periférico 4690, Jardines del Pedregal, Coyoacán, 04500 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3029, -99.1896, ARRAY['perisur', 'shopping', 'sur']),
('Santa Fe', 'Zona comercial y de negocios', 'shopping', 'Av. Vasco de Quiroga 3800, Santa Fe, Cuajimalpa, 05109 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3595, -99.2629, ARRAY['santa fe', 'centro', 'comercial']),
('Centro Histórico', 'Centro histórico de la Ciudad de México', 'landmark', 'Centro Histórico, Cuauhtémoc, 06000 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4326, -99.1332, ARRAY['centro', 'historico', 'zocalo', 'downtown']),

-- Torres de Satélite
('Torres de Satélite', 'Esculturas monumentales', 'monument', 'Anillo Periférico, Ciudad Satélite, 53100 Naucalpan de Juárez', 'Naucalpan', 'Estado de México', 19.5120, -99.2388, ARRAY['torres', 'satelite', 'ciudad satelite', 'monumento']),

-- Estadios
('Estadio Azteca', 'Estadio de fútbol icónico', 'stadium', 'Calz. de Tlalpan 3465, Santa Úrsula Coapa, Coyoacán, 04650 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3030, -99.1506, ARRAY['estadio', 'azteca', 'futbol']),

-- Other landmarks
('Zona Rosa', 'Zona comercial y de entretenimiento', 'neighborhood', 'Juárez, Cuauhtémoc, 06600 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4284, -99.1642, ARRAY['zona rosa', 'entretenimiento', 'restaurants']),
('Polanco', 'Zona exclusiva de restaurantes y tiendas', 'neighborhood', 'Polanco, Miguel Hidalgo, 11560 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.4338, -99.1950, ARRAY['polanco', 'restaurantes', 'zona exclusiva']),
('Coyoacán', 'Barrio tradicional y cultural', 'neighborhood', 'Coyoacán, 04000 Ciudad de México', 'Ciudad de México', 'Ciudad de México', 19.3467, -99.1618, ARRAY['coyoacan', 'barrio', 'cultural', 'plaza'])

ON CONFLICT DO NOTHING;
