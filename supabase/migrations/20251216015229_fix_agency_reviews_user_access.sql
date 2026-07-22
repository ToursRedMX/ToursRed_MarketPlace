
-- Create a policy that allows reading basic user info for users who have written agency reviews
CREATE POLICY "Anyone can view basic info of users who wrote agency reviews"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agency_reviews
      WHERE agency_reviews.traveler_id = users.id
      AND agency_reviews.is_visible = true
    )
  );
