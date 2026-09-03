-- Fix total_principal_paid for the backfilled booking_cancellations record.
-- The original backfill used deposit_amount + service_charge = 3031.51, which
-- missed the payment plan installment entirely.
-- Correct value using the same formula as admin-cancel-booking:
--   deposit_amount (3027.01)
--   + installment 2 amount_paid (2018.01)  -- installment 1 is the anticipo, already counted as deposit
--   + plan_tx service_charge (100.90)
--   = 5145.92

UPDATE booking_cancellations
SET total_principal_paid = 5145.92,
    updated_at = now()
WHERE id = '1b2c7f43-8a20-4ee9-b958-ec81d2c3de0f';
