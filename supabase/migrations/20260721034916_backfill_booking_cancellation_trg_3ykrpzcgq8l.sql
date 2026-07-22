-- Backfill: create the missing booking_cancellations record for TRG-3YKRPZCGQ8L.
-- The admin-cancel-booking edge function failed to insert it because it referenced
-- non-existent columns AND used a policy_type not allowed by the CHECK constraint.
-- Both issues are now fixed in the edge function and the constraint was altered.

INSERT INTO booking_cancellations (
  booking_id,
  cancelled_by_user_id,
  cancelled_at,
  tour_start_date,
  days_before_tour,
  cancellation_policy_type,
  original_deposit_amount,
  original_service_charge,
  refund_amount_to_traveler,
  amount_to_agency,
  amount_to_platform,
  refund_processed,
  cancellation_reason,
  emails_sent,
  refund_method,
  cancelled_by_agency,
  total_principal_paid
)
SELECT
  b.id,
  abc.admin_user_id,
  abc.cancelled_at,
  t.start_date,
  0,
  'admin_cancelled',
  COALESCE(b.deposit_amount, 0),
  COALESCE(b.service_charge, 0),
  COALESCE(abc.refund_amount, 0),
  0,
  0,
  (COALESCE(abc.refund_amount, 0) > 0),
  abc.reason_for_traveler,
  false,
  'original_payment_method',
  false,
  COALESCE(b.deposit_amount, 0) + COALESCE(b.service_charge, 0)
FROM admin_booking_cancellations abc
JOIN bookings b ON b.id = abc.booking_id
JOIN tours t ON t.id = b.tour_id
WHERE b.booking_code = 'TRG-3YKRPZCGQ8L'
  AND NOT EXISTS (
    SELECT 1 FROM booking_cancellations bc WHERE bc.booking_id = b.id
  );
