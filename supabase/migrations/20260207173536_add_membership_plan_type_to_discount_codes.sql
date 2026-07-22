
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discount_codes' AND column_name = 'membership_plan_type'
  ) THEN
    ALTER TABLE discount_codes ADD COLUMN membership_plan_type text DEFAULT 'both';
  END IF;
END $$;

ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_membership_plan_type_check;

ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_membership_plan_type_check
  CHECK (membership_plan_type IN ('monthly', 'annual', 'both'));
