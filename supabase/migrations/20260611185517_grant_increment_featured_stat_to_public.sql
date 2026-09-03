-- Allow all users (authenticated and anonymous visitors) to call the stat tracker
GRANT EXECUTE ON FUNCTION public.increment_featured_stat(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_featured_stat(uuid, text) TO anon;