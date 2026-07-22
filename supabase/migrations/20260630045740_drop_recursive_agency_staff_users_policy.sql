-- Drop the policy that causes infinite recursion on the users table.
-- This policy subqueries agency_staff which has its own RLS that reads users → loop.
-- The SECURITY DEFINER function get_agency_staff_for_owner handles staff access instead.
DROP POLICY IF EXISTS "Agency can view own staff users" ON public.users;
