ALTER TABLE booking_cancellations
  DROP CONSTRAINT IF EXISTS booking_cancellations_cancellation_policy_type_check;
ALTER TABLE booking_cancellations
  ADD CONSTRAINT booking_cancellations_cancellation_policy_type_check
  CHECK (cancellation_policy_type = ANY (ARRAY['100_percent'::text,
  '50_percent'::text, 'no_refund'::text, 'no_show'::text,
  'pending_approval'::text, 'admin_cancelled'::text,
  'unpaid_withdrawal'::text]));