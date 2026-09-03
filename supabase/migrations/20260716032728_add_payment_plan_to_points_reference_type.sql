-- Add 'payment_plan' to the allowed reference_type values in toursred_points_transactions
ALTER TABLE public.toursred_points_transactions
  DROP CONSTRAINT IF EXISTS toursred_points_transactions_reference_type_check;

ALTER TABLE public.toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_reference_type_check
  CHECK (reference_type = ANY (ARRAY['booking'::text, 'adjustment'::text, 'promotion'::text, 'referral'::text, 'booking_partial_cancellation'::text, 'supplement_payment'::text, 'payment_plan'::text]));
