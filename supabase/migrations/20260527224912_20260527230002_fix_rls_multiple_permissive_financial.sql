-- ============================================================
-- agency_payouts SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all payouts" ON public.agency_payouts;
DROP POLICY IF EXISTS "Agencies can view own payouts" ON public.agency_payouts;
CREATE POLICY "Agencies and admins can view payouts"
  ON public.agency_payouts FOR SELECT
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

-- ============================================================
-- cfdi_invoices SELECT: 4 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all cfdi invoices" ON public.cfdi_invoices;
DROP POLICY IF EXISTS "Agencies can view their own cfdi invoices" ON public.cfdi_invoices;
DROP POLICY IF EXISTS "Travelers can view cfdi for their bookings" ON public.cfdi_invoices;
DROP POLICY IF EXISTS "Travelers can view their membership cfdi invoices" ON public.cfdi_invoices;
CREATE POLICY "Users, agencies and admins can view cfdi invoices"
  ON public.cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    (
      invoice_type = 'booking'
      AND EXISTS (
        SELECT 1 FROM bookings
        WHERE bookings.id = cfdi_invoices.booking_id
          AND bookings.user_id = (SELECT auth.uid())
      )
    )
    OR membership_id IN (
      SELECT memberships.id FROM memberships
      WHERE memberships.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = cfdi_invoices.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- commission_records SELECT: 3 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can read all commission records" ON public.commission_records;
DROP POLICY IF EXISTS "Agencies can read own commission records" ON public.commission_records;
DROP POLICY IF EXISTS "Users can read commission records for their bookings" ON public.commission_records;
CREATE POLICY "Users, agencies and admins can read commission records"
  ON public.commission_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = commission_records.booking_id
        AND bookings.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = commission_records.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- departure_points INSERT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can create departure points" ON public.departure_points;
DROP POLICY IF EXISTS "Agencies can create departure points" ON public.departure_points;
CREATE POLICY "Agencies and admins can create departure points"
  ON public.departure_points FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- destination_images ALL: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all destination images" ON public.destination_images;
DROP POLICY IF EXISTS "Agencies can manage destination images" ON public.destination_images;
CREATE POLICY "Agencies and admins can manage destination images"
  ON public.destination_images FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'agency'])
    )
  );

-- ============================================================
-- discount_code_usage INSERT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert usage records" ON public.discount_code_usage;
DROP POLICY IF EXISTS "System can insert usage records" ON public.discount_code_usage;
CREATE POLICY "Users and admins can insert usage records"
  ON public.discount_code_usage FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- discount_code_usage SELECT: 2 → 1
DROP POLICY IF EXISTS "Admins can view all usage records" ON public.discount_code_usage;
DROP POLICY IF EXISTS "Users can view own usage records" ON public.discount_code_usage;
CREATE POLICY "Users and admins can view usage records"
  ON public.discount_code_usage FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- discount_codes DELETE: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS "Agencies can delete own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies and admins can delete discount codes"
  ON public.discount_codes FOR DELETE
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

-- discount_codes INSERT: 2 → 1
DROP POLICY IF EXISTS "Admins can insert discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS "Agencies can insert own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies and admins can insert discount codes"
  ON public.discount_codes FOR INSERT
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

-- discount_codes SELECT: 3 → 1
DROP POLICY IF EXISTS "Admins can view all discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS "Agencies can view own discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS "Users can view active valid discount codes" ON public.discount_codes;
CREATE POLICY "Users, agencies and admins can view discount codes"
  ON public.discount_codes FOR SELECT
  TO authenticated
  USING (
    (is_active = true AND now() >= valid_from AND now() <= valid_until)
    OR agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- discount_codes UPDATE: 2 → 1
DROP POLICY IF EXISTS "Admins can update discount codes" ON public.discount_codes;
DROP POLICY IF EXISTS "Agencies can update own discount codes" ON public.discount_codes;
CREATE POLICY "Agencies and admins can update discount codes"
  ON public.discount_codes FOR UPDATE
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

-- ============================================================
-- financial_transactions SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Agencies can view own transactions" ON public.financial_transactions;
CREATE POLICY "Agencies and admins can view financial transactions"
  ON public.financial_transactions FOR SELECT
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

-- ============================================================
-- gift_cards SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all gift cards" ON public.gift_cards;
DROP POLICY IF EXISTS "Users can view their redeemed gift cards" ON public.gift_cards;
CREATE POLICY "Users and admins can view gift cards"
  ON public.gift_cards FOR SELECT
  TO authenticated
  USING (
    redeemed_by = (SELECT auth.uid())
    OR purchaser_email = (SELECT auth.email())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- memberships SELECT: 3 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins with manage travelers permission can view all membership" ON public.memberships;
DROP POLICY IF EXISTS "Users can view own membership" ON public.memberships;
CREATE POLICY "Users and admins can view memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
    OR has_manage_travelers_permission()
  );

-- ============================================================
-- payout_schedules SELECT: 2 → 1
-- (payout_schedules ALL ya cubre admins; el conflicto es SELECT+SELECT)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all schedules" ON public.payout_schedules;
DROP POLICY IF EXISTS "Agencies can view own schedule" ON public.payout_schedules;
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

-- ============================================================
-- tour_cancellations SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all tour cancellations" ON public.tour_cancellations;
DROP POLICY IF EXISTS "Agencies can view own tour cancellations" ON public.tour_cancellations;
CREATE POLICY "Agencies and admins can view tour cancellations"
  ON public.tour_cancellations FOR SELECT
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

-- ============================================================
-- tour_promotions SELECT: 2 → 1 (se mantiene la pública separada)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all tour promotions" ON public.tour_promotions;
DROP POLICY IF EXISTS "Agencies can view their own tour promotions" ON public.tour_promotions;
CREATE POLICY "Agencies and admins can view tour promotions"
  ON public.tour_promotions FOR SELECT
  TO authenticated
  USING (
    agency_id = get_current_user_agency_id()
    OR current_user_is_admin()
  );

-- tour_promotions UPDATE: 2 → 1
DROP POLICY IF EXISTS "Admins can update any tour promotion" ON public.tour_promotions;
DROP POLICY IF EXISTS "Agencies can update their own promotions" ON public.tour_promotions;
CREATE POLICY "Agencies and admins can update tour promotions"
  ON public.tour_promotions FOR UPDATE
  TO authenticated
  USING (
    agency_id = get_current_user_agency_id()
    OR current_user_is_admin()
  )
  WITH CHECK (
    agency_id = get_current_user_agency_id()
    OR current_user_is_admin()
  );
