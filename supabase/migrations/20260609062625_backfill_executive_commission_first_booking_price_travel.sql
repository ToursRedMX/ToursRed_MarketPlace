
-- Backfill for booking TRG-REA1E4JAU2J (id: 7ba7915e-c520-4bad-844c-be0f414af491)
-- Agency PRICE TRAVEL (id: 2c158ce8-a218-499d-aafa-114a16318ee5) had its first paid
-- booking but first_paid_booking_at was never set because the trigger checked for
-- payment_status = 'paid' instead of 'succeeded'.

-- Step 1: Set first_paid_booking_at on the agency
UPDATE agencies
SET first_paid_booking_at = '2026-06-09 05:35:34.153+00'
WHERE id = '2c158ce8-a218-499d-aafa-114a16318ee5'
  AND first_paid_booking_at IS NULL;

-- Step 2: Insert the first_tour_and_booking commission if it doesn't already exist
INSERT INTO executive_commissions (
  executive_id,
  agency_id,
  commission_type,
  amount,
  status,
  commission_settings_snapshot
)
SELECT
  a.account_executive_id,
  a.id,
  'first_tour_and_booking',
  s.amount_per_first_booking,
  'pending',
  jsonb_build_object(
    'amount_per_approval',         s.amount_per_approval,
    'amount_per_first_booking',    s.amount_per_first_booking,
    'platform_revenue_percentage', s.platform_revenue_percentage,
    'commission_period_months',    s.commission_period_months,
    'settings_id',                 s.id
  )
FROM agencies a
CROSS JOIN executive_commission_settings s
WHERE a.id = '2c158ce8-a218-499d-aafa-114a16318ee5'
  AND s.is_current = true
  AND NOT EXISTS (
    SELECT 1 FROM executive_commissions
    WHERE agency_id = '2c158ce8-a218-499d-aafa-114a16318ee5'
      AND commission_type = 'first_tour_and_booking'
  );
