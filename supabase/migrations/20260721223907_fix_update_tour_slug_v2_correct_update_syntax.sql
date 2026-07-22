/*
# Fix update_tour_slug v2 — correct UPDATE SET syntax + chain compression

PostgreSQL UPDATE does not allow table alias in SET clause.
Also fixing the chain compression UPDATE to not use alias in SET.
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
  v_tour_slug text;
  v_tour_published boolean;
  v_tour_agency_id uuid;
BEGIN
  SELECT t.slug, t.is_published, t.agency_id
  INTO v_tour_slug, v_tour_published, v_tour_agency_id
  FROM public.tours t
  WHERE t.id = p_tour_id;

  IF NOT FOUND THEN
    RETURN QUERY VALUES (false, NULL::text, 'Tour no encontrado');
    RETURN;
  END IF;

  -- Ownership: tour owner or admin
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.agencies a
      WHERE a.id = v_tour_agency_id AND a.user_id = auth.uid()
    )
    OR public.is_admin_user()
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'No autorizado');
    RETURN;
  END IF;

  -- Published tour requires confirmation
  IF v_tour_published = true AND p_confirm = false THEN
    RETURN QUERY VALUES (false, NULL::text, 'CONFIRMATION_REQUIRED');
    RETURN;
  END IF;

  -- Validate against tours.slug (excluding self)
  IF EXISTS (
    SELECT 1 FROM public.tours t2
    WHERE t2.slug = p_new_slug AND t2.id <> p_tour_id
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en tours');
    RETURN;
  END IF;

  -- Validate against tour_slug_history.old_slug
  IF EXISTS (
    SELECT 1 FROM public.tour_slug_history h
    WHERE h.old_slug = p_new_slug
  ) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en histórico');
    RETURN;
  END IF;

  -- No-op if unchanged
  IF v_tour_slug = p_new_slug THEN
    RETURN QUERY VALUES (true, v_tour_slug, 'Sin cambios');
    RETURN;
  END IF;

  -- Chain compression: all existing history rows for this tour now point to new slug
  UPDATE public.tour_slug_history
  SET new_slug = p_new_slug
  WHERE tour_id = p_tour_id
    AND new_slug <> p_new_slug;

  -- Record the slug change
  INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, changed_by, reason)
  VALUES (p_tour_id, v_tour_agency_id, v_tour_slug, p_new_slug, auth.uid(), 'edited');

  -- Apply the new slug to the tour
  UPDATE public.tours
  SET slug = p_new_slug
  WHERE id = p_tour_id;

  RETURN QUERY VALUES (true, p_new_slug, 'OK');
END;
$$;
