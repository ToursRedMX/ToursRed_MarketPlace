
-- Remove the duplicate authenticated SELECT policy
DROP POLICY IF EXISTS "Agencies can view their tour departure locations" ON tour_departure_locations;

-- The public policy already exists and covers all cases
-- "Anyone can view tour departure locations" allows both public and authenticated users
