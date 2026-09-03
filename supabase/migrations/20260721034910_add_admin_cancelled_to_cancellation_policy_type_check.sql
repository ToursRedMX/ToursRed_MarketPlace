-- Add 'admin_cancelled' to the booking_cancellations cancellation_policy_type CHECK
-- constraint. The admin-cancel-booking edge function inserts 'admin_cancelled' but
-- the original constraint (migration 20260121024911) only allows:
--   100_percent, 50_percent, no_refund, no_show, pending_approval
-- This caused the booking_cancellations insert to fail silently for ALL admin
-- cancellations, making cancellation_id always null and breaking payment_refunds
-- traceability.

ALTER TABLE booking_cancellations
  DROP CONSTRAINT booking_cancellations_cancellation_policy_type_check;

ALTER TABLE booking_cancellations
  ADD CONSTRAINT booking_cancellations_cancellation_policy_type_check
  CHECK (cancellation_policy_type IN (
    '100_percent', '50_percent', 'no_refund', 'no_show',
    'pending_approval', 'admin_cancelled'
  ));
