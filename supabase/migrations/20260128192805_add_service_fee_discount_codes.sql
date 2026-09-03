
-- Drop existing CHECK constraints
ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;
ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_applicable_to_check;

-- Add updated CHECK constraint for discount_type with new service fee types
ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_discount_type_check 
  CHECK (discount_type IN (
    'tour_percentage', 
    'tour_fixed', 
    'membership_free_month', 
    'gift_card_percentage', 
    'gift_card_fixed',
    'agency_tour_percentage',
    'agency_tour_fixed',
    'service_fee_percentage',
    'service_fee_fixed',
    'service_fee_full'
  ));

-- Add updated CHECK constraint for applicable_to with service_fees
ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_applicable_to_check 
  CHECK (applicable_to IN ('tours', 'memberships', 'gift_cards', 'service_fees'));

-- Add max_discount_amount column to limit discount amount for percentage-based codes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discount_codes' AND column_name = 'max_discount_amount'
  ) THEN
    ALTER TABLE discount_codes ADD COLUMN max_discount_amount numeric(10,2) CHECK (max_discount_amount > 0);
  END IF;
END $$;

-- Add comment to explain the column
COMMENT ON COLUMN discount_codes.max_discount_amount IS 'Optional maximum discount amount in pesos for percentage-based discounts. Example: 50% discount with max_discount_amount=100 will cap the discount at 100 MXN';

-- Create index for efficient filtering by applicable_to
CREATE INDEX IF NOT EXISTS idx_discount_codes_applicable_to ON discount_codes(applicable_to) WHERE is_active = true;

-- Create index for service fee codes specifically
CREATE INDEX IF NOT EXISTS idx_discount_codes_service_fees ON discount_codes(applicable_to, is_active, valid_from, valid_until) WHERE applicable_to = 'service_fees';
