
-- Drop existing view if it exists
DROP VIEW IF EXISTS agency_reviews_with_users;

-- Create a SECURITY DEFINER function to get reviews with user info
CREATE OR REPLACE FUNCTION get_agency_reviews_with_users(p_agency_id UUID)
RETURNS TABLE (
  id UUID,
  agency_id UUID,
  traveler_id UUID,
  rating INTEGER,
  comment TEXT,
  reply TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  traveler_first_name TEXT,
  traveler_last_name TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ar.id,
    ar.agency_id,
    ar.traveler_id,
    ar.rating,
    ar.comment,
    ar.reply,
    ar.created_at,
    ar.updated_at,
    u.first_name,
    u.last_name
  FROM agency_reviews ar
  LEFT JOIN users u ON u.id = ar.traveler_id
  WHERE ar.agency_id = p_agency_id
    AND ar.is_visible = true
  ORDER BY ar.created_at DESC;
END;
$$;

-- Grant execute permission to everyone
GRANT EXECUTE ON FUNCTION get_agency_reviews_with_users(UUID) TO anon, authenticated;
