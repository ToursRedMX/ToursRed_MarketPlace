-- ============================================================
-- 1. agency_reviews
-- {public} "Anyone can view visible" + {authenticated} "Users and admins can view"
-- authenticated ya cubre is_visible=true OR admin → eliminar la pública
-- Mantener TO anon para acceso no autenticado
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view visible agency reviews" ON public.agency_reviews;
DROP POLICY IF EXISTS "Users and admins can view agency reviews" ON public.agency_reviews;

CREATE POLICY "Anon can view visible agency reviews"
  ON public.agency_reviews FOR SELECT
  TO anon
  USING (is_visible = true);

CREATE POLICY "Authenticated users and admins can view agency reviews"
  ON public.agency_reviews FOR SELECT
  TO authenticated
  USING (
    is_visible = true
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- 2. departure_points
-- {public} "Anyone can view active" + {authenticated} "Admins can view all"
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view active departure points" ON public.departure_points;
DROP POLICY IF EXISTS "Admins can view all departure points" ON public.departure_points;

CREATE POLICY "Anon can view active departure points"
  ON public.departure_points FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Authenticated users and admins can view departure points"
  ON public.departure_points FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- 3. reviews
-- {public} "Reviews are readable by everyone" (is_visible=true) + {authenticated} "Admins can view all"
-- ============================================================
DROP POLICY IF EXISTS "Reviews are readable by everyone" ON public.reviews;
DROP POLICY IF EXISTS "Admins can view all reviews" ON public.reviews;

CREATE POLICY "Anon can view visible reviews"
  ON public.reviews FOR SELECT
  TO anon
  USING (is_visible = true);

CREATE POLICY "Authenticated users and admins can view reviews"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (
    is_visible = true
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- 4. terms_versions
-- {public} "Public can read active" + {authenticated} "Admins can read all"
-- ============================================================
DROP POLICY IF EXISTS "Public can read active terms versions" ON public.terms_versions;
DROP POLICY IF EXISTS "Admins can read all terms versions" ON public.terms_versions;

CREATE POLICY "Anon can read active terms versions"
  ON public.terms_versions FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Authenticated users and admins can read terms versions"
  ON public.terms_versions FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- 5. tour_categories
-- {public} "Anyone can view active categories" + {authenticated} "Admins can view all categories"
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view active categories" ON public.tour_categories;
DROP POLICY IF EXISTS "Admins can view all categories" ON public.tour_categories;

CREATE POLICY "Anon can view active tour categories"
  ON public.tour_categories FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "Authenticated users and admins can view tour categories"
  ON public.tour_categories FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- 6. users
-- {public} "Public can view basic reviewer info" (USING true) + {authenticated} "Users can view own..."
-- La política pública con USING true es demasiado permisiva para authenticated.
-- Mantener TO anon para lectura básica pública, authenticated ya tiene su política.
-- ============================================================
DROP POLICY IF EXISTS "Public can view basic reviewer info" ON public.users;

CREATE POLICY "Anon can view basic user info"
  ON public.users FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- 7. destination_images
-- {public} SELECT (USING true) + {authenticated} ALL
-- Descomponer ALL en acciones separadas; SELECT de authenticated absorbe el public
-- ============================================================
DROP POLICY IF EXISTS "Destination images are readable by everyone" ON public.destination_images;
DROP POLICY IF EXISTS "Agencies and admins can manage destination images" ON public.destination_images;

CREATE POLICY "Anyone can view destination images"
  ON public.destination_images FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Agencies and admins can insert destination images"
  ON public.destination_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

CREATE POLICY "Agencies and admins can update destination images"
  ON public.destination_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

CREATE POLICY "Agencies and admins can delete destination images"
  ON public.destination_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

-- ============================================================
-- 8. tour_destinations
-- {public} SELECT (USING true) + {authenticated} ALL
-- ============================================================
DROP POLICY IF EXISTS "Tour destinations are readable by everyone" ON public.tour_destinations;
DROP POLICY IF EXISTS "Agencies can manage tour destinations" ON public.tour_destinations;

CREATE POLICY "Anyone can view tour destinations"
  ON public.tour_destinations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Agencies can insert tour destinations"
  ON public.tour_destinations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE t.id = tour_destinations.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can update tour destinations"
  ON public.tour_destinations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE t.id = tour_destinations.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE t.id = tour_destinations.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can delete tour destinations"
  ON public.tour_destinations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE t.id = tour_destinations.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- 9. tours
-- {public} SELECT (USING true) + {authenticated} ALL
-- ============================================================
DROP POLICY IF EXISTS "Tours are readable by everyone" ON public.tours;
DROP POLICY IF EXISTS "Agencies can manage own tours" ON public.tours;

CREATE POLICY "Anyone can view tours"
  ON public.tours FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Agencies can insert own tours"
  ON public.tours FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = tours.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can update own tours"
  ON public.tours FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = tours.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = tours.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can delete own tours"
  ON public.tours FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = tours.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- 10. tour_promotions
-- {anon,authenticated} "Public can view active" + {authenticated} "Agencies and admins can view"
-- Separar en TO anon y TO authenticated absorbiendo ambas condiciones
-- ============================================================
DROP POLICY IF EXISTS "Public can view active tour promotions" ON public.tour_promotions;
DROP POLICY IF EXISTS "Agencies and admins can view tour promotions" ON public.tour_promotions;

CREATE POLICY "Anon can view active tour promotions"
  ON public.tour_promotions FOR SELECT
  TO anon
  USING (
    is_active = true
    AND valid_until >= now()
    AND (max_uses IS NULL OR times_used < max_uses)
  );

CREATE POLICY "Authenticated users can view tour promotions"
  ON public.tour_promotions FOR SELECT
  TO authenticated
  USING (
    (
      is_active = true
      AND valid_until >= now()
      AND (max_uses IS NULL OR times_used < max_uses)
    )
    OR agency_id = get_current_user_agency_id()
    OR current_user_is_admin()
  );
