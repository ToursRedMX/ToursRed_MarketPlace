
-- Function to check if an email is available (callable by anon for pre-signup validation)
CREATE OR REPLACE FUNCTION public.check_email_available(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.users WHERE lower(email) = lower(p_email)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_email_available(text) TO authenticated;
