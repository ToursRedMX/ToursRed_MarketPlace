-- Function to search a user by email for adding as agency staff (coordinator).
-- SECURITY DEFINER bypasses RLS so agencies can look up any traveler by email.
-- Only returns traveler-role users who are active and email-verified.
CREATE OR REPLACE FUNCTION public.search_user_by_email_for_staff(p_email text)
RETURNS TABLE(id uuid, first_name text, last_name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.first_name, u.last_name, u.email
  FROM public.users u
  WHERE u.email = p_email
    AND u.is_active = true
    AND u.email_verified = true
    AND u.role NOT IN ('super_admin', 'admin', 'agency', 'account_executive')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_user_by_email_for_staff(text) TO authenticated;
