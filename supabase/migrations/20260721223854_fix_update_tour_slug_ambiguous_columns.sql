/*
# Fix update_tour_slug — column reference "slug" is ambiguous

The EXISTS checks inside the function used unqualified `slug` and `old_slug`
column names which became ambiguous once the function's own local variable
`v_tour.slug` was in scope. All column references are now fully table-qualified.
*/

CREATE OR REPLACE FUNCTION public.update_tour_slug(
  p_tour_id uuid,
  p_new_slug text,
  p_confirm boolean DEFAULT false
)
RETURNS TABLE(success boolean, slug text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour RECORD;
  v_old_slug text;
BEGIN
  SELECT t.slug, t.is_published, t.agency_id INTO v_tour
  FROM public.tours t WHERE t.id = p_tour_id;

  IF NOT FOUND THEN
    RETURN QUERY VALUES (false, NULL::text, 'Tour no encontrado');
    RETURN;
  END IF;

  -- Ownership validation: only the tour owner or an admin
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = v_tour.agency_id AND a.user_id = auth.uid()
    )
    OR public.is_admin_user()
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'No autorizado');
    RETURN;
  END IF;

  v_old_slug := v_tour.slug;

  -- If tour is published, require explicit confirmation
  IF v_tour.is_published = true AND p_confirm = false THEN
    RETURN QUERY VALUES (false, NULL::text, 'CONFIRMATION_REQUIRED');
    RETURN;
  END IF;

  -- Validate uniqueness against tours.slug AND tour_slug_history.old_slug
  IF EXISTS (
    SELECT 1 FROM public.tours t2
    WHERE t2.slug = p_new_slug AND t2.id <> p_tour_id
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en tours');
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tour_slug_history h
    WHERE h.old_slug = p_new_slug
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en histórico');
    RETURN;
  END IF;

  -- No-op if slug unchanged
  IF v_old_slug = p_new_slug THEN
    RETURN QUERY VALUES (true, v_old_slug, 'Sin cambios');
    RETURN;
  END IF;

  -- Chain compression: update new_slug in ALL existing history rows for this tour
  UPDATE public.tour_slug_history h
  SET h.new_slug = p_new_slug
  WHERE h.tour_id = p_tour_id
    AND h.new_slug <> p_new_slug;

  -- Insert the new history row
  INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, changed_by, reason)
  VALUES (p_tour_id, v_tour.agency_id, v_old_slug, p_new_slug, auth.uid(), 'edited');

  -- Update the tour's slug
  UPDATE public.tours t3 SET t3.slug = p_new_slug WHERE t3.id = p_tour_id;

  RETURN QUERY VALUES (true, p_new_slug, 'OK');
END;
$$;
