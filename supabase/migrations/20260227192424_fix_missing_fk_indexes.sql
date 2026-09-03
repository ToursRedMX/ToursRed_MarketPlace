
CREATE INDEX IF NOT EXISTS idx_agency_payouts_processed_by
  ON public.agency_payouts (processed_by);

CREATE INDEX IF NOT EXISTS idx_booking_cancellations_toursred_cash_transaction_id
  ON public.booking_cancellations (toursred_cash_transaction_id);

CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_refund_transaction_id
  ON public.booking_reschedule_responses (refund_transaction_id);

CREATE INDEX IF NOT EXISTS idx_bookings_agency_cancellation_id
  ON public.bookings (agency_cancellation_id);

CREATE INDEX IF NOT EXISTS idx_bookings_no_show_marked_by
  ON public.bookings (no_show_marked_by);

CREATE INDEX IF NOT EXISTS idx_discount_code_usage_booking_id
  ON public.discount_code_usage (booking_id);

CREATE INDEX IF NOT EXISTS idx_discount_code_usage_gift_card_id
  ON public.discount_code_usage (gift_card_id);

CREATE INDEX IF NOT EXISTS idx_discount_code_usage_membership_id
  ON public.discount_code_usage (membership_id);

CREATE INDEX IF NOT EXISTS idx_discount_codes_created_by
  ON public.discount_codes (created_by);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_cancellation_id
  ON public.financial_transactions (cancellation_id);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_created_by_user_id
  ON public.financial_transactions (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_payout_batches_processed_by
  ON public.payout_batches (processed_by);

CREATE INDEX IF NOT EXISTS idx_referral_bonuses_referral_relationship_id
  ON public.referral_bonuses (referral_relationship_id);

CREATE INDEX IF NOT EXISTS idx_referral_fraud_logs_referral_relationship_id
  ON public.referral_fraud_logs (referral_relationship_id);

CREATE INDEX IF NOT EXISTS idx_referral_relationships_first_booking_id
  ON public.referral_relationships (first_booking_id);

CREATE INDEX IF NOT EXISTS idx_tour_cancellations_cancelled_by_user_id
  ON public.tour_cancellations (cancelled_by_user_id);

CREATE INDEX IF NOT EXISTS idx_tour_promotions_created_by
  ON public.tour_promotions (created_by);

CREATE INDEX IF NOT EXISTS idx_tour_reschedules_created_by
  ON public.tour_reschedules (created_by);

CREATE INDEX IF NOT EXISTS idx_tours_agency_cancellation_id
  ON public.tours (agency_cancellation_id);
