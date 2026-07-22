-- batch_payouts
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'batch_payouts') THEN
    CREATE INDEX IF NOT EXISTS idx_batch_payouts_batch_id ON public.batch_payouts (batch_id);
    CREATE INDEX IF NOT EXISTS idx_batch_payouts_payout_id ON public.batch_payouts (payout_id);
  END IF;
END $$;

-- booking_reschedule_responses
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_booking_id ON public.booking_reschedule_responses (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_tour_reschedule_id ON public.booking_reschedule_responses (tour_reschedule_id);

-- discount_code_usage
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_discount_code_id ON public.discount_code_usage (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_user_id ON public.discount_code_usage (user_id);

-- message_participants
CREATE INDEX IF NOT EXISTS idx_message_participants_conversation_id ON public.message_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_participants_user_id ON public.message_participants (user_id);

-- saved_tours
CREATE INDEX IF NOT EXISTS idx_saved_tours_user_id ON public.saved_tours (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_tours_tour_id ON public.saved_tours (tour_id);

-- tour_departure_points
CREATE INDEX IF NOT EXISTS idx_tour_departure_points_tour_id ON public.tour_departure_points (tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_departure_points_departure_point_id ON public.tour_departure_points (departure_point_id);

-- tour_destinations
CREATE INDEX IF NOT EXISTS idx_tour_destinations_tour_id ON public.tour_destinations (tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_destinations_destination_id ON public.tour_destinations (destination_id);
