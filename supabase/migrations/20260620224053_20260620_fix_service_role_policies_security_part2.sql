-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260620224053
--   name:    20260620_fix_service_role_policies_security_part2
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- Fix security warnings: service_role policies part 2

-- featured_tour_slots
DROP POLICY IF EXISTS "service_role_all_slots" ON public.featured_tour_slots
;


CREATE POLICY "service_role_all_slots" ON public.featured_tour_slots
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- featured_tour_stats
DROP POLICY IF EXISTS "service_role_all_stats" ON public.featured_tour_stats
;


CREATE POLICY "service_role_all_stats" ON public.featured_tour_stats
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- featured_tour_waitlist
DROP POLICY IF EXISTS "service_role_all_waitlist" ON public.featured_tour_waitlist
;


CREATE POLICY "service_role_all_waitlist" ON public.featured_tour_waitlist
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- financial_transactions
DROP POLICY IF EXISTS "Service role can insert transactions" ON public.financial_transactions
;


CREATE POLICY "Service role can insert transactions" ON public.financial_transactions
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- gift_card_redemption_attempts
DROP POLICY IF EXISTS "Service role has full access to redemption attempts" ON public.gift_card_redemption_attempts
;


CREATE POLICY "Service role has full access to redemption attempts" ON public.gift_card_redemption_attempts
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- gift_cards
DROP POLICY IF EXISTS "Service role has full access to gift cards" ON public.gift_cards
;


CREATE POLICY "Service role has full access to gift cards" ON public.gift_cards
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- memberships
DROP POLICY IF EXISTS "Service role can insert memberships" ON public.memberships
;


CREATE POLICY "Service role can insert memberships" ON public.memberships
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update memberships" ON public.memberships
;


CREATE POLICY "Service role can update memberships" ON public.memberships
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- referral_relationships
DROP POLICY IF EXISTS "Service role can insert referral relationships" ON public.referral_relationships
;


CREATE POLICY "Service role can insert referral relationships" ON public.referral_relationships
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- slot_reschedule_requests
DROP POLICY IF EXISTS "Service role can manage slot reschedule requests" ON public.slot_reschedule_requests
;


CREATE POLICY "Service role can manage slot reschedule requests" ON public.slot_reschedule_requests
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- slot_reschedule_responses
DROP POLICY IF EXISTS "Service role can manage slot reschedule responses" ON public.slot_reschedule_responses
;


CREATE POLICY "Service role can manage slot reschedule responses" ON public.slot_reschedule_responses
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- support_ticket_attachments
DROP POLICY IF EXISTS "Service role can insert ticket attachments" ON public.support_ticket_attachments
;


CREATE POLICY "Service role can insert ticket attachments" ON public.support_ticket_attachments
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- support_ticket_history
DROP POLICY IF EXISTS "Service role can insert ticket history" ON public.support_ticket_history
;


CREATE POLICY "Service role can insert ticket history" ON public.support_ticket_history
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- support_tickets
DROP POLICY IF EXISTS "Service role can insert support tickets" ON public.support_tickets
;


CREATE POLICY "Service role can insert support tickets" ON public.support_tickets
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- terms_acceptances
DROP POLICY IF EXISTS "Service role can insert terms acceptances" ON public.terms_acceptances
;


CREATE POLICY "Service role can insert terms acceptances" ON public.terms_acceptances
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- terms_versions
DROP POLICY IF EXISTS "Service role can manage terms versions" ON public.terms_versions
;


CREATE POLICY "Service role can manage terms versions" ON public.terms_versions
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update terms versions" ON public.terms_versions
;


CREATE POLICY "Service role can update terms versions" ON public.terms_versions
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- tour_cancellations
DROP POLICY IF EXISTS "Service role can insert tour cancellations" ON public.tour_cancellations
;


CREATE POLICY "Service role can insert tour cancellations" ON public.tour_cancellations
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update tour cancellations" ON public.tour_cancellations
;


CREATE POLICY "Service role can update tour cancellations" ON public.tour_cancellations
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- toursred_cash_transactions
DROP POLICY IF EXISTS "Service role can insert transactions" ON public.toursred_cash_transactions
;


CREATE POLICY "Service role can insert transactions" ON public.toursred_cash_transactions
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- toursred_cash_wallets
DROP POLICY IF EXISTS "Service role can insert wallets" ON public.toursred_cash_wallets
;


CREATE POLICY "Service role can insert wallets" ON public.toursred_cash_wallets
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- toursred_points_transactions
DROP POLICY IF EXISTS "Service role can manage transactions" ON public.toursred_points_transactions
;


CREATE POLICY "Service role can manage transactions" ON public.toursred_points_transactions
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- toursred_points_wallets
DROP POLICY IF EXISTS "Service role can manage wallets" ON public.toursred_points_wallets
;


CREATE POLICY "Service role can manage wallets" ON public.toursred_points_wallets
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- user_sessions
DROP POLICY IF EXISTS "service_role_all_user_sessions" ON public.user_sessions
;


CREATE POLICY "service_role_all_user_sessions" ON public.user_sessions
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- webhook_logs
DROP POLICY IF EXISTS "Service role can insert webhook logs" ON public.webhook_logs
;


CREATE POLICY "Service role can insert webhook logs" ON public.webhook_logs
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- zoho_oauth_tokens
DROP POLICY IF EXISTS "Service role can delete zoho tokens" ON public.zoho_oauth_tokens
;


CREATE POLICY "Service role can delete zoho tokens" ON public.zoho_oauth_tokens
  FOR DELETE TO service_role
  USING (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can insert zoho tokens" ON public.zoho_oauth_tokens
;


CREATE POLICY "Service role can insert zoho tokens" ON public.zoho_oauth_tokens
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can manage zoho tokens" ON public.zoho_oauth_tokens
;


CREATE POLICY "Service role can manage zoho tokens" ON public.zoho_oauth_tokens
  FOR SELECT TO service_role
  USING (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update zoho tokens" ON public.zoho_oauth_tokens
;


CREATE POLICY "Service role can update zoho tokens" ON public.zoho_oauth_tokens
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



;
