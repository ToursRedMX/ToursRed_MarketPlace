-- ============================================================
-- 1. admin_permissions
-- ============================================================
DROP POLICY IF EXISTS "Super admins can manage all permissions" ON public.admin_permissions;
DROP POLICY IF EXISTS "Admins can read own permissions" ON public.admin_permissions;

CREATE POLICY "Admins and super admins can view admin permissions"
  ON public.admin_permissions FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can insert admin permissions"
  ON public.admin_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can update admin permissions"
  ON public.admin_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can delete admin permissions"
  ON public.admin_permissions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

-- ============================================================
-- 2. batch_payouts
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'batch_payouts'
  ) THEN
    DROP POLICY IF EXISTS "Admins can view all batch payouts" ON public.batch_payouts;
  END IF;
END $$;

-- ============================================================
-- 3. destination_images
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert destination images" ON public.destination_images;

-- ============================================================
-- 4. destinations
-- ============================================================
DROP POLICY IF EXISTS "Agencies can manage destinations" ON public.destinations;
DROP POLICY IF EXISTS "Admins can delete destinations" ON public.destinations;
DROP POLICY IF EXISTS "Admins can insert destinations" ON public.destinations;
DROP POLICY IF EXISTS "Admins can update destinations" ON public.destinations;

CREATE POLICY "Agencies and admins can insert destinations"
  ON public.destinations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

CREATE POLICY "Agencies and admins can update destinations"
  ON public.destinations FOR UPDATE
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

CREATE POLICY "Agencies and admins can delete destinations"
  ON public.destinations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

-- ============================================================
-- 5. integration_configs
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'integration_configs'
  ) THEN
    DROP POLICY IF EXISTS "Admins can view all integration configs" ON public.integration_configs;
  END IF;
END $$;

-- ============================================================
-- 6. password_reset_codes
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all password reset codes" ON public.password_reset_codes;
DROP POLICY IF EXISTS "Users can create own password reset codes" ON public.password_reset_codes;
DROP POLICY IF EXISTS "Users can view own password reset codes" ON public.password_reset_codes;
DROP POLICY IF EXISTS "Users can update own password reset codes" ON public.password_reset_codes;

CREATE POLICY "Users and admins can view password reset codes"
  ON public.password_reset_codes FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

CREATE POLICY "Users and admins can insert password reset codes"
  ON public.password_reset_codes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

CREATE POLICY "Users and admins can update password reset codes"
  ON public.password_reset_codes FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete password reset codes"
  ON public.password_reset_codes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- 7. payout_schedules
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all schedules" ON public.payout_schedules;
DROP POLICY IF EXISTS "Agencies can insert own schedule" ON public.payout_schedules;
DROP POLICY IF EXISTS "Agencies and admins can view payout schedules" ON public.payout_schedules;
DROP POLICY IF EXISTS "Agencies can update own schedule" ON public.payout_schedules;

CREATE POLICY "Agencies and admins can view payout schedules"
  ON public.payout_schedules FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

CREATE POLICY "Agencies and admins can insert payout schedules"
  ON public.payout_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

CREATE POLICY "Agencies and admins can update payout schedules"
  ON public.payout_schedules FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

CREATE POLICY "Admins can delete payout schedules"
  ON public.payout_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- 8. tour_departure_points
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all tour departure points" ON public.tour_departure_points;
DROP POLICY IF EXISTS "Agencies can add departure points to their tours" ON public.tour_departure_points;
DROP POLICY IF EXISTS "Agencies can update their tour departure points" ON public.tour_departure_points;
DROP POLICY IF EXISTS "Agencies can delete their tour departure points" ON public.tour_departure_points;

CREATE POLICY "Agencies and admins can insert tour departure points"
  ON public.tour_departure_points FOR INSERT
  TO authenticated
  WITH CHECK (
    tour_id IN (
      SELECT t.id FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

CREATE POLICY "Agencies and admins can update tour departure points"
  ON public.tour_departure_points FOR UPDATE
  TO authenticated
  USING (
    tour_id IN (
      SELECT t.id FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  )
  WITH CHECK (
    tour_id IN (
      SELECT t.id FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

CREATE POLICY "Agencies and admins can delete tour departure points"
  ON public.tour_departure_points FOR DELETE
  TO authenticated
  USING (
    tour_id IN (
      SELECT t.id FROM tours t
      JOIN agencies a ON t.agency_id = a.id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- 9. cookie_consents
-- ============================================================
DROP POLICY IF EXISTS "Anyone can record consent" ON public.cookie_consents;
CREATE POLICY "Anyone can record consent"
  ON public.cookie_consents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (
      (SELECT auth.uid()) IS NOT NULL
      AND (
        user_id = (SELECT auth.uid())
        OR user_id IS NULL
      )
    )
    OR (
      (SELECT auth.uid()) IS NULL
      AND user_id IS NULL
    )
  );

-- ============================================================
-- 10. international_tour_inquiries
-- ============================================================
DROP POLICY IF EXISTS "Anyone can submit inquiry" ON public.international_tour_inquiries;
CREATE POLICY "Anyone can submit inquiry"
  ON public.international_tour_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'nuevo'
    AND (
      user_id IS NULL
      OR user_id = (SELECT auth.uid())
    )
  );
