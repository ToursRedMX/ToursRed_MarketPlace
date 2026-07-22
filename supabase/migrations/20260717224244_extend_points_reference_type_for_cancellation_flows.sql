-- Extend reference_type CHECK to include admin_cancellation, traveler_cancellation,
-- membership, and featured_slot — used by deduct_points calls in cancellation flows
-- and by the points traceability helper.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toursred_points_transactions_reference_type_check'
    AND conrelid = 'public.toursred_points_transactions'::regclass
  ) THEN
    ALTER TABLE toursred_points_transactions
    DROP CONSTRAINT toursred_points_transactions_reference_type_check;
  END IF;
  ALTER TABLE toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_reference_type_check
  CHECK (reference_type IN (
    'booking','adjustment','promotion','referral',
    'booking_partial_cancellation','supplement_payment','supplement',
    'payment_plan','optional_service_payment','insurance_payment',
    'post_booking_extra','admin_cancellation','traveler_cancellation',
    'membership','featured_slot'
  ));
END $$;
