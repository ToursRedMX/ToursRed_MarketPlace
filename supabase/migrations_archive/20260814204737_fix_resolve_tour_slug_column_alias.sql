-- Fix resolve_tour_slug: SQL language functions use SELECT column names, not RETURNS TABLE names
-- The edge function reads data[0].current_slug but the function returns new_slug (from SELECT)
-- Add explicit AS alias so the JSON response uses current_slug
CREATE OR REPLACE FUNCTION public.resolve_tour_slug(p_old_slug text)
RETURNS TABLE(tour_id uuid, current_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tsh.tour_id, tsh.new_slug AS current_slug
  FROM public.tour_slug_history tsh
  WHERE tsh.old_slug = p_old_slug
  ORDER BY tsh.changed_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_tour_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tour_slug(text) TO anon, authenticated;