
-- Helper function to get the agency id for the current user
CREATE OR REPLACE FUNCTION public.get_current_user_agency_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM agencies WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Drop old policies that were blocking inserts/updates
DROP POLICY IF EXISTS "Agencies can create promotions for their tours" ON tour_promotions;
DROP POLICY IF EXISTS "Agencies can update their own promotions" ON tour_promotions;
DROP POLICY IF EXISTS "Agencies can delete their own promotions" ON tour_promotions;
DROP POLICY IF EXISTS "Agencies can view their own tour promotions" ON tour_promotions;
DROP POLICY IF EXISTS "Admins can view all tour promotions" ON tour_promotions;
DROP POLICY IF EXISTS "Admins can update any tour promotion" ON tour_promotions;

-- Recreate SELECT policy for agencies using security definer function
CREATE POLICY "Agencies can view their own tour promotions"
  ON tour_promotions FOR SELECT
  TO authenticated
  USING (
    agency_id = public.get_current_user_agency_id()
  );

-- Recreate INSERT policy using security definer function
CREATE POLICY "Agencies can create promotions for their tours"
  ON tour_promotions FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id = public.get_current_user_agency_id()
  );

-- Recreate UPDATE policy using security definer function
CREATE POLICY "Agencies can update their own promotions"
  ON tour_promotions FOR UPDATE
  TO authenticated
  USING (
    agency_id = public.get_current_user_agency_id()
  )
  WITH CHECK (
    agency_id = public.get_current_user_agency_id()
  );

-- Recreate DELETE policy using security definer function
CREATE POLICY "Agencies can delete their own promotions"
  ON tour_promotions FOR DELETE
  TO authenticated
  USING (
    agency_id = public.get_current_user_agency_id()
  );

-- Helper to check if current user is admin
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Recreate admin SELECT policy
CREATE POLICY "Admins can view all tour promotions"
  ON tour_promotions FOR SELECT
  TO authenticated
  USING (
    public.current_user_is_admin()
  );

-- Recreate admin UPDATE policy
CREATE POLICY "Admins can update any tour promotion"
  ON tour_promotions FOR UPDATE
  TO authenticated
  USING (
    public.current_user_is_admin()
  )
  WITH CHECK (
    public.current_user_is_admin()
  );
