
-- Update check_curp_available to be role-aware
-- If p_role is provided, checks uniqueness within that role only
-- If p_role is NULL, checks across all roles (conservative, for backwards compat)
CREATE OR REPLACE FUNCTION public.check_curp_available(p_curp text, p_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role IS NOT NULL THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE upper(curp) = upper(p_curp)
        AND role = p_role
    );
  ELSE
    RETURN NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE upper(curp) = upper(p_curp)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_curp_available(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_curp_available(text, text) TO authenticated;
