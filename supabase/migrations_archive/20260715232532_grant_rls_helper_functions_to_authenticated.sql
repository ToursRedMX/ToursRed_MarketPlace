/*
# Fix: grant EXECUTE on RLS helper functions to authenticated role

## Root cause
Two SECURITY DEFINER functions used in RLS policies were missing the EXECUTE
grant for `authenticated`, causing "permission denied" errors:

1. `current_user_is_admin()` — used in RLS policies on `tour_promotions`
2. `get_current_user_agency_id()` — used in RLS policies on `tour_promotions`

## Fix
Grant EXECUTE on both functions to `authenticated`.
*/

GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_agency_id() TO authenticated;