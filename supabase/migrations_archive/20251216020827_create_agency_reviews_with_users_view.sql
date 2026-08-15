
-- Create view for agency reviews with user information
CREATE OR REPLACE VIEW agency_reviews_with_users AS
SELECT 
  ar.id,
  ar.agency_id,
  ar.traveler_id,
  ar.rating,
  ar.comment,
  ar.reply,
  ar.created_at,
  ar.updated_at,
  ar.is_visible,
  u.first_name as traveler_first_name,
  u.last_name as traveler_last_name
FROM agency_reviews ar
LEFT JOIN users u ON u.id = ar.traveler_id
WHERE ar.is_visible = true;

-- Grant access to the view
GRANT SELECT ON agency_reviews_with_users TO anon, authenticated;
