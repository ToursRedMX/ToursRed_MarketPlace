-- Add total_principal_paid column to booking_cancellations
-- Stores: deposit_amount + sum of booking_payment_plan_installments.amount_paid (status paid/partially_paid)
-- Nullable, no backfill — only populated going forward from edge functions.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_cancellations' AND column_name = 'total_principal_paid'
  ) THEN
    ALTER TABLE booking_cancellations
    ADD COLUMN total_principal_paid numeric(10,2);
  END IF;
END $$;
