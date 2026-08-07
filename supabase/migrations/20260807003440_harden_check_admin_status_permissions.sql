/*
# Harden check_admin_status function permissions

## Problem
The function `check_admin_status()` returns admin email addresses via `ARRAY_AGG(email)`.
It had no explicit GRANT or REVOKE, so it defaulted to PUBLIC — executable by anyone,
including anonymous users. This leaks admin email addresses.

## Changes
1. Recreate `check_admin_status()` as `SECURITY DEFINER` with `SET search_path = public`
   to harden against search_path manipulation.
2. Revoke EXECUTE from PUBLIC, anon, and authenticated roles.
3. Grant EXECUTE only to service_role (used by admin-only edge functions).
*/

DROP FUNCTION IF EXISTS public.check_admin_status();

CREATE OR REPLACE FUNCTION public.check_admin_status()
RETURNS TABLE(
  has_admin boolean,
  admin_count bigint,
  admin_emails text[],
  instructions text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXISTS(SELECT 1 FROM public.users WHERE role = 'admin') as has_admin,
    COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
    ARRAY_AGG(email) FILTER (WHERE role = 'admin') as admin_emails,
    CASE
      WHEN EXISTS(SELECT 1 FROM public.users WHERE role = 'admin')
      THEN 'Administrador(es) configurado(s)'
      ELSE 'Usar: SELECT * FROM promote_to_admin(''tu-email@ejemplo.com'');'
    END as instructions
  FROM public.users;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_admin_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_admin_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_admin_status() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_admin_status() TO service_role;
