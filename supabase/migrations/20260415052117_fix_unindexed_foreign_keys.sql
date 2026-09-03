CREATE INDEX IF NOT EXISTS idx_admin_broadcast_messages_sent_by ON public.admin_broadcast_messages(sent_by);
CREATE INDEX IF NOT EXISTS idx_agency_payouts_processed_by ON public.agency_payouts(processed_by);
CREATE INDEX IF NOT EXISTS idx_agency_tour_message_recipients_booking_id ON public.agency_tour_message_recipients(booking_id);
CREATE INDEX IF NOT EXISTS idx_agency_tour_messages_sent_by ON public.agency_tour_messages(sent_by);
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_toursred_cash_txn ON public.booking_cancellations(toursred_cash_transaction_id);
CREATE INDEX IF NOT EXISTS idx_booking_checkin_tokens_scanned_by_staff ON public.booking_checkin_tokens(scanned_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_booking_partial_cancellations_cash_txn ON public.booking_partial_cancellations(toursred_cash_transaction_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_refund_txn ON public.booking_reschedule_responses(refund_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bookings_agency_cancellation_id ON public.bookings(agency_cancellation_id);
CREATE INDEX IF NOT EXISTS idx_bookings_no_show_marked_by ON public.bookings(no_show_marked_by);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'slot_reschedule_alternative_slot_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_bookings_slot_reschedule_alt_slot ON public.bookings(slot_reschedule_alternative_slot_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'cfdi_cancellation_requests'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_cfdi_cancellation_requests_requested_by ON public.cfdi_cancellation_requests(requested_by);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_discount_code_usage_booking_id ON public.discount_code_usage(booking_id);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_gift_card_id ON public.discount_code_usage(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_membership_id ON public.discount_code_usage(membership_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_created_by ON public.discount_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_cancellation_id ON public.financial_transactions(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_created_by_user ON public.financial_transactions(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_payout_batches_processed_by ON public.payout_batches(processed_by);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_relationship_id ON public.referral_bonuses(referral_relationship_id);
CREATE INDEX IF NOT EXISTS idx_referral_fraud_logs_relationship_id ON public.referral_fraud_logs(referral_relationship_id);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_first_booking ON public.referral_relationships(first_booking_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_created_by ON public.slot_reschedule_requests(created_by);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_target_slot ON public.slot_reschedule_requests(target_slot_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'slot_seat_status'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_slot_seat_status_blocked_by ON public.slot_seat_status(blocked_by);
    CREATE INDEX IF NOT EXISTS idx_slot_seat_status_slot_id ON public.slot_seat_status(slot_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tour_cancellations_cancelled_by_user ON public.tour_cancellations(cancelled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tour_promotions_created_by ON public.tour_promotions(created_by);
CREATE INDEX IF NOT EXISTS idx_tour_reschedules_created_by ON public.tour_reschedules(created_by);
CREATE INDEX IF NOT EXISTS idx_tour_schedules_departure_point_id ON public.tour_schedules(departure_point_id);
CREATE INDEX IF NOT EXISTS idx_tours_agency_cancellation_id ON public.tours(agency_cancellation_id);
