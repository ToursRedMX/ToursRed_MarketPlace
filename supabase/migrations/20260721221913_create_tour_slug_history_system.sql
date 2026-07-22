/*
# Tour slug history system with chain compression

## Summary
Creates a `tour_slug_history` table to track slug renames, with chain compression
so any historical slug resolves to the current slug in a single hop. Adds functions
for composite slug generation ({tour}-{agency}), slug availability checks (against
both tours.slug and tour_slug_history.old_slug), slug resolution, and slug updates
with ownership validation. Backfills the 4 existing tours to composite slug format.

## New Tables
- `tour_slug_history`: records every slug change for a tour.
  - `id` (uuid PK)
  - `tour_id` (uuid FK → tours, CASCADE)
  - `agency_id` (uuid FK → agencies, CASCADE)
  - `old_slug` (text) — the slug before the change
  - `new_slug` (text) — the current slug at time of change (updated on subsequent renames via chain compression)
  - `changed_by` (uuid FK → auth.users)
  - `changed_at` (timestamptz)
  - `reason` (text, CHECK in 'initial','restructured','edited','auto')

## New Functions
- `resolve_tour_slug(p_old_slug)`: returns (tour_id, current_slug) for a historical slug. Single-hop resolution.
- `generate_agency_slug(p_agency_id)`: slugifies the agency name.
- `generate_composite_tour_slug(p_tour_name, p_agency_id, p_exclude_tour_id)`: generates {tour}-{agency} slug, validates against tours.slug AND tour_slug_history.old_slug.
- `check_slug_available(p_slug, p_exclude_tour_id)`: checks both tours.slug and tour_slug_history.old_slug.
- `update_tour_slug(p_tour_id, p_new_slug, p_confirm)`: validates ownership, compresses chain (UPDATE all existing history rows for this tour to the new final slug), inserts new history row, updates tours.slug.

## Security
- RLS enabled on tour_slug_history: public read (anon + authenticated), insert/update by tour owner or admin.
- All functions are SECURITY DEFINER with explicit GRANT EXECUTE.
- update_tour_slug validates that caller owns the tour (via agencies.user_id = auth.uid()) or is admin.

## Backfill
- 4 existing tours updated from simple slugs to composite {tour}-{agency} format.
- Old simple slugs recorded in tour_slug_history with reason='restructured'.
*/

-- ============================================================
-- 1. Create tour_slug_history table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tour_slug_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  agency_id   uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  old_slug    text NOT NULL,
  new_slug    text NOT NULL,
  changed_by  uuid REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL DEFAULT 'edited'
              CHECK (reason IN ('initial','restructured','edited','auto'))
);

-- Unique index: an old_slug can only point to one tour
CREATE UNIQUE INDEX IF NOT EXISTS tour_slug_history_old_slug_unique
  ON public.tour_slug_history (old_slug);

-- Index for querying history of a tour (for chain compression)
CREATE INDEX IF NOT EXISTS tour_slug_history_tour_id_idx
  ON public.tour_slug_history (tour_id);

-- ============================================================
-- 2. RLS on tour_slug_history
-- ============================================================
ALTER TABLE public.tour_slug_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tour_slug_history_public_read" ON public.tour_slug_history;
CREATE POLICY "tour_slug_history_public_read"
  ON public.tour_slug_history FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "tour_slug_history_agency_insert" ON public.tour_slug_history;
CREATE POLICY "tour_slug_history_agency_insert"
  ON public.tour_slug_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tours t
      JOIN public.agencies a ON a.id = t.agency_id
      WHERE t.id = tour_slug_history.tour_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tour_slug_history_agency_update" ON public.tour_slug_history;
CREATE POLICY "tour_slug_history_agency_update"
  ON public.tour_slug_history FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      JOIN public.agencies a ON a.id = t.agency_id
      WHERE t.id = tour_slug_history.tour_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tours t
      JOIN public.agencies a ON a.id = t.agency_id
      WHERE t.id = tour_slug_history.tour_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tour_slug_history_admin_all" ON public.tour_slug_history;
CREATE POLICY "tour_slug_history_admin_all"
  ON public.tour_slug_history FOR ALL
  TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ============================================================
