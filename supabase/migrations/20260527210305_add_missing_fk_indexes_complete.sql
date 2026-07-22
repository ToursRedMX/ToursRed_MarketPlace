-- ============================================================
-- GRUPO 1: TABLAS CRITICAS DE ALTO TRAFICO
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bookings_approved_by ON public.bookings (approved_by);
CREATE INDEX IF NOT EXISTS idx_bookings_discount_code_id ON public.bookings (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_bookings_promotion_id ON public.bookings (promotion_id);
CREATE INDEX IF NOT EXISTS idx_booking_travelers_frequent_companion_id ON public.booking_travelers (frequent_companion_id);
CREATE INDEX IF NOT EXISTS idx_tours_agency_id ON public.tours (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_slots_agency_id ON public.tour_slots (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_slots_schedule_id ON public.tour_slots (schedule_id);
CREATE INDEX IF NOT EXISTS idx_agencies_user_id ON public.agencies (user_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by_user_id ON public.users (referred_by_user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
    CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_relacionado_id ON public.support_tickets (ticket_relacionado_id);
  END IF;
END $$;

-- ============================================================
-- GRUPO 2: TABLAS FINANCIERAS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_agency_payouts_payout_batch_id ON public.agency_payouts (payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_payout_id ON public.commission_records (payout_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_agency_id ON public.financial_transactions (agency_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_booking_id ON public.financial_transactions (booking_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_payout_id ON public.financial_transactions (payout_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_tour_id ON public.financial_transactions (tour_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cfdi_invoices') THEN
    CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_booking_id ON public.cfdi_invoices (booking_id);
    CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_payout_id ON public.cfdi_invoices (payout_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cfdi_cancellation_requests') THEN
    CREATE INDEX IF NOT EXISTS idx_cfdi_cancellation_requests_cfdi_invoice_id ON public.cfdi_cancellation_requests (cfdi_invoice_id);
  END IF;
END $$;

-- ============================================================
-- GRUPO 3: RESERVAS Y CANCELACIONES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_booking_id ON public.booking_cancellations (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_cancelled_by_user_id ON public.booking_cancellations (cancelled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_booking_optional_services_booking_id ON public.booking_optional_services (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_optional_services_tour_optional_service_id ON public.booking_optional_services (tour_optional_service_id);
CREATE INDEX IF NOT EXISTS idx_booking_partial_cancellations_booking_id ON public.booking_partial_cancellations (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_partial_cancellations_cancelled_by_user_id ON public.booking_partial_cancellations (cancelled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_user_id ON public.booking_reschedule_responses (user_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_agency_id ON public.cancellation_penalty_records (agency_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_booking_id ON public.cancellation_penalty_records (booking_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_tour_id ON public.cancellation_penalty_records (tour_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_agency_id ON public.slot_reschedule_requests (agency_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_original_slot_id ON public.slot_reschedule_requests (original_slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_tour_id ON public.slot_reschedule_requests (tour_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'slot_reschedule_responses' AND column_name = 'alternative_slot_id') THEN
    CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_alternative_slot_id ON public.slot_reschedule_responses (alternative_slot_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_booking_id ON public.slot_reschedule_responses (booking_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_request_id ON public.slot_reschedule_responses (request_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_user_id ON public.slot_reschedule_responses (user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'slot_seat_status') THEN
    CREATE INDEX IF NOT EXISTS idx_slot_seat_status_agency_id ON public.slot_seat_status (agency_id);
    CREATE INDEX IF NOT EXISTS idx_slot_seat_status_booking_id ON public.slot_seat_status (booking_id);
  END IF;
END $$;

-- ============================================================
-- GRUPO 4: MENSAJERIA, CONVERSACIONES Y RESENAS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_booking_id ON public.conversations (booking_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations (created_by);
CREATE INDEX IF NOT EXISTS idx_conversations_tour_id ON public.conversations (tour_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_reviews_agency_id ON public.reviews (agency_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tour_id ON public.reviews (tour_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_agency_reviews_agency_id ON public.agency_reviews (agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_reviews_traveler_id ON public.agency_reviews (traveler_id);
CREATE INDEX IF NOT EXISTS idx_traveler_reviews_agency_id ON public.traveler_reviews (agency_id);
CREATE INDEX IF NOT EXISTS idx_traveler_reviews_traveler_id ON public.traveler_reviews (traveler_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_agency_id ON public.agency_tour_messages (agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_slot_id ON public.agency_tour_messages (slot_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_tour_id ON public.agency_tour_messages (tour_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_message_recipients_message_id ON public.agency_tour_message_recipients (message_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_message_recipients_user_id ON public.agency_tour_message_recipients (user_id);

-- ============================================================
-- GRUPO 5: TOURS, PROGRAMACION Y DESCUENTOS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tour_cancellations_agency_id ON public.tour_cancellations (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_cancellations_tour_id ON public.tour_cancellations (tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_optional_services_tour_id ON public.tour_optional_services (tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_promotions_agency_id ON public.tour_promotions (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_reschedules_agency_id ON public.tour_reschedules (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_schedules_agency_id ON public.tour_schedules (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_schedules_tour_id ON public.tour_schedules (tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_slot_blackouts_agency_id ON public.tour_slot_blackouts (agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_slot_blackouts_tour_id ON public.tour_slot_blackouts (tour_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_agency_id ON public.discount_codes (agency_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_tour_id ON public.discount_codes (tour_id);

-- ============================================================
-- GRUPO 6: WALLET, REFERIDOS, USUARIOS Y MISCELANEAS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_toursred_cash_transactions_user_id ON public.toursred_cash_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_toursred_cash_transactions_wallet_id ON public.toursred_cash_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_toursred_points_transactions_user_id ON public.toursred_points_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_toursred_points_transactions_wallet_id ON public.toursred_points_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON public.referral_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_user_id ON public.referral_bonuses (user_id);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_referrer_user_id ON public.referral_relationships (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_frequent_companions_user_id ON public.frequent_companions (user_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_redeemed_by ON public.gift_cards (redeemed_by);
CREATE INDEX IF NOT EXISTS idx_gift_card_redemption_attempts_gift_card_id ON public.gift_card_redemption_attempts (gift_card_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_redemption_attempts_user_id ON public.gift_card_redemption_attempts (user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounting_access_invitations') THEN
    CREATE INDEX IF NOT EXISTS idx_accounting_access_invitations_accepted_by ON public.accounting_access_invitations (accepted_by);
    CREATE INDEX IF NOT EXISTS idx_accounting_access_invitations_invited_by ON public.accounting_access_invitations (invited_by);
    CREATE INDEX IF NOT EXISTS idx_accounting_access_invitations_revoked_by ON public.accounting_access_invitations (revoked_by);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounting_entries') THEN
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_created_by ON public.accounting_entries (created_by);
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_posted_by ON public.accounting_entries (posted_by);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chart_of_accounts') THEN
    CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent_code ON public.chart_of_accounts (parent_code);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integration_configs') THEN
    CREATE INDEX IF NOT EXISTS idx_integration_configs_agency_id ON public.integration_configs (agency_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_ticket_attachments') THEN
    CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_subido_por_id ON public.support_ticket_attachments (subido_por_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_ticket_comments') THEN
    CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_author_id ON public.support_ticket_comments (author_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_ticket_history') THEN
    CREATE INDEX IF NOT EXISTS idx_support_ticket_history_actor_id ON public.support_ticket_history (actor_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_international_tour_inquiries_user_id ON public.international_tour_inquiries (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_id ON public.password_reset_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_destinations_last_updated_by ON public.destinations (last_updated_by);
CREATE INDEX IF NOT EXISTS idx_destination_images_destination_id ON public.destination_images (destination_id);
CREATE INDEX IF NOT EXISTS idx_destination_images_uploaded_by ON public.destination_images (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_departure_points_created_by ON public.departure_points (created_by);
