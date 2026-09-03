
-- Drop the old authenticated-only policy
DROP POLICY IF EXISTS "Anyone can view agency reviews" ON agency_reviews;

-- Ensure we have the public access policy (recreate if needed)
DROP POLICY IF EXISTS "Anyone can view visible agency reviews" ON agency_reviews;
CREATE POLICY "Anyone can view visible agency reviews"
  ON agency_reviews FOR SELECT
  USING (is_visible = true);