-- 3. resolve_tour_slug — single-hop resolution
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_tour_slug(p_old_slug text)
RETURNS TABLE(tour_id uuid, current_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tsh.tour_id, tsh.new_slug
  FROM public.tour_slug_history tsh
  WHERE tsh.old_slug = p_old_slug
  ORDER BY tsh.changed_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_tour_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tour_slug(text) TO anon, authenticated;

-- ============================================================
-- 4. generate_agency_slug — slugify agency name
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_agency_slug(p_agency_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_slug text;
BEGIN
  SELECT a.name INTO v_name FROM public.agencies a WHERE a.id = p_agency_id;
  IF v_name IS NULL THEN
    RETURN 'agencia';
  END IF;

  v_slug := lower(v_name);
  v_slug := translate(v_slug, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiounaeioun');
  v_slug := regexp_replace(v_slug, '\s+', '-', 'g');
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' OR v_slug IS NULL THEN
    v_slug := 'agencia';
  END IF;
  RETURN v_slug;
END;
$$;

-- ============================================================
-- 5. generate_composite_tour_slug — {tour}-{agency}, validates against tours + history
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_composite_tour_slug(
  p_tour_name text,
  p_agency_id uuid,
  p_exclude_tour_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tour_base text;
  agency_base text;
  composite text;
  candidate text;
  suffix int := 0;
BEGIN
  -- Normalize tour name (same logic as generate_tour_slug)
  tour_base := lower(p_tour_name);
  tour_base := translate(tour_base, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiounaeioun');
  tour_base := regexp_replace(tour_base, '\s+', '-', 'g');
  tour_base := regexp_replace(tour_base, '[^a-z0-9-]', '', 'g');
  tour_base := regexp_replace(tour_base, '-+', '-', 'g');
  tour_base := trim(both '-' from tour_base);
  IF tour_base = '' OR tour_base IS NULL THEN
    tour_base := 'tour';
  END IF;

  agency_base := public.generate_agency_slug(p_agency_id);
  composite := tour_base || '-' || agency_base;
  candidate := composite;

  -- Validate against tours.slug AND tour_slug_history.old_slug
  WHILE EXISTS (
    SELECT 1 FROM public.tours
    WHERE tours.slug = candidate
    AND (p_exclude_tour_id IS NULL OR tours.id <> p_exclude_tour_id)
  ) OR EXISTS (
    SELECT 1 FROM public.tour_slug_history
    WHERE tour_slug_history.old_slug = candidate
  ) LOOP
    suffix := suffix + 1;
    candidate := composite || '-' || suffix::text;
  END LOOP;

  RETURN candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_composite_tour_slug(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_composite_tour_slug(text, uuid, uuid) TO authenticated;

-- ============================================================
-- 6. check_slug_available — validates against tours + history
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_slug_available(
  p_slug text,
  p_exclude_tour_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.tours
    WHERE slug = p_slug
    AND (p_exclude_tour_id IS NULL OR id <> p_exclude_tour_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.tour_slug_history WHERE old_slug = p_slug
  );
$$;

REVOKE EXECUTE ON FUNCTION public.check_slug_available(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_slug_available(text, uuid) TO authenticated;

-- ============================================================
-- 7. update_tour_slug — ownership validation + chain compression
-- ============================================================
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
  SELECT slug, is_published, agency_id INTO v_tour
  FROM public.tours WHERE id = p_tour_id;

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
  IF EXISTS (SELECT 1 FROM public.tours WHERE slug = p_new_slug AND id <> p_tour_id) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en tours');
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tour_slug_history WHERE old_slug = p_new_slug) THEN
    RETURN QUERY VALUES (false, NULL::text, 'Slug ya existe en histórico');
    RETURN;
  END IF;

  -- No-op if slug unchanged
  IF v_old_slug = p_new_slug THEN
    RETURN QUERY VALUES (true, v_old_slug, 'Sin cambios');
    RETURN;
  END IF;

  -- Chain compression: update new_slug in ALL existing history rows for this tour
  -- so any old slug resolves directly to the final current slug in one hop
  UPDATE public.tour_slug_history
  SET new_slug = p_new_slug
  WHERE tour_id = p_tour_id
    AND new_slug <> p_new_slug;

  -- Insert the new history row
  INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, changed_by, reason)
  VALUES (p_tour_id, v_tour.agency_id, v_old_slug, p_new_slug, auth.uid(), 'edited');

  -- Update the tour's slug
  UPDATE public.tours SET slug = p_new_slug WHERE id = p_tour_id;

  RETURN QUERY VALUES (true, p_new_slug, 'OK');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_tour_slug(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tour_slug(uuid, text, boolean) TO authenticated;

-- ============================================================
-- 8. Backfill — migrate 4 existing tours to composite slugs
-- ============================================================
-- Tour 1: Tlaxcala (AVENTOURAX) → tlaxcala-aventourax
INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, reason)
VALUES ('24a45977-053f-41f6-9cd5-64e80f6b8253', '88ad0b96-e675-49e7-b7fd-2b346274238c', 'tlaxcala', 'tlaxcala-aventourax', 'restructured')
ON CONFLICT (old_slug) DO NOTHING;

UPDATE public.tours SET slug = 'tlaxcala-aventourax' WHERE id = '24a45977-053f-41f6-9cd5-64e80f6b8253';

-- Tour 2: Tour a Teotihuacan (AVENTOURAX) → tour-a-teotihuacan-aventourax
INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, reason)
VALUES ('3c005f2f-5959-451b-8e82-fb27b9501fad', '88ad0b96-e675-49e7-b7fd-2b346274238c', 'tour-a-teotihuacan', 'tour-a-teotihuacan-aventourax', 'restructured')
ON CONFLICT (old_slug) DO NOTHING;

UPDATE public.tours SET slug = 'tour-a-teotihuacan-aventourax' WHERE id = '3c005f2f-5959-451b-8e82-fb27b9501fad';

-- Tour 3: Tlaxcala Agosto (AVENTOURAX) → tlaxcala-agosto-aventourax
INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, reason)
VALUES ('fcac1662-c34b-4741-8a29-628b694c1396', '88ad0b96-e675-49e7-b7fd-2b346274238c', 'tlaxcala-agosto', 'tlaxcala-agosto-aventourax', 'restructured')
ON CONFLICT (old_slug) DO NOTHING;

UPDATE public.tours SET slug = 'tlaxcala-agosto-aventourax' WHERE id = 'fcac1662-c34b-4741-8a29-628b694c1396';

-- Tour 4: Islas Marias (MA A'LOB KI'IN EXCURSIONS) → islas-marias-ma-alob-kiin-excursions
INSERT INTO public.tour_slug_history (tour_id, agency_id, old_slug, new_slug, reason)
VALUES ('d463b7d1-b933-4b56-8688-85cbea3d57e2', 'd81df1a6-26a3-436f-ab73-8359e85b1891', 'islas-marias', 'islas-marias-ma-alob-kiin-excursions', 'restructured')
ON CONFLICT (old_slug) DO NOTHING;

UPDATE public.tours SET slug = 'islas-marias-ma-alob-kiin-excursions' WHERE id = 'd463b7d1-b933-4b56-8688-85cbea3d57e2';
