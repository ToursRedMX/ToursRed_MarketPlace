-- tour_optional_services
DROP POLICY IF EXISTS "Agency can insert optional services for own tours" ON public.tour_optional_services;
CREATE POLICY "Agency can insert optional services for own tours"
  ON public.tour_optional_services FOR INSERT
  TO authenticated
  WITH CHECK (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agency can update optional services for own tours" ON public.tour_optional_services;
CREATE POLICY "Agency can update optional services for own tours"
  ON public.tour_optional_services FOR UPDATE
  TO authenticated
  USING (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agency can delete optional services for own tours" ON public.tour_optional_services;
CREATE POLICY "Agency can delete optional services for own tours"
  ON public.tour_optional_services FOR DELETE
  TO authenticated
  USING (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

-- integration_configs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'integration_configs'
  ) THEN
    DROP POLICY IF EXISTS "Admins can view all integration configs" ON public.integration_configs;
    CREATE POLICY "Admins can view all integration configs"
      ON public.integration_configs FOR SELECT
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ));

    DROP POLICY IF EXISTS "Admins can manage integration configs" ON public.integration_configs;
    CREATE POLICY "Admins can manage integration configs"
      ON public.integration_configs FOR ALL
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ));
  END IF;
END $$;

-- international_tour_inquiries
DROP POLICY IF EXISTS "Admins with permission can view inquiries" ON public.international_tour_inquiries;
CREATE POLICY "Admins with permission can view inquiries"
  ON public.international_tour_inquiries FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    LEFT JOIN public.admin_permissions ap ON ap.user_id = u.id
    WHERE u.id = (SELECT auth.uid())
      AND u.role IN ('admin','super_admin')
      AND (u.role = 'super_admin' OR ap.can_manage_inquiries = true)
  ));

DROP POLICY IF EXISTS "Admins with permission can update inquiries" ON public.international_tour_inquiries;
CREATE POLICY "Admins with permission can update inquiries"
  ON public.international_tour_inquiries FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    LEFT JOIN public.admin_permissions ap ON ap.user_id = u.id
    WHERE u.id = (SELECT auth.uid())
      AND u.role IN ('admin','super_admin')
      AND (u.role = 'super_admin' OR ap.can_manage_inquiries = true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    LEFT JOIN public.admin_permissions ap ON ap.user_id = u.id
    WHERE u.id = (SELECT auth.uid())
      AND u.role IN ('admin','super_admin')
      AND (u.role = 'super_admin' OR ap.can_manage_inquiries = true)
  ));

-- admin_permissions
DROP POLICY IF EXISTS "Super admins can manage all permissions" ON public.admin_permissions;
CREATE POLICY "Super admins can manage all permissions"
  ON public.admin_permissions FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role = 'super_admin'
  ));

DROP POLICY IF EXISTS "Admins can read own permissions" ON public.admin_permissions;
CREATE POLICY "Admins can read own permissions"
  ON public.admin_permissions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- referral_codes
DROP POLICY IF EXISTS "Users can view own referral code" ON public.referral_codes;
CREATE POLICY "Users can view own referral code"
  ON public.referral_codes FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own referral code" ON public.referral_codes;
CREATE POLICY "Users can update own referral code"
  ON public.referral_codes FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all referral codes" ON public.referral_codes;
CREATE POLICY "Admins can view all referral codes"
  ON public.referral_codes FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update referral codes" ON public.referral_codes;
CREATE POLICY "Admins can update referral codes"
  ON public.referral_codes FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- memberships
DROP POLICY IF EXISTS "Users can view own membership" ON public.memberships;
CREATE POLICY "Users can view own membership"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own exemption usage" ON public.memberships;
CREATE POLICY "Users can update own exemption usage"
  ON public.memberships FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all memberships" ON public.memberships;
