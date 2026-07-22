-- Actualiza search_user_by_email_for_staff para incluir el campo is_restricted_role.
-- Cuando el email encontrado pertenece a un usuario con rol restringido (agency, admin,
-- super_admin, account_executive, accountant), se devuelve una fila con is_restricted_role=true
-- en lugar de cero filas, permitiendo al frontend distinguir "no existe" de "rol no permitido".
DROP FUNCTION IF EXISTS public.search_user_by_email_for_staff(text);

CREATE OR REPLACE FUNCTION public.search_user_by_email_for_staff(p_email text)
RETURNS TABLE(id uuid, first_name text, last_name text, email text, is_restricted_role boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  -- Paso 1: busqueda directa en public.users
  SELECT u.id, u.first_name, u.last_name, u.email, u.role
  INTO v_row
  FROM public.users u
  WHERE u.email = p_email
    AND u.is_active = true
    AND u.email_verified = true
  LIMIT 1;

  IF FOUND THEN
    IF v_row.role IN ('super_admin', 'admin', 'agency', 'account_executive', 'accountant') THEN
      RETURN QUERY SELECT v_row.id, v_row.first_name, v_row.last_name, v_row.email, true;
    ELSE
      RETURN QUERY SELECT v_row.id, v_row.first_name, v_row.last_name, v_row.email, false;
    END IF;
    RETURN;
  END IF;

  -- Paso 2: fallback en auth.identities (identidades OAuth con email diferente)
  SELECT u.id, u.first_name, u.last_name, u.email, u.role
  INTO v_row
  FROM auth.identities ai
  JOIN public.users u ON u.id = ai.user_id
  WHERE ai.identity_data->>'email' = p_email
    AND u.is_active = true
    AND u.email_verified = true
  LIMIT 1;

  IF FOUND THEN
    IF v_row.role IN ('super_admin', 'admin', 'agency', 'account_executive', 'accountant') THEN
      RETURN QUERY SELECT v_row.id, v_row.first_name, v_row.last_name, v_row.email, true;
    ELSE
      RETURN QUERY SELECT v_row.id, v_row.first_name, v_row.last_name, v_row.email, false;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_user_by_email_for_staff(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_user_by_email_for_staff(text) TO authenticated;
