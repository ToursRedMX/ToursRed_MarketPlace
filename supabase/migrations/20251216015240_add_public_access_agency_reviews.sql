
-- Allow anyone (including non-authenticated users) to view visible agency reviews
DROP POLICY IF EXISTS "Anyone can view agency reviews" ON agency_reviews;
CREATE POLICY "Anyone can view agency reviews"
  ON agency_reviews FOR SELECT
  USING (is_visible = true);

-- Allow anyone (including non-authenticated users) to view basic info of users who wrote visible reviews
DROP POLICY IF EXISTS "Anyone can view basic info of users who wrote agency reviews" ON users;
CREATE POLICY "Anyone can view basic info of users who wrote agency reviews"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agency_reviews
      WHERE agency_reviews.traveler_id = users.id
      AND agency_reviews.is_visible = true
    )
  );
