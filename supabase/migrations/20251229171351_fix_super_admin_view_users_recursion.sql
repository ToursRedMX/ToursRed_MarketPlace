
-- Drop the problematic recursive policy
DROP POLICY IF EXISTS "Super admins can view all users" ON users;

-- Create a function to check if current user is super admin
-- Using SECURITY DEFINER to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
    AND is_super_admin = true
  );
END;
$$;

-- Create non-recursive policy using the function
CREATE POLICY "Super admins can view all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());
