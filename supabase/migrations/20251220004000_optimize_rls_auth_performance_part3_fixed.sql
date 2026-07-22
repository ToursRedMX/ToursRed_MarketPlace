-- ============================================================================
-- DESTINATIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Agencies can manage destinations" ON public.destinations;
CREATE POLICY "Agencies can manage destinations"
  ON public.destinations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'agency'
    )
  );

DROP POLICY IF EXISTS "Admins can insert destinations" ON public.destinations;
CREATE POLICY "Admins can insert destinations"
  ON public.destinations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update destinations" ON public.destinations;
CREATE POLICY "Admins can update destinations"
  ON public.destinations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete destinations" ON public.destinations;
CREATE POLICY "Admins can delete destinations"
  ON public.destinations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- DESTINATION IMAGES TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Agencies can manage destination images" ON public.destination_images;
CREATE POLICY "Agencies can manage destination images"
  ON public.destination_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'agency'
    )
  );

DROP POLICY IF EXISTS "Admins can insert destination images" ON public.destination_images;
CREATE POLICY "Admins can insert destination images"
  ON public.destination_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can manage all destination images" ON public.destination_images;
CREATE POLICY "Admins can manage all destination images"
  ON public.destination_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- TOUR DESTINATIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Agencies can manage tour destinations" ON public.tour_destinations;
CREATE POLICY "Agencies can manage tour destinations"
  ON public.tour_destinations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tours t
      JOIN public.agencies a ON t.agency_id = a.id
      WHERE t.id = tour_destinations.tour_id
      AND a.user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- COMMISSION RECORDS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Agencies can read own commission records" ON public.commission_records;
CREATE POLICY "Agencies can read own commission records"
  ON public.commission_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = commission_records.agency_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can read commission records for their bookings" ON public.commission_records;
CREATE POLICY "Users can read commission records for their bookings"
  ON public.commission_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = commission_records.booking_id
      AND user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- PAYMENT TRANSACTIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can read own payment transactions" ON public.payment_transactions;
CREATE POLICY "Users can read own payment transactions"
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = payment_transactions.booking_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agencies can read their payment transactions" ON public.payment_transactions;
CREATE POLICY "Agencies can read their payment transactions"
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.agencies a ON b.agency_id = a.id
      WHERE b.id = payment_transactions.booking_id
      AND a.user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- NOTIFICATIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can view all notifications" ON public.notifications;
CREATE POLICY "Admins can view all notifications"
  ON public.notifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- EMAIL SETTINGS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Admins can read email settings" ON public.email_settings;
CREATE POLICY "Admins can read email settings"
  ON public.email_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update email settings" ON public.email_settings;
CREATE POLICY "Admins can update email settings"
  ON public.email_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- PLATFORM SETTINGS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Only admins can update platform settings" ON public.platform_settings;
CREATE POLICY "Only admins can update platform settings"
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- NEWSLETTER SUBSCRIPTIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can view all subscriptions"
  ON public.newsletter_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can update subscriptions"
  ON public.newsletter_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- STRIPE CUSTOMERS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own customer data" ON public.stripe_customers;
CREATE POLICY "Users can view their own customer data"
  ON public.stripe_customers
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- STRIPE ORDERS TABLE POLICIES
-- Note: stripe_orders uses customer_id, not user_id
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own order data" ON public.stripe_orders;
CREATE POLICY "Users can view their own order data"
  ON public.stripe_orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM public.stripe_customers
      WHERE user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- STRIPE SUBSCRIPTIONS TABLE POLICIES
-- Note: stripe_subscriptions uses customer_id, not user_id
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own subscription data" ON public.stripe_subscriptions;
CREATE POLICY "Users can view their own subscription data"
  ON public.stripe_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM public.stripe_customers
      WHERE user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- SAVED TOURS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own saved tours" ON public.saved_tours;
CREATE POLICY "Users can view own saved tours"
  ON public.saved_tours
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can save tours" ON public.saved_tours;
CREATE POLICY "Users can save tours"
  ON public.saved_tours
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete own saved tours" ON public.saved_tours;
CREATE POLICY "Users can delete own saved tours"
  ON public.saved_tours
  FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- FREQUENT COMPANIONS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own frequent companions" ON public.frequent_companions;
CREATE POLICY "Users can view own frequent companions"
  ON public.frequent_companions
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can insert own frequent companions" ON public.frequent_companions;
CREATE POLICY "Users can insert own frequent companions"
  ON public.frequent_companions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own frequent companions" ON public.frequent_companions;
CREATE POLICY "Users can update own frequent companions"
  ON public.frequent_companions
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete own frequent companions" ON public.frequent_companions;
CREATE POLICY "Users can delete own frequent companions"
  ON public.frequent_companions
  FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================================
-- BOOKING TRAVELERS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Travelers can view own booking travelers" ON public.booking_travelers;
CREATE POLICY "Travelers can view own booking travelers"
  ON public.booking_travelers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = booking_travelers.booking_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agencies can view their bookings travelers" ON public.booking_travelers;
CREATE POLICY "Agencies can view their bookings travelers"
  ON public.booking_travelers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.agencies a ON b.agency_id = a.id
      WHERE b.id = booking_travelers.booking_id
      AND a.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can view all booking travelers" ON public.booking_travelers;
CREATE POLICY "Admins can view all booking travelers"
  ON public.booking_travelers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Travelers can insert own booking travelers" ON public.booking_travelers;
CREATE POLICY "Travelers can insert own booking travelers"
  ON public.booking_travelers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = booking_travelers.booking_id
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Travelers can update own booking travelers" ON public.booking_travelers;
CREATE POLICY "Travelers can update own booking travelers"
  ON public.booking_travelers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = booking_travelers.booking_id
      AND user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = booking_travelers.booking_id
      AND user_id = (select auth.uid())
    )
  );
