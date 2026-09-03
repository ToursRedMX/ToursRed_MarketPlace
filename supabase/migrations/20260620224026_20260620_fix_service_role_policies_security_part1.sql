-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260620224026
--   name:    20260620_fix_service_role_policies_security_part1
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

-- Fix security warnings: service_role policies with unconditional 'true'
-- Replace with explicit auth.role() = 'service_role' check to satisfy Supabase security linter.
-- These policies are already scoped to the service_role role, so behavior is identical.

-- accounting_access_invitations
DROP POLICY IF EXISTS "Service role full access accounting invitations" ON public.accounting_access_invitations
;


CREATE POLICY "Service role full access accounting invitations" ON public.accounting_access_invitations
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- accounting_account_mapping
DROP POLICY IF EXISTS "Service role can manage account mappings" ON public.accounting_account_mapping
;


CREATE POLICY "Service role can manage account mappings" ON public.accounting_account_mapping
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- accounting_entries
DROP POLICY IF EXISTS "Service role full access accounting entries" ON public.accounting_entries
;


CREATE POLICY "Service role full access accounting entries" ON public.accounting_entries
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- accounting_entry_lines
DROP POLICY IF EXISTS "Service role full access entry lines" ON public.accounting_entry_lines
;


CREATE POLICY "Service role full access entry lines" ON public.accounting_entry_lines
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- accounting_sync_log
DROP POLICY IF EXISTS "Service role can insert accounting sync log" ON public.accounting_sync_log
;


CREATE POLICY "Service role can insert accounting sync log" ON public.accounting_sync_log
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update accounting sync log" ON public.accounting_sync_log
;


CREATE POLICY "Service role can update accounting sync log" ON public.accounting_sync_log
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- agency_tour_message_recipients
DROP POLICY IF EXISTS "Service role can insert message recipients" ON public.agency_tour_message_recipients
;


CREATE POLICY "Service role can insert message recipients" ON public.agency_tour_message_recipients
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- agency_tour_messages
DROP POLICY IF EXISTS "Service role can insert tour messages" ON public.agency_tour_messages
;


CREATE POLICY "Service role can insert tour messages" ON public.agency_tour_messages
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update tour messages" ON public.agency_tour_messages
;


CREATE POLICY "Service role can update tour messages" ON public.agency_tour_messages
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_cancellations
DROP POLICY IF EXISTS "Service role can insert cancellations" ON public.booking_cancellations
;


CREATE POLICY "Service role can insert cancellations" ON public.booking_cancellations
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_optional_services
DROP POLICY IF EXISTS "Service role can manage booking optional services" ON public.booking_optional_services
;


CREATE POLICY "Service role can manage booking optional services" ON public.booking_optional_services
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_payment_plan_installments
DROP POLICY IF EXISTS "service_role_installment" ON public.booking_payment_plan_installments
;


CREATE POLICY "service_role_installment" ON public.booking_payment_plan_installments
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_payment_plan_transaction_allocations
DROP POLICY IF EXISTS "service_role_alloc" ON public.booking_payment_plan_transaction_allocations
;


CREATE POLICY "service_role_alloc" ON public.booking_payment_plan_transaction_allocations
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_payment_plan_transactions
DROP POLICY IF EXISTS "service_role_ppt" ON public.booking_payment_plan_transactions
;


CREATE POLICY "service_role_ppt" ON public.booking_payment_plan_transactions
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_payment_plans
DROP POLICY IF EXISTS "service_role_payment_plan" ON public.booking_payment_plans
;


CREATE POLICY "service_role_payment_plan" ON public.booking_payment_plans
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_reschedule_responses
DROP POLICY IF EXISTS "Service role can insert responses" ON public.booking_reschedule_responses
;


CREATE POLICY "Service role can insert responses" ON public.booking_reschedule_responses
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update all responses" ON public.booking_reschedule_responses
;


CREATE POLICY "Service role can update all responses" ON public.booking_reschedule_responses
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- booking_supplements
DROP POLICY IF EXISTS "Service role can manage booking supplements" ON public.booking_supplements
;


CREATE POLICY "Service role can manage booking supplements" ON public.booking_supplements
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- bookings
DROP POLICY IF EXISTS "Service role can update bookings for webhooks" ON public.bookings
;


CREATE POLICY "Service role can update bookings for webhooks" ON public.bookings
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- cancellation_penalty_records
DROP POLICY IF EXISTS "Service role can insert cancellation penalties" ON public.cancellation_penalty_records
;


CREATE POLICY "Service role can insert cancellation penalties" ON public.cancellation_penalty_records
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update cancellation penalties" ON public.cancellation_penalty_records
;


CREATE POLICY "Service role can update cancellation penalties" ON public.cancellation_penalty_records
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- cfdi_cancellation_requests
DROP POLICY IF EXISTS "Service role can insert cfdi cancellations" ON public.cfdi_cancellation_requests
;


CREATE POLICY "Service role can insert cfdi cancellations" ON public.cfdi_cancellation_requests
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update cfdi cancellations" ON public.cfdi_cancellation_requests
;


CREATE POLICY "Service role can update cfdi cancellations" ON public.cfdi_cancellation_requests
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- cfdi_invoices
DROP POLICY IF EXISTS "Service role can insert cfdi invoices" ON public.cfdi_invoices
;


CREATE POLICY "Service role can insert cfdi invoices" ON public.cfdi_invoices
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role')
;



DROP POLICY IF EXISTS "Service role can update cfdi invoices" ON public.cfdi_invoices
;


CREATE POLICY "Service role can update cfdi invoices" ON public.cfdi_invoices
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- chart_of_accounts
DROP POLICY IF EXISTS "Service role full access chart of accounts" ON public.chart_of_accounts
;


CREATE POLICY "Service role full access chart of accounts" ON public.chart_of_accounts
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



-- failed_login_attempts
DROP POLICY IF EXISTS "service_role_all_failed_logins" ON public.failed_login_attempts
;


CREATE POLICY "service_role_all_failed_logins" ON public.failed_login_attempts
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;



;
