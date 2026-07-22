
-- Drop existing policy for viewing agency reviews
DROP POLICY IF EXISTS "Anyone can view agency reviews" ON agency_reviews;

-- Create new policy allowing both authenticated and anonymous users to view agency reviews
CREATE POLICY "Anyone can view agency reviews"
  ON agency_reviews FOR SELECT
  USING (true);