CREATE POLICY "Admins can view all memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- messages
DROP POLICY IF EXISTS "Admins can send messages to any conversation" ON public.messages;
CREATE POLICY "Admins can send messages to any conversation"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- discount_codes
DROP POLICY IF EXISTS "Admins can view all discount codes" ON public.discount_codes;
CREATE POLICY "Admins can view all discount codes"
  ON public.discount_codes FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can insert discount codes" ON public.discount_codes;
CREATE POLICY "Admins can insert discount codes"
  ON public.discount_codes FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update discount codes" ON public.discount_codes;
CREATE POLICY "Admins can update discount codes"
  ON public.discount_codes FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can delete discount codes" ON public.discount_codes;
CREATE POLICY "Admins can delete discount codes"
  ON public.discount_codes FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Agencies can view own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies can view own discount codes"
  ON public.discount_codes FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can insert own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies can insert own discount codes"
  ON public.discount_codes FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can update own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies can update own discount codes"
  ON public.discount_codes FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can delete own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies can delete own discount codes"
  ON public.discount_codes FOR DELETE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

-- discount_code_usage
DROP POLICY IF EXISTS "Admins can view all usage records" ON public.discount_code_usage;
CREATE POLICY "Admins can view all usage records"
  ON public.discount_code_usage FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Users can view own usage records" ON public.discount_code_usage;
CREATE POLICY "Users can view own usage records"
  ON public.discount_code_usage FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "System can insert usage records" ON public.discount_code_usage;
CREATE POLICY "System can insert usage records"
  ON public.discount_code_usage FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can insert usage records" ON public.discount_code_usage;
