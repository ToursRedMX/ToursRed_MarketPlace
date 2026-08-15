-- ============================================================================
-- PART 1: Clean up old geolocation system
-- ============================================================================

-- Drop old tables (cascading will remove related objects)
DROP TABLE IF EXISTS geocoding_cache CASCADE;
DROP TABLE IF EXISTS tour_departure_locations CASCADE;
DROP TABLE IF EXISTS departure_locations CASCADE;
DROP TABLE IF EXISTS osm_sync_logs CASCADE;
DROP TABLE IF EXISTS transport_systems CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS featured_pois CASCADE;

-- Drop any remaining functions from old system
DROP FUNCTION IF EXISTS update_departure_locations_updated_at() CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_geocoding_cache() CASCADE;
DROP FUNCTION IF EXISTS update_cities_updated_at() CASCADE;
DROP FUNCTION IF EXISTS search_tours_by_proximity(double precision, double precision, double precision, integer) CASCADE;

-- ============================================================================
-- PART 2: Create new simple departure points system
-- ============================================================================

-- Create departure_points table
CREATE TABLE IF NOT EXISTS departure_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  municipality text NOT NULL,
  google_maps_url text,
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create normalized search function for fuzzy matching
CREATE OR REPLACE FUNCTION normalize_text(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Convert to lowercase, remove accents, trim spaces
  RETURN LOWER(TRIM(
    TRANSLATE(
      input,
      'áéíóúÁÉÍÓÚñÑ',
      'aeiouAEIOUnN'
    )
  ));
END;
$$;

-- Create unique index for preventing case-insensitive duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_departure_points_unique_normalized
  ON departure_points(
    normalize_text(name),
    normalize_text(city),
    normalize_text(municipality)
  );

-- Create indexes for normalized text search
CREATE INDEX IF NOT EXISTS idx_departure_points_normalized_name 
  ON departure_points(normalize_text(name));

CREATE INDEX IF NOT EXISTS idx_departure_points_normalized_city 
  ON departure_points(normalize_text(city));

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_departure_points_active 
  ON departure_points(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_departure_points_usage 
  ON departure_points(usage_count DESC);

CREATE INDEX IF NOT EXISTS idx_departure_points_city_municipality 
  ON departure_points(city, municipality) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_departure_points_created_by 
  ON departure_points(created_by);

-- Create tour_departure_points junction table
CREATE TABLE IF NOT EXISTS tour_departure_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  departure_point_id uuid NOT NULL REFERENCES departure_points(id) ON DELETE CASCADE,
  display_order integer NOT NULL CHECK (display_order >= 1 AND display_order <= 4),
  created_at timestamptz DEFAULT now(),
  -- Prevent duplicate point for same tour
  CONSTRAINT unique_tour_departure_point UNIQUE (tour_id, departure_point_id),
  -- Prevent duplicate display_order for same tour
  CONSTRAINT unique_tour_display_order UNIQUE (tour_id, display_order)
);

-- Create indexes for tour_departure_points
CREATE INDEX IF NOT EXISTS idx_tour_departure_points_tour 
  ON tour_departure_points(tour_id);

CREATE INDEX IF NOT EXISTS idx_tour_departure_points_departure_point 
  ON tour_departure_points(departure_point_id);

CREATE INDEX IF NOT EXISTS idx_tour_departure_points_order 
  ON tour_departure_points(tour_id, display_order);

-- ============================================================================
-- PART 3: Constraints and Triggers
-- ============================================================================

-- Function to validate tour has 1-4 departure points
CREATE OR REPLACE FUNCTION validate_tour_departure_points_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  point_count integer;
BEGIN
  -- Get count of departure points for this tour
  SELECT COUNT(*) INTO point_count
  FROM public.tour_departure_points
  WHERE tour_id = COALESCE(NEW.tour_id, OLD.tour_id);
  
  -- On INSERT or UPDATE, count will include the new row
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF point_count > 4 THEN
      RAISE EXCEPTION 'Un tour no puede tener más de 4 puntos de salida';
    END IF;
  END IF;
  
  -- On DELETE, count will not include the deleted row
  IF (TG_OP = 'DELETE') THEN
    IF point_count - 1 < 1 THEN
      RAISE EXCEPTION 'Un tour debe tener al menos 1 punto de salida';
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger for validating departure points count
DROP TRIGGER IF EXISTS validate_tour_departure_points_count_trigger ON tour_departure_points;
CREATE TRIGGER validate_tour_departure_points_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON tour_departure_points
  FOR EACH ROW
  EXECUTE FUNCTION validate_tour_departure_points_count();

-- Function to update usage_count when a point is used
CREATE OR REPLACE FUNCTION update_departure_point_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Increment usage count
    UPDATE public.departure_points
    SET usage_count = usage_count + 1
    WHERE id = NEW.departure_point_id;
  ELSIF (TG_OP = 'DELETE') THEN
    -- Decrement usage count (but don't go below 0)
    UPDATE public.departure_points
    SET usage_count = GREATEST(0, usage_count - 1)
    WHERE id = OLD.departure_point_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger for usage count
DROP TRIGGER IF EXISTS update_departure_point_usage_trigger ON tour_departure_points;
CREATE TRIGGER update_departure_point_usage_trigger
  AFTER INSERT OR DELETE ON tour_departure_points
  FOR EACH ROW
  EXECUTE FUNCTION update_departure_point_usage();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_departure_points_updated_at()
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

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_departure_points_updated_at_trigger ON departure_points;
CREATE TRIGGER update_departure_points_updated_at_trigger
  BEFORE UPDATE ON departure_points
  FOR EACH ROW
  EXECUTE FUNCTION update_departure_points_updated_at();

-- ============================================================================
-- PART 4: Row Level Security (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE departure_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE tour_departure_points ENABLE ROW LEVEL SECURITY;

-- RLS Policies for departure_points

-- Public can view active departure points
CREATE POLICY "Anyone can view active departure points"
  ON departure_points FOR SELECT
  USING (is_active = true);

-- Agencies can create new departure points
CREATE POLICY "Agencies can create departure points"
  ON departure_points FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Admins can view all departure points (including inactive)
CREATE POLICY "Admins can view all departure points"
  ON departure_points FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can create departure points
CREATE POLICY "Admins can create departure points"
  ON departure_points FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update departure points
CREATE POLICY "Admins can update departure points"
  ON departure_points FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can delete departure points (soft delete by setting is_active = false is preferred)
CREATE POLICY "Admins can delete departure points"
  ON departure_points FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
    AND usage_count = 0  -- Only allow deletion if not in use
  );

-- RLS Policies for tour_departure_points

-- Anyone can view tour departure points
CREATE POLICY "Anyone can view tour departure points"
  ON tour_departure_points FOR SELECT
  USING (true);

-- Agencies can add departure points to their own tours
CREATE POLICY "Agencies can add departure points to their tours"
  ON tour_departure_points FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.agencies ON agencies.id = tours.agency_id
      WHERE tours.id = tour_id
      AND agencies.user_id = auth.uid()
    )
  );

