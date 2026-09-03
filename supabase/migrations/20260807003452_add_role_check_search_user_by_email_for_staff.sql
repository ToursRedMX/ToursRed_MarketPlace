/*
# Add caller role check to search_user_by_email_for_staff

## Problem
The function `search_user_by_email_for_staff` is SECURITY DEFINER and grants EXECUTE
to authenticated. Any authenticated user — including regular travelers — can call
it to enumerate user emails. The function had no internal auth.uid() check.

## Changes
1. Recreate the function with an internal role check at the start: look up the
   caller's role in public.users via auth.uid(). Only allow staff roles
   (agency, admin, super_admin, account_executive, accountant) to proceed.
2. If the caller's role is not a staff role, raise an exception.
3. Re-apply the existing grants (REVOKE FROM PUBLIC/anon, GRANT TO authenticated).
*/

DROP FUNCTION IF EXISTS public.search_user_by_email_for_staff(text);

CREATE OR REPLACE FUNCTION public.search_user_by_email_for_staff(p_email text)
RETURNS TABLE(id uuid, first_name text, last_name text, email text, is_restricted_role boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_caller_role text;
BEGIN
  -- Verify caller is a staff role (agency, admin, super_admin, account_executive, accountant)
  SELECT u.role INTO v_caller_role
  FROM public.users u
  WHERE u.id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('agency', 'admin', 'super_admin', 'account_executive', 'accountant') THEN
    RAISE EXCEPTION 'No autorizado: solo personal autorizado puede buscar usuarios';
  END IF;

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