CREATE POLICY "Admins can insert usage records"
  ON public.discount_code_usage FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- conversations
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (id IN (
    SELECT conversation_id FROM public.message_participants
    WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Participants can update conversation" ON public.conversations;
CREATE POLICY "Participants can update conversation"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (id IN (
    SELECT conversation_id FROM public.message_participants
    WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (id IN (
    SELECT conversation_id FROM public.message_participants
    WHERE user_id = (SELECT auth.uid())
  ));

-- message_participants
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON public.message_participants;
CREATE POLICY "Users can view participants in their conversations"
  ON public.message_participants FOR SELECT
  TO authenticated
  USING (conversation_id IN (
    SELECT conversation_id FROM public.message_participants mp2
    WHERE mp2.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can add participants to their conversations" ON public.message_participants;
CREATE POLICY "Users can add participants to their conversations"
  ON public.message_participants FOR INSERT
  TO authenticated
  WITH CHECK (conversation_id IN (
    SELECT conversation_id FROM public.message_participants mp2
    WHERE mp2.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can update their own participation status" ON public.message_participants;
CREATE POLICY "Users can update their own participation status"
  ON public.message_participants FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- cookie_consents
DROP POLICY IF EXISTS "Admins can view all consents" ON public.cookie_consents;
CREATE POLICY "Admins can view all consents"
  ON public.cookie_consents FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- commission_records
DROP POLICY IF EXISTS "Admins can read all commission records" ON public.commission_records;
CREATE POLICY "Admins can read all commission records"
  ON public.commission_records FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- agency_payouts
DROP POLICY IF EXISTS "Agencies can view own payouts" ON public.agency_payouts;
CREATE POLICY "Agencies can view own payouts"
  ON public.agency_payouts FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all payouts" ON public.agency_payouts;
CREATE POLICY "Admins can view all payouts"
  ON public.agency_payouts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can insert payouts" ON public.agency_payouts;
CREATE POLICY "Admins can insert payouts"
  ON public.agency_payouts FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update payouts" ON public.agency_payouts;
CREATE POLICY "Admins can update payouts"
  ON public.agency_payouts FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- payout_batches
DROP POLICY IF EXISTS "Admins can view all batches" ON public.payout_batches;
CREATE POLICY "Admins can view all batches"
  ON public.payout_batches FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can insert batches" ON public.payout_batches;
CREATE POLICY "Admins can insert batches"
  ON public.payout_batches FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update batches" ON public.payout_batches;
CREATE POLICY "Admins can update batches"
  ON public.payout_batches FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can delete batches" ON public.payout_batches;
CREATE POLICY "Admins can delete batches"
  ON public.payout_batches FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- batch_payouts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'batch_payouts'
  ) THEN
    DROP POLICY IF EXISTS "Admins can view all batch payouts" ON public.batch_payouts;
    CREATE POLICY "Admins can view all batch payouts"
      ON public.batch_payouts FOR SELECT
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ));

    DROP POLICY IF EXISTS "Admins can manage batch payouts" ON public.batch_payouts;
    CREATE POLICY "Admins can manage batch payouts"
      ON public.batch_payouts FOR ALL
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
      ));
  END IF;
END $$;

-- booking_optional_services
DROP POLICY IF EXISTS "Traveler can view own booking optional services" ON public.booking_optional_services;
CREATE POLICY "Traveler can view own booking optional services"
  ON public.booking_optional_services FOR SELECT
  TO authenticated
  USING (booking_id IN (
    SELECT id FROM public.bookings WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agency can view optional services for own tour bookings" ON public.booking_optional_services;
CREATE POLICY "Agency can view optional services for own tour bookings"
  ON public.booking_optional_services FOR SELECT
  TO authenticated
  USING (booking_id IN (
    SELECT b.id FROM public.bookings b
    JOIN public.tours t ON b.tour_id = t.id
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Traveler can insert optional services on own bookings" ON public.booking_optional_services;
CREATE POLICY "Traveler can insert optional services on own bookings"
  ON public.booking_optional_services FOR INSERT
  TO authenticated
  WITH CHECK (booking_id IN (
    SELECT id FROM public.bookings WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admin can view all booking optional services" ON public.booking_optional_services;
CREATE POLICY "Admin can view all booking optional services"
  ON public.booking_optional_services FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admin can update booking optional services" ON public.booking_optional_services;
CREATE POLICY "Admin can update booking optional services"
  ON public.booking_optional_services FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- departure_points
DROP POLICY IF EXISTS "Agencies can create departure points" ON public.departure_points;
CREATE POLICY "Agencies can create departure points"
  ON public.departure_points FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all departure points" ON public.departure_points;
CREATE POLICY "Admins can view all departure points"
  ON public.departure_points FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can create departure points" ON public.departure_points;
CREATE POLICY "Admins can create departure points"
  ON public.departure_points FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update departure points" ON public.departure_points;
CREATE POLICY "Admins can update departure points"
  ON public.departure_points FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can delete departure points" ON public.departure_points;
CREATE POLICY "Admins can delete departure points"
  ON public.departure_points FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- tour_departure_points
DROP POLICY IF EXISTS "Agencies can add departure points to their tours" ON public.tour_departure_points;
CREATE POLICY "Agencies can add departure points to their tours"
  ON public.tour_departure_points FOR INSERT
  TO authenticated
  WITH CHECK (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can update their tour departure points" ON public.tour_departure_points;
CREATE POLICY "Agencies can update their tour departure points"
  ON public.tour_departure_points FOR UPDATE
  TO authenticated
  USING (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can delete their tour departure points" ON public.tour_departure_points;
CREATE POLICY "Agencies can delete their tour departure points"
  ON public.tour_departure_points FOR DELETE
  TO authenticated
  USING (tour_id IN (
    SELECT t.id FROM public.tours t
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can manage all tour departure points" ON public.tour_departure_points;
CREATE POLICY "Admins can manage all tour departure points"
  ON public.tour_departure_points FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- tour_categories
DROP POLICY IF EXISTS "Admins can view all categories" ON public.tour_categories;
CREATE POLICY "Admins can view all categories"
  ON public.tour_categories FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can create categories" ON public.tour_categories;
CREATE POLICY "Admins can create categories"
  ON public.tour_categories FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update categories" ON public.tour_categories;
CREATE POLICY "Admins can update categories"
  ON public.tour_categories FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can delete categories" ON public.tour_categories;
CREATE POLICY "Admins can delete categories"
  ON public.tour_categories FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));
