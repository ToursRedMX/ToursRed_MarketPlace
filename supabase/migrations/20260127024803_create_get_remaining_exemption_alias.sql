
CREATE OR REPLACE FUNCTION get_remaining_service_fee_exemption(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Simplemente llamar a la función existente
  RETURN get_available_service_fee_exemption(p_user_id);
END;
$$;