-- Agencies can update departure points for their own tours
CREATE POLICY "Agencies can update their tour departure points"
  ON tour_departure_points FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.agencies ON agencies.id = tours.agency_id
      WHERE tours.id = tour_id
      AND agencies.user_id = auth.uid()
    )
  );

-- Agencies can delete departure points from their own tours
CREATE POLICY "Agencies can delete their tour departure points"
  ON tour_departure_points FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.agencies ON agencies.id = tours.agency_id
      WHERE tours.id = tour_id
      AND agencies.user_id = auth.uid()
    )
  );

-- Admins have full access to tour_departure_points
CREATE POLICY "Admins can manage all tour departure points"
  ON tour_departure_points FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- PART 5: Seed initial departure points (common locations in Mexico)
-- ============================================================================

-- Insert some popular departure points to get started
INSERT INTO departure_points (name, city, municipality, google_maps_url, created_by) VALUES
  ('Monumento a la Revolución', 'Ciudad de México', 'Cuauhtémoc', 'https://goo.gl/maps/monumentorevolucion', NULL),
  ('Ángel de la Independencia', 'Ciudad de México', 'Cuauhtémoc', 'https://goo.gl/maps/angelindependencia', NULL),
  ('Zócalo', 'Ciudad de México', 'Cuauhtémoc', 'https://goo.gl/maps/zocalocdmx', NULL),
  ('Terminal de Autobuses TAPO', 'Ciudad de México', 'Venustiano Carranza', 'https://goo.gl/maps/tapo', NULL),
  ('Terminal de Autobuses del Norte', 'Ciudad de México', 'Gustavo A. Madero', 'https://goo.gl/maps/terminalnorte', NULL),
  ('Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'Venustiano Carranza', 'https://goo.gl/maps/aicm', NULL),
  ('Plaza Garibaldi', 'Ciudad de México', 'Cuauhtémoc', 'https://goo.gl/maps/garibaldi', NULL),
  ('Catedral Metropolitana', 'Ciudad de México', 'Cuauhtémoc', 'https://goo.gl/maps/catedral', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 6: Helper functions for searching and management
-- ============================================================================

-- Function to search departure points with fuzzy matching
CREATE OR REPLACE FUNCTION search_departure_points(
  search_query text,
  limit_count integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  municipality text,
  google_maps_url text,
  usage_count integer,
  relevance_score real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_query text;
BEGIN
  normalized_query := normalize_text(search_query);
  
  RETURN QUERY
  SELECT 
    dp.id,
    dp.name,
    dp.city,
    dp.municipality,
    dp.google_maps_url,
    dp.usage_count,
    -- Calculate relevance score based on similarity and usage
    (
      CASE 
        -- Exact match gets highest score
        WHEN normalize_text(dp.name) = normalized_query THEN 100
        -- Starts with query gets high score
        WHEN normalize_text(dp.name) LIKE normalized_query || '%' THEN 80
        -- Contains query gets medium score
        WHEN normalize_text(dp.name) LIKE '%' || normalized_query || '%' THEN 60
        -- City or municipality match gets lower score
        WHEN normalize_text(dp.city) LIKE '%' || normalized_query || '%' THEN 40
        WHEN normalize_text(dp.municipality) LIKE '%' || normalized_query || '%' THEN 30
        ELSE 20
      END
      +  -- Add bonus for usage (popular locations rank higher)
      (LEAST(dp.usage_count::real / 10, 20))
    )::real AS relevance_score
  FROM public.departure_points dp
  WHERE 
    dp.is_active = true
    AND (
      normalize_text(dp.name) LIKE '%' || normalized_query || '%'
      OR normalize_text(dp.city) LIKE '%' || normalized_query || '%'
      OR normalize_text(dp.municipality) LIKE '%' || normalized_query || '%'
    )
  ORDER BY relevance_score DESC, dp.usage_count DESC, dp.name ASC
  LIMIT limit_count;
END;
$$;

-- Function to get tours using a specific departure point
CREATE OR REPLACE FUNCTION get_tours_for_departure_point(point_id uuid)
RETURNS TABLE (
  tour_id uuid,
  tour_name text,
  agency_name text,
  display_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.name,
    a.name,
    tdp.display_order
  FROM public.tour_departure_points tdp
  JOIN public.tours t ON t.id = tdp.tour_id
  JOIN public.agencies a ON a.id = t.agency_id
  WHERE tdp.departure_point_id = point_id
  ORDER BY tdp.display_order ASC;
END;
$$;

-- ============================================================================
-- End of migration
-- ============================================================================
