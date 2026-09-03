-- Actualiza search_user_by_email_for_staff para buscar también en auth.identities.
-- Esto cubre el caso donde el usuario registró su cuenta con un email distinto
-- al de un proveedor OAuth vinculado (Google, Microsoft, Facebook, X).
-- Paso 1: busca coincidencia directa en public.users.email (caso común).
-- Paso 2: si no hay resultado, busca en auth.identities por identity_data->>'email'
--         y usa el user_id encontrado para obtener los datos desde public.users.
CREATE OR REPLACE FUNCTION public.search_user_by_email_for_staff(p_email text)
RETURNS TABLE(id uuid, first_name text, last_name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  -- Paso 1: busqueda directa en public.users
  SELECT u.id, u.first_name, u.last_name, u.email
  INTO v_row
  FROM public.users u
  WHERE u.email = p_email
    AND u.is_active = true
    AND u.email_verified = true
    AND u.role NOT IN ('super_admin', 'admin', 'agency', 'account_executive')
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.first_name, v_row.last_name, v_row.email;
    RETURN;
  END IF;

  -- Paso 2: fallback en auth.identities (identidades OAuth con email diferente)
  RETURN QUERY
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM auth.identities ai
    JOIN public.users u ON u.id = ai.user_id
    WHERE ai.identity_data->>'email' = p_email
      AND u.is_active = true
      AND u.email_verified = true
      AND u.role NOT IN ('super_admin', 'admin', 'agency', 'account_executive')
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_user_by_email_for_staff(text) TO authenticated;
