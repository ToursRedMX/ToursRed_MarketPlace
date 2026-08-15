
-- gift_cards
DROP POLICY IF EXISTS "Users can view their redeemed gift cards" ON public.gift_cards;
CREATE POLICY "Users can view their redeemed gift cards"
  ON public.gift_cards FOR SELECT
  TO authenticated
  USING (redeemed_by = (SELECT auth.uid()) OR purchaser_email = (SELECT auth.email()));

DROP POLICY IF EXISTS "Admins can view all gift cards" ON public.gift_cards;
CREATE POLICY "Admins can view all gift cards"
  ON public.gift_cards FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update gift cards" ON public.gift_cards;
CREATE POLICY "Admins can update gift cards"
  ON public.gift_cards FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- gift_card_redemption_attempts
DROP POLICY IF EXISTS "Users can create redemption attempts" ON public.gift_card_redemption_attempts;
CREATE POLICY "Users can create redemption attempts"
  ON public.gift_card_redemption_attempts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all redemption attempts" ON public.gift_card_redemption_attempts;
CREATE POLICY "Admins can view all redemption attempts"
  ON public.gift_card_redemption_attempts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- booking_cancellations
DROP POLICY IF EXISTS "Travelers can view own cancellations" ON public.booking_cancellations;
CREATE POLICY "Travelers can view own cancellations"
  ON public.booking_cancellations FOR SELECT
  TO authenticated
  USING (cancelled_by_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Agencies can view their tour cancellations" ON public.booking_cancellations;
CREATE POLICY "Agencies can view their tour cancellations"
  ON public.booking_cancellations FOR SELECT
  TO authenticated
  USING (booking_id IN (
    SELECT b.id FROM public.bookings b
    JOIN public.tours t ON b.tour_id = t.id
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all cancellations" ON public.booking_cancellations;
CREATE POLICY "Admins can view all cancellations"
  ON public.booking_cancellations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Agencies can cancel their tour bookings" ON public.booking_cancellations;
CREATE POLICY "Agencies can cancel their tour bookings"
  ON public.booking_cancellations FOR INSERT
  TO authenticated
  WITH CHECK (booking_id IN (
    SELECT b.id FROM public.bookings b
    JOIN public.tours t ON b.tour_id = t.id
    JOIN public.agencies a ON t.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

-- booking_reschedule_responses
DROP POLICY IF EXISTS "Users can view own reschedule responses" ON public.booking_reschedule_responses;
CREATE POLICY "Users can view own reschedule responses"
  ON public.booking_reschedule_responses FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Agencies can view responses to their reschedules" ON public.booking_reschedule_responses;
CREATE POLICY "Agencies can view responses to their reschedules"
  ON public.booking_reschedule_responses FOR SELECT
  TO authenticated
  USING (tour_reschedule_id IN (
    SELECT tr.id FROM public.tour_reschedules tr
    JOIN public.agencies a ON tr.agency_id = a.id
    WHERE a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can update own reschedule responses" ON public.booking_reschedule_responses;
CREATE POLICY "Users can update own reschedule responses"
  ON public.booking_reschedule_responses FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- tour_reschedules
DROP POLICY IF EXISTS "Agencies can view own reschedules" ON public.tour_reschedules;
CREATE POLICY "Agencies can view own reschedules"
  ON public.tour_reschedules FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can create reschedules" ON public.tour_reschedules;
CREATE POLICY "Agencies can create reschedules"
  ON public.tour_reschedules FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can update own reschedules" ON public.tour_reschedules;
CREATE POLICY "Agencies can update own reschedules"
  ON public.tour_reschedules FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Travelers can view reschedules affecting their bookings" ON public.tour_reschedules;
CREATE POLICY "Travelers can view reschedules affecting their bookings"
  ON public.tour_reschedules FOR SELECT
  TO authenticated
  USING (id IN (
    SELECT brr.tour_reschedule_id FROM public.booking_reschedule_responses brr
    WHERE brr.user_id = (SELECT auth.uid())
  ));

-- tour_cancellations
DROP POLICY IF EXISTS "Agencies can view own tour cancellations" ON public.tour_cancellations;
CREATE POLICY "Agencies can view own tour cancellations"
  ON public.tour_cancellations FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all tour cancellations" ON public.tour_cancellations;
CREATE POLICY "Admins can view all tour cancellations"
  ON public.tour_cancellations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));
