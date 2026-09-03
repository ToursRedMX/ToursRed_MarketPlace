/*
# Allow agencies to view their assigned account executive

## Purpose
The RLS policy on `account_executives` only allows admins and the executive themselves to read records.
Agencies could not see their assigned executive, so the "Ejecutivo de Cuenta" card in AgencyProfile was always empty.

## Changes
- Creates `get_my_agency_executive()` SECURITY DEFINER function that:
  1. Finds the agency where `user_id = auth.uid()`
  2. If the agency has `account_executive_id`, returns the executive's first_name, last_name, email, phone
  3. Returns NULL if no executive is assigned or the user has no agency
- Grants EXECUTE to `authenticated` role only

## Security
- SECURITY DEFINER: runs with the function owner's privileges, bypassing RLS on account_executives
- Only returns the executive assigned to the calling user's own agency
- No sensitive fields exposed (only name, email, phone — already visible to the agency in their contract)
*/

DROP FUNCTION IF EXISTS public.get_my_agency_executive();

CREATE OR REPLACE FUNCTION public.get_my_agency_executive()
RETURNS TABLE (
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ae.first_name, ae.last_name, ae.email, ae.phone
  FROM agencies a
  JOIN account_executives ae ON ae.id = a.account_executive_id
  WHERE a.user_id = (SELECT auth.uid())
    AND a.account_executive_id IS NOT NULL
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_agency_executive() TO authenticated;