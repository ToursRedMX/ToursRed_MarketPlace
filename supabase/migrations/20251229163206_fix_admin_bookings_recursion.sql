
-- Drop the problematic policy
DROP POLICY IF EXISTS "Admins can read all bookings" ON bookings;

-- Create a safe function to check if user is admin (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
$$;

-- Add new admin policy using the safe function
CREATE POLICY "Admins can read all bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (public.is_admin());
