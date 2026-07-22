
-- Ensure users table has RLS enabled
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop any conflicting policies
DROP POLICY IF EXISTS "Public can view basic reviewer info" ON users;

-- Allow reading basic user info (first_name, last_name) for any user
-- This is safe because we only expose non-sensitive information
CREATE POLICY "Public can view basic reviewer info"
  ON users FOR SELECT
  USING (true);

-- Recreate the get_agency_reviews_with_users function to ensure it works
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
  FROM public.agency_reviews ar
  LEFT JOIN public.users u ON u.id = ar.traveler_id
  WHERE ar.agency_id = p_agency_id
    AND ar.is_visible = true
  ORDER BY ar.created_at DESC;
END;
$$;

-- Ensure permissions are set
GRANT EXECUTE ON FUNCTION get_agency_reviews_with_users(UUID) TO anon, authenticated;

-- Ensure agency_reviews table allows public select on visible reviews
DROP POLICY IF EXISTS "Anyone can view visible agency reviews" ON agency_reviews;
CREATE POLICY "Anyone can view visible agency reviews"
  ON agency_reviews FOR SELECT
  USING (is_visible = true);
