
-- Enable PostGIS extension for geographic data types
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create departure_locations table
CREATE TABLE IF NOT EXISTS departure_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  address text,
  city text,
  state text,
  postal_code text,
  aliases text[] DEFAULT '{}',
  mapbox_id text UNIQUE,
  place_type text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create spatial index for fast geographic queries
CREATE INDEX IF NOT EXISTS idx_departure_locations_geography 
  ON departure_locations USING GIST(location);

-- Create GIN index for array search on aliases
CREATE INDEX IF NOT EXISTS idx_departure_locations_aliases 
  ON departure_locations USING GIN(aliases);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_departure_locations_city 
  ON departure_locations(city) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_departure_locations_mapbox_id 
  ON departure_locations(mapbox_id) WHERE mapbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_departure_locations_active 
  ON departure_locations(is_active);

-- Create tour_departure_locations junction table
CREATE TABLE IF NOT EXISTS tour_departure_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES departure_locations(id) ON DELETE CASCADE,
  is_primary boolean DEFAULT false,
  meeting_time text,
  meeting_instructions text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tour_id, location_id)
);

-- Create indexes for tour_departure_locations
CREATE INDEX IF NOT EXISTS idx_tour_departure_locations_tour 
  ON tour_departure_locations(tour_id);

CREATE INDEX IF NOT EXISTS idx_tour_departure_locations_location 
  ON tour_departure_locations(location_id);

CREATE INDEX IF NOT EXISTS idx_tour_departure_locations_primary 
  ON tour_departure_locations(tour_id, is_primary) WHERE is_primary = true;

-- Create geocoding cache table
CREATE TABLE IF NOT EXISTS geocoding_cache (
  search_query text PRIMARY KEY,
  location_id uuid REFERENCES departure_locations(id) ON DELETE CASCADE,
  mapbox_response jsonb,
  usage_count integer DEFAULT 1,
  last_used_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '90 days'),
  created_at timestamptz DEFAULT now()
);

-- Create index for cache expiration cleanup
CREATE INDEX IF NOT EXISTS idx_geocoding_cache_expires 
  ON geocoding_cache(expires_at);

-- Create index for popular queries
CREATE INDEX IF NOT EXISTS idx_geocoding_cache_usage 
  ON geocoding_cache(usage_count DESC);

-- Enable Row Level Security
ALTER TABLE departure_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tour_departure_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE geocoding_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for departure_locations

-- Public read access for all departure locations
CREATE POLICY "Anyone can view active departure locations"
  ON departure_locations FOR SELECT
  USING (is_active = true);

-- Authenticated users can insert new locations (via Edge Functions)
CREATE POLICY "Authenticated users can insert departure locations"
  ON departure_locations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Admins can update locations
CREATE POLICY "Admins can update departure locations"
  ON departure_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for tour_departure_locations

-- Anyone can view tour departure locations
CREATE POLICY "Anyone can view tour departure locations"
  ON tour_departure_locations FOR SELECT
  USING (true);

-- Agency can insert departure locations for their tours
CREATE POLICY "Agencies can add departure locations to their tours"
  ON tour_departure_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.users ON users.id = tours.agency_id
      WHERE tours.id = tour_id
      AND users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Agency can update departure locations for their tours
CREATE POLICY "Agencies can update departure locations for their tours"
  ON tour_departure_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.users ON users.id = tours.agency_id
      WHERE tours.id = tour_id
      AND users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Agency can delete departure locations for their tours
CREATE POLICY "Agencies can delete departure locations from their tours"
  ON tour_departure_locations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours
      JOIN public.users ON users.id = tours.agency_id
      WHERE tours.id = tour_id
      AND users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Admins have full access
CREATE POLICY "Admins can manage all tour departure locations"
  ON tour_departure_locations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for geocoding_cache

-- Anyone can read from cache (non-expired only)
CREATE POLICY "Anyone can read geocoding cache"
  ON geocoding_cache FOR SELECT
  USING (true);

-- Authenticated users can insert to cache (via Edge Functions)
CREATE POLICY "Authenticated users can insert to geocoding cache"
  ON geocoding_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update cache (increment usage count)
CREATE POLICY "Authenticated users can update geocoding cache"
  ON geocoding_cache FOR UPDATE
  TO authenticated
  USING (true);

-- Admins can delete from cache
CREATE POLICY "Admins can delete from geocoding cache"
  ON geocoding_cache FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_departure_locations_updated_at()
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
DROP TRIGGER IF EXISTS update_departure_locations_updated_at_trigger ON departure_locations;
CREATE TRIGGER update_departure_locations_updated_at_trigger
  BEFORE UPDATE ON departure_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_departure_locations_updated_at();

-- Create function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_geocoding_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.geocoding_cache
  WHERE expires_at < now();
END;
$$;
