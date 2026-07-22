
ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;

ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_discount_type_check 
  CHECK (discount_type IN (
    'tour_percentage', 
    'tour_fixed', 
    'membership_free_month',
    'membership_percentage',
    'membership_fixed',
    'gift_card_percentage', 
    'gift_card_fixed',
    'agency_tour_percentage',
    'agency_tour_fixed',
    'service_fee_percentage',
    'service_fee_fixed',
    'service_fee_full'
  ));
