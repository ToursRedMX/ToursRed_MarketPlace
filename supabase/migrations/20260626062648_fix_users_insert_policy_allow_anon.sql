
-- The INSERT policy was restricted to 'authenticated' role only.
-- When supabase.auth.signUp() is called, depending on whether email
-- confirmation is required, the session may not be immediately available,
-- leaving the client in the 'anon' role when the profile insert happens.
-- The WITH CHECK (auth.uid() = id) condition already ensures only the
-- owner can insert their own row, so we can safely allow anon as well.

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (( SELECT auth.uid() AS uid) = id);
