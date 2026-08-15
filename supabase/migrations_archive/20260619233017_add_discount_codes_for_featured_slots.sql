-- Add featured_slots support to discount codes system

-- 1. Extend applicable_to constraint (add 'featured_slots')
ALTER TABLE discount_codes
  DROP CONSTRAINT IF EXISTS discount_codes_applicable_to_check;

ALTER TABLE discount_codes
  ADD CONSTRAINT discount_codes_applicable_to_check
  CHECK (applicable_to IN (
    'tours', 'memberships', 'gift_cards', 'service_fees', 'insurance', 'featured_slots'
  ));

-- 2. Extend discount_type constraint (add 'featured_percentage', 'featured_fixed')
ALTER TABLE discount_codes
  DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;

ALTER TABLE discount_codes
  ADD CONSTRAINT discount_codes_discount_type_check
  CHECK (discount_type IN (
    'tour_percentage', 'tour_fixed',
    'agency_tour_percentage', 'agency_tour_fixed',
    'membership_free_month', 'membership_percentage', 'membership_fixed',
    'gift_card_percentage', 'gift_card_fixed',
    'service_fee_percentage', 'service_fee_fixed', 'service_fee_full',
    'insurance_percentage', 'insurance_fixed', 'insurance_free',
    'featured_percentage', 'featured_fixed'
  ));

-- 3. Add discount traceability columns to featured_tour_slots
ALTER TABLE featured_tour_slots
  ADD COLUMN IF NOT EXISTS discount_code_id uuid REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_featured_slots_discount_code
  ON featured_tour_slots(discount_code_id)
  WHERE discount_code_id IS NOT NULL;

-- 4. Add featured_slot_id to discount_code_usage for traceability
ALTER TABLE discount_code_usage
  ADD COLUMN IF NOT EXISTS featured_slot_id uuid REFERENCES featured_tour_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_discount_usage_featured_slot
  ON discount_code_usage(featured_slot_id)
  WHERE featured_slot_id IS NOT NULL;

-- 5. Create validate_featured_slot_discount callable by authenticated users
CREATE OR REPLACE FUNCTION public.validate_featured_slot_discount(
  p_code text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN validate_discount_code(p_code, p_user_id, 'featured_slots');
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_featured_slot_discount(text, uuid) TO authenticated;
