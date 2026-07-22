
-- Drop existing policies
DROP POLICY IF EXISTS "Agencies can add departure locations to their tours" ON tour_departure_locations;
DROP POLICY IF EXISTS "Agencies can update departure locations for their tours" ON tour_departure_locations;
DROP POLICY IF EXISTS "Agencies can delete departure locations from their tours" ON tour_departure_locations;

-- Recreate INSERT policy with simpler logic
CREATE POLICY "Agencies can insert departure locations for their tours"
  ON tour_departure_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tours
      WHERE tours.id = tour_departure_locations.tour_id
        AND tours.agency_id = auth.uid()
    )
  );

-- Recreate UPDATE policy
CREATE POLICY "Agencies can update departure locations for their tours"
  ON tour_departure_locations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tours
      WHERE tours.id = tour_departure_locations.tour_id
        AND tours.agency_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tours
      WHERE tours.id = tour_departure_locations.tour_id
        AND tours.agency_id = auth.uid()
    )
  );

-- Recreate DELETE policy
CREATE POLICY "Agencies can delete departure locations from their tours"
  ON tour_departure_locations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tours
      WHERE tours.id = tour_departure_locations.tour_id
        AND tours.agency_id = auth.uid()
    )
  );

-- Update SELECT policy to allow agencies to see their own tour's locations
DROP POLICY IF EXISTS "Anyone can view tour departure locations" ON tour_departure_locations;

CREATE POLICY "Anyone can view tour departure locations"
  ON tour_departure_locations
  FOR SELECT
  TO public
  USING (true);

-- Add SELECT policy for agencies to see their data with .select() after insert
CREATE POLICY "Agencies can view their tour departure locations"
  ON tour_departure_locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tours
      WHERE tours.id = tour_departure_locations.tour_id
        AND tours.agency_id = auth.uid()
    )
  );
