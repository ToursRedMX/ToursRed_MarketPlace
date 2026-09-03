/*
# Add insurance_refund_amount to booking_partial_cancellations

1. Modified Tables
- `booking_partial_cancellations`: Added column `insurance_refund_amount` (numeric, default 0)
  to track the proportional travel insurance refund amount when travelers are partially cancelled.
  This prevents double-refunding: the booking's travel_insurance_cost is reduced by this amount
  in the same operation, and the value is recorded here for audit.

2. Security
- No RLS policy changes needed. The column is populated by the service role (edge function).

3. Important Notes
- Column is nullable-safe with default 0 so existing rows are unaffected.
- The edge function `process-partial-cancellation` will populate this field and also
  subtract it from the booking's `travel_insurance_cost` to avoid double refunds.
*/

ALTER TABLE booking_partial_cancellations
ADD COLUMN IF NOT EXISTS insurance_refund_amount numeric DEFAULT 0;
