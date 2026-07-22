-- ============================================================
-- messages INSERT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can send messages to any conversation" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users and admins can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      sender_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1 FROM message_participants
        WHERE message_participants.conversation_id = messages.conversation_id
          AND message_participants.user_id = (SELECT auth.uid())
      )
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- messages SELECT: 2 → 1
DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users and admins can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_participants
      WHERE message_participants.conversation_id = messages.conversation_id
        AND message_participants.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- message_participants SELECT: 2 → 1
-- (la política existente ya incluye is_admin_user(), la de admins es redundante)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all message participants" ON public.message_participants;
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON public.message_participants;
CREATE POLICY "Users and admins can view message participants"
  ON public.message_participants FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR is_conversation_participant(conversation_id)
    OR is_admin_user()
  );

-- ============================================================
-- notifications SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users and admins can view notifications"
  ON public.notifications FOR SELECT
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
-- payment_transactions SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Agencies can read their payment transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "Users can read own payment transactions" ON public.payment_transactions;
CREATE POLICY "Users and agencies can read payment transactions"
  ON public.payment_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = payment_transactions.booking_id
        AND bookings.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM bookings b
      JOIN agencies a ON b.agency_id = a.id
      WHERE b.id = payment_transactions.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- referral_bonuses SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all bonuses" ON public.referral_bonuses;
DROP POLICY IF EXISTS "Users can view own bonuses" ON public.referral_bonuses;
CREATE POLICY "Users and admins can view referral bonuses"
  ON public.referral_bonuses FOR SELECT
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
-- referral_codes SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all referral codes" ON public.referral_codes;
DROP POLICY IF EXISTS "Users can view own referral code" ON public.referral_codes;
CREATE POLICY "Users and admins can view referral codes"
  ON public.referral_codes FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- referral_codes UPDATE: 2 → 1
DROP POLICY IF EXISTS "Admins can update referral codes" ON public.referral_codes;
DROP POLICY IF EXISTS "Users can update own referral code" ON public.referral_codes;
CREATE POLICY "Users and admins can update referral codes"
  ON public.referral_codes FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- referral_relationships SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all referral relationships" ON public.referral_relationships;
DROP POLICY IF EXISTS "Users can view own referral relationships" ON public.referral_relationships;
CREATE POLICY "Users and admins can view referral relationships"
  ON public.referral_relationships FOR SELECT
  TO authenticated
  USING (
    referrer_user_id = (SELECT auth.uid())
    OR referred_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- terms_acceptances SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all terms acceptances" ON public.terms_acceptances;
DROP POLICY IF EXISTS "Users can view own terms acceptances" ON public.terms_acceptances;
CREATE POLICY "Users and admins can view terms acceptances"
  ON public.terms_acceptances FOR SELECT
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
-- toursred_cash_transactions SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.toursred_cash_transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.toursred_cash_transactions;
CREATE POLICY "Users and admins can view cash transactions"
  ON public.toursred_cash_transactions FOR SELECT
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
-- toursred_cash_wallets SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all wallets" ON public.toursred_cash_wallets;
DROP POLICY IF EXISTS "Users can view own wallet" ON public.toursred_cash_wallets;
CREATE POLICY "Users and admins can view cash wallets"
  ON public.toursred_cash_wallets FOR SELECT
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
-- toursred_points_transactions SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all points transactions" ON public.toursred_points_transactions;
DROP POLICY IF EXISTS "Users can view own points transactions" ON public.toursred_points_transactions;
CREATE POLICY "Users and admins can view points transactions"
  ON public.toursred_points_transactions FOR SELECT
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
-- toursred_points_wallets SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all points wallets" ON public.toursred_points_wallets;
DROP POLICY IF EXISTS "Users can view own points wallet" ON public.toursred_points_wallets;
CREATE POLICY "Users and admins can view points wallets"
  ON public.toursred_points_wallets FOR SELECT
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
-- users SELECT: 5 políticas → 1
-- ============================================================
DROP POLICY IF EXISTS "Accountant can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admins with permission can view travelers" ON public.users;
DROP POLICY IF EXISTS "Agencies can view travelers with bookings" ON public.users;
DROP POLICY IF EXISTS "Super admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
CREATE POLICY "Users can view own and authorized data"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR is_super_admin()
    OR (
      has_manage_travelers_permission()
      AND role = 'traveler'
    )
    OR EXISTS (
      SELECT 1 FROM agencies a
      WHERE a.user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.user_id = users.id
            AND b.agency_id = a.id
        )
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'accountant'])
    )
  );

-- users UPDATE: 2 → 1
DROP POLICY IF EXISTS "Super admins can update users" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
CREATE POLICY "Users and super admins can update users"
  ON public.users FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR is_super_admin()
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    OR is_super_admin()
  );
