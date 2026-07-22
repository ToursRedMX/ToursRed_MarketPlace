
-- Function to check if a CURP is available (callable by anon for pre-signup validation)
CREATE OR REPLACE FUNCTION public.check_curp_available(p_curp text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.users WHERE curp = upper(p_curp)
  );
END;
$$;

-- Function to check if a passport number is available (callable by anon for pre-signup validation)
CREATE OR REPLACE FUNCTION public.check_passport_available(p_passport text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.users WHERE passport_number = upper(p_passport)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_curp_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_curp_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_passport_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_passport_available(text) TO authenticated;
