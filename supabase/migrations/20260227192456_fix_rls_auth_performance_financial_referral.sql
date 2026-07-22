
-- financial_transactions
DROP POLICY IF EXISTS "Agencies can view own transactions" ON public.financial_transactions;
CREATE POLICY "Agencies can view own transactions"
  ON public.financial_transactions FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all transactions" ON public.financial_transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.financial_transactions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can insert transactions" ON public.financial_transactions;
CREATE POLICY "Admins can insert transactions"
  ON public.financial_transactions FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update transactions" ON public.financial_transactions;
CREATE POLICY "Admins can update transactions"
  ON public.financial_transactions FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- referral_relationships
DROP POLICY IF EXISTS "Users can view own referral relationships" ON public.referral_relationships;
CREATE POLICY "Users can view own referral relationships"
  ON public.referral_relationships FOR SELECT
  TO authenticated
  USING (referrer_user_id = (SELECT auth.uid()) OR referred_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all referral relationships" ON public.referral_relationships;
CREATE POLICY "Admins can view all referral relationships"
  ON public.referral_relationships FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update referral relationships" ON public.referral_relationships;
CREATE POLICY "Admins can update referral relationships"
  ON public.referral_relationships FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Users can create relationship when being referred" ON public.referral_relationships;
CREATE POLICY "Users can create relationship when being referred"
  ON public.referral_relationships FOR INSERT
  TO authenticated
  WITH CHECK (referred_user_id = (SELECT auth.uid()));

-- referral_bonuses
DROP POLICY IF EXISTS "Users can view own bonuses" ON public.referral_bonuses;
CREATE POLICY "Users can view own bonuses"
  ON public.referral_bonuses FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all bonuses" ON public.referral_bonuses;
CREATE POLICY "Admins can view all bonuses"
  ON public.referral_bonuses FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- referral_fraud_logs
DROP POLICY IF EXISTS "Only admins can view fraud logs" ON public.referral_fraud_logs;
CREATE POLICY "Only admins can view fraud logs"
  ON public.referral_fraud_logs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- toursred_cash_wallets
DROP POLICY IF EXISTS "Users can view own wallet" ON public.toursred_cash_wallets;
CREATE POLICY "Users can view own wallet"
  ON public.toursred_cash_wallets FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all wallets" ON public.toursred_cash_wallets;
CREATE POLICY "Admins can view all wallets"
  ON public.toursred_cash_wallets FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can update wallets" ON public.toursred_cash_wallets;
CREATE POLICY "Admins can update wallets"
  ON public.toursred_cash_wallets FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- toursred_cash_transactions
DROP POLICY IF EXISTS "Users can view own transactions" ON public.toursred_cash_transactions;
CREATE POLICY "Users can view own transactions"
  ON public.toursred_cash_transactions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all transactions" ON public.toursred_cash_transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.toursred_cash_transactions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- toursred_points_wallets
DROP POLICY IF EXISTS "Users can view own points wallet" ON public.toursred_points_wallets;
CREATE POLICY "Users can view own points wallet"
  ON public.toursred_points_wallets FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all points wallets" ON public.toursred_points_wallets;
CREATE POLICY "Admins can view all points wallets"
  ON public.toursred_points_wallets FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- toursred_points_transactions
DROP POLICY IF EXISTS "Users can view own points transactions" ON public.toursred_points_transactions;
CREATE POLICY "Users can view own points transactions"
  ON public.toursred_points_transactions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all points transactions" ON public.toursred_points_transactions;
CREATE POLICY "Admins can view all points transactions"
  ON public.toursred_points_transactions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

-- payout_schedules
DROP POLICY IF EXISTS "Agencies can view own schedule" ON public.payout_schedules;
CREATE POLICY "Agencies can view own schedule"
  ON public.payout_schedules FOR SELECT
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can update own schedule" ON public.payout_schedules;
CREATE POLICY "Agencies can update own schedule"
  ON public.payout_schedules FOR UPDATE
  TO authenticated
  USING (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ))
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Agencies can insert own schedule" ON public.payout_schedules;
CREATE POLICY "Agencies can insert own schedule"
  ON public.payout_schedules FOR INSERT
  TO authenticated
  WITH CHECK (agency_id IN (
    SELECT id FROM public.agencies WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can view all schedules" ON public.payout_schedules;
CREATE POLICY "Admins can view all schedules"
  ON public.payout_schedules FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));

DROP POLICY IF EXISTS "Admins can manage all schedules" ON public.payout_schedules;
CREATE POLICY "Admins can manage all schedules"
  ON public.payout_schedules FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin')
  ));
