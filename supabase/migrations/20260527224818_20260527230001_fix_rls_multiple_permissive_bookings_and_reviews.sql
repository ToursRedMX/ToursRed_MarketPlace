-- ============================================================
-- bookings SELECT: 4 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can read all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins with manage travelers permission can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Agencies can read own tour bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can read own bookings" ON public.bookings;
CREATE POLICY "Users, agencies and admins can read bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR is_admin()
    OR has_manage_travelers_permission()
  );

-- bookings UPDATE: 2 políticas → 1
DROP POLICY IF EXISTS "Agencies can update own tour bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update own bookings" ON public.bookings;
CREATE POLICY "Users and agencies can update own bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- booking_cancellations SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all cancellations" ON public.booking_cancellations;
DROP POLICY IF EXISTS "Agencies can view their tour cancellations" ON public.booking_cancellations;
DROP POLICY IF EXISTS "Travelers can view own cancellations" ON public.booking_cancellations;
CREATE POLICY "Users, agencies and admins can view cancellations"
  ON public.booking_cancellations FOR SELECT
  TO authenticated
  USING (
    cancelled_by_user_id = (SELECT auth.uid())
    OR booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON b.tour_id = t.id
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
-- booking_checkin_tokens SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all checkin tokens" ON public.booking_checkin_tokens;
DROP POLICY IF EXISTS "Agency can view checkin tokens for their bookings" ON public.booking_checkin_tokens;
DROP POLICY IF EXISTS "Traveler can view own checkin token" ON public.booking_checkin_tokens;
CREATE POLICY "Users, agencies and admins can view checkin tokens"
  ON public.booking_checkin_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_checkin_tokens.booking_id
        AND b.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM bookings b
      JOIN agencies a ON a.id = b.agency_id
      WHERE b.id = booking_checkin_tokens.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- booking_optional_services SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admin can view all booking optional services" ON public.booking_optional_services;
DROP POLICY IF EXISTS "Agency can view optional services for own tour bookings" ON public.booking_optional_services;
DROP POLICY IF EXISTS "Traveler can view own booking optional services" ON public.booking_optional_services;
CREATE POLICY "Users, agencies and admins can view booking optional services"
  ON public.booking_optional_services FOR SELECT
  TO authenticated
  USING (
    booking_id IN (
      SELECT bookings.id FROM bookings
      WHERE bookings.user_id = (SELECT auth.uid())
    )
    OR booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON b.tour_id = t.id
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
-- booking_partial_cancellations SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all partial cancellations" ON public.booking_partial_cancellations;
DROP POLICY IF EXISTS "Agencies can view their tour partial cancellations" ON public.booking_partial_cancellations;
DROP POLICY IF EXISTS "Travelers can view own partial cancellations" ON public.booking_partial_cancellations;
CREATE POLICY "Users, agencies and admins can view partial cancellations"
  ON public.booking_partial_cancellations FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = cancelled_by_user_id
    OR EXISTS (
      SELECT 1 FROM bookings b
      JOIN tours t ON b.tour_id = t.id
      JOIN agencies a ON t.agency_id = a.id
      WHERE b.id = booking_partial_cancellations.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

-- ============================================================
-- booking_reschedule_responses SELECT: 2 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Agencies can view responses to their reschedules" ON public.booking_reschedule_responses;
DROP POLICY IF EXISTS "Users can view own reschedule responses" ON public.booking_reschedule_responses;
CREATE POLICY "Users and agencies can view reschedule responses"
  ON public.booking_reschedule_responses FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR tour_reschedule_id IN (
      SELECT tr.id FROM tour_reschedules tr
      JOIN agencies a ON tr.agency_id = a.id
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- booking_travelers SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all booking travelers" ON public.booking_travelers;
DROP POLICY IF EXISTS "Agencies can view their bookings travelers" ON public.booking_travelers;
DROP POLICY IF EXISTS "Travelers can view own booking travelers" ON public.booking_travelers;
CREATE POLICY "Users, agencies and admins can view booking travelers"
  ON public.booking_travelers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_travelers.booking_id
        AND bookings.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM bookings b
      JOIN agencies a ON b.agency_id = a.id
      WHERE b.id = booking_travelers.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- cancellation_penalty_records SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all cancellation penalties" ON public.cancellation_penalty_records;
DROP POLICY IF EXISTS "Agencies can view own cancellation penalties" ON public.cancellation_penalty_records;
DROP POLICY IF EXISTS "Travelers can view penalties for own bookings" ON public.cancellation_penalty_records;
CREATE POLICY "Users, agencies and admins can view cancellation penalties"
  ON public.cancellation_penalty_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = cancellation_penalty_records.booking_id
        AND bookings.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = cancellation_penalty_records.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- agencies UPDATE: 2 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can update agency commission" ON public.agencies;
DROP POLICY IF EXISTS "Agencies can update own profile" ON public.agencies;
CREATE POLICY "Agencies and admins can update agencies"
  ON public.agencies FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- agency_reviews SELECT: 2 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all agency reviews" ON public.agency_reviews;
DROP POLICY IF EXISTS "Authenticated users can view visible agency reviews" ON public.agency_reviews;
CREATE POLICY "Users and admins can view agency reviews"
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

-- agency_reviews UPDATE: 2 políticas → 1
DROP POLICY IF EXISTS "Admins can update any agency review" ON public.agency_reviews;
DROP POLICY IF EXISTS "Travelers can update their own agency reviews" ON public.agency_reviews;
CREATE POLICY "Travelers and admins can update agency reviews"
  ON public.agency_reviews FOR UPDATE
  TO authenticated
  USING (
    traveler_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    traveler_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- agency_reviews DELETE: 2 políticas → 1
DROP POLICY IF EXISTS "Admins can delete any agency review" ON public.agency_reviews;
DROP POLICY IF EXISTS "Travelers can delete their own agency reviews" ON public.agency_reviews;
CREATE POLICY "Travelers and admins can delete agency reviews"
  ON public.agency_reviews FOR DELETE
  TO authenticated
  USING (
    traveler_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- traveler_reviews SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all traveler reviews" ON public.traveler_reviews;
DROP POLICY IF EXISTS "Agencies can view reviews of their customers" ON public.traveler_reviews;
DROP POLICY IF EXISTS "Travelers can view their own reviews" ON public.traveler_reviews;
CREATE POLICY "Users, agencies and admins can view traveler reviews"
  ON public.traveler_reviews FOR SELECT
  TO authenticated
  USING (
    traveler_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = traveler_reviews.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- traveler_reviews UPDATE: 2 políticas → 1
DROP POLICY IF EXISTS "Admins can update any traveler review" ON public.traveler_reviews;
DROP POLICY IF EXISTS "Agencies can update their own traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Agencies and admins can update traveler reviews"
  ON public.traveler_reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = traveler_reviews.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = traveler_reviews.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- traveler_reviews DELETE: 2 políticas → 1
DROP POLICY IF EXISTS "Admins can delete any traveler review" ON public.traveler_reviews;
DROP POLICY IF EXISTS "Agencies can delete their own traveler reviews" ON public.traveler_reviews;
CREATE POLICY "Agencies and admins can delete traveler reviews"
  ON public.traveler_reviews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = traveler_reviews.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- reviews UPDATE: 2 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can update any review" ON public.reviews;
DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
CREATE POLICY "Users and admins can update reviews"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- slot_reschedule_requests SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all slot reschedule requests" ON public.slot_reschedule_requests;
DROP POLICY IF EXISTS "Agencies can view own slot reschedule requests" ON public.slot_reschedule_requests;
DROP POLICY IF EXISTS "Travelers can view slot reschedule requests affecting their boo" ON public.slot_reschedule_requests;
CREATE POLICY "Users, agencies and admins can view slot reschedule requests"
  ON public.slot_reschedule_requests FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR id IN (
      SELECT request_id FROM get_traveler_reschedule_request_ids((SELECT auth.uid()))
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- slot_reschedule_responses SELECT: 3 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all slot reschedule responses" ON public.slot_reschedule_responses;
DROP POLICY IF EXISTS "Agencies can view responses to their requests" ON public.slot_reschedule_responses;
DROP POLICY IF EXISTS "Travelers can view their own responses" ON public.slot_reschedule_responses;
CREATE POLICY "Users, agencies and admins can view slot reschedule responses"
  ON public.slot_reschedule_responses FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR request_id IN (
      SELECT request_id FROM get_agency_request_ids((SELECT auth.uid()))
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- slot_seat_status: solo si la tabla existe
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'slot_seat_status'
  ) THEN
    DROP POLICY IF EXISTS "Agencies can insert seat status for their tours" ON public.slot_seat_status;
    DROP POLICY IF EXISTS "Travelers can insert seat status for their own bookings" ON public.slot_seat_status;
    CREATE POLICY "Users and agencies can insert seat status"
      ON public.slot_seat_status FOR INSERT
      TO authenticated
      WITH CHECK (
        (
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
        OR (
          booking_id IS NOT NULL
          AND booking_id IN (
            SELECT bookings.id FROM bookings
            WHERE bookings.user_id = (SELECT auth.uid())
          )
        )
      );

    DROP POLICY IF EXISTS "Agencies can update seat status for their tours" ON public.slot_seat_status;
    DROP POLICY IF EXISTS "Travelers can update seat status for their own bookings" ON public.slot_seat_status;
    CREATE POLICY "Users and agencies can update seat status"
      ON public.slot_seat_status FOR UPDATE
      TO authenticated
      USING (
        (
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
        OR (
          booking_id IS NOT NULL
          AND booking_id IN (
            SELECT bookings.id FROM bookings
            WHERE bookings.user_id = (SELECT auth.uid())
          )
        )
      )
      WITH CHECK (
        (
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
        OR (
          booking_id IS NOT NULL
          AND booking_id IN (
            SELECT bookings.id FROM bookings
            WHERE bookings.user_id = (SELECT auth.uid())
          )
        )
      );
  END IF;
END $$;
