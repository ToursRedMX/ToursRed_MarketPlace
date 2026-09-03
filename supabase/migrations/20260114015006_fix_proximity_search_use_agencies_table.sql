-- Drop and recreate the function with correct table joins
DROP FUNCTION IF EXISTS search_tours_by_departure_radius(double precision, double precision, double precision, text[], text, numeric, numeric, integer);

CREATE OR REPLACE FUNCTION search_tours_by_departure_radius(
  search_lat double precision,
  search_lng double precision,
  radius_km double precision DEFAULT 5,
  filter_category text[] DEFAULT NULL,
  filter_destination text DEFAULT NULL,
  min_price numeric DEFAULT NULL,
  max_price numeric DEFAULT NULL,
  limit_results integer DEFAULT 100
)
RETURNS TABLE (
  tour_id uuid,
  tour_name text,
  tour_description text,
  tour_price numeric,
  tour_category text[],
  tour_destination text,
  tour_image_url text,
  tour_is_featured boolean,
  tour_start_date date,
  tour_end_date date,
  agency_id uuid,
  agency_name text,
  distance_meters double precision,
  nearest_departure_location text,
  nearest_departure_address text,
  all_departure_locations jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  search_point geography;
BEGIN
  -- Create geography point from latitude and longitude
  search_point := ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography;
  
  RETURN QUERY
  WITH nearby_locations AS (
    -- Find all departure locations within radius
    SELECT 
      dl.id,
      dl.name,
      dl.address,
      dl.city,
      ST_Distance(dl.location, search_point) as distance_m
    FROM departure_locations dl
    WHERE 
      dl.is_active = true
      AND ST_DWithin(dl.location, search_point, radius_km * 1000)
  ),
  tour_distances AS (
    -- Get minimum distance for each tour
    SELECT 
      tdl.tour_id,
      MIN(nl.distance_m) as min_distance,
      -- Get the nearest location details
      (
        SELECT jsonb_build_object(
          'name', nl2.name,
          'address', nl2.address,
          'city', nl2.city,
          'distance', nl2.distance_m
        )
        FROM nearby_locations nl2
        WHERE nl2.id IN (
          SELECT tdl2.location_id 
          FROM tour_departure_locations tdl2
          WHERE tdl2.tour_id = tdl.tour_id
        )
        ORDER BY nl2.distance_m ASC
        LIMIT 1
      ) as nearest_location,
      -- Get all nearby departure locations for this tour
      jsonb_agg(
        jsonb_build_object(
          'id', nl.id,
          'name', nl.name,
          'address', nl.address,
          'city', nl.city,
          'distance', nl.distance_m,
          'is_primary', tdl.is_primary,
          'meeting_time', tdl.meeting_time,
          'meeting_instructions', tdl.meeting_instructions
        ) ORDER BY nl.distance_m ASC
      ) as all_locations
    FROM tour_departure_locations tdl
    INNER JOIN nearby_locations nl ON nl.id = tdl.location_id
    GROUP BY tdl.tour_id
  )
  SELECT 
    t.id as tour_id,
    t.name as tour_name,
    t.description as tour_description,
    t.price as tour_price,
    t.category as tour_category,
    t.destination as tour_destination,
    t.image_url as tour_image_url,
    t.is_featured as tour_is_featured,
    t.start_date as tour_start_date,
    t.end_date as tour_end_date,
    t.agency_id,
    a.name as agency_name,
    td.min_distance as distance_meters,
    (td.nearest_location->>'name')::text as nearest_departure_location,
    (td.nearest_location->>'address')::text as nearest_departure_address,
    td.all_locations as all_departure_locations
  FROM tours t
  INNER JOIN tour_distances td ON td.tour_id = t.id
  INNER JOIN agencies a ON a.user_id = t.agency_id
  INNER JOIN users u ON u.id = t.agency_id
  WHERE 
    t.is_active = true
    AND u.is_active = true
    AND u.role = 'agency'
    -- Apply category filter if provided
    AND (
      filter_category IS NULL 
      OR t.category && filter_category
    )
    -- Apply destination filter if provided
    AND (
      filter_destination IS NULL 
      OR t.destination ILIKE '%' || filter_destination || '%'
    )
    -- Apply price filters if provided
    AND (
      min_price IS NULL 
      OR t.price >= min_price
    )
    AND (
      max_price IS NULL 
      OR t.price <= max_price
    )
  ORDER BY 
    td.min_distance ASC,
    t.is_featured DESC,
    t.created_at DESC
  LIMIT limit_results;
END;
$$;
