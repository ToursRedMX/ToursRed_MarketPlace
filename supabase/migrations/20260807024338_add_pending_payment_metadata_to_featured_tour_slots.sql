/*
# Add pending_payment_metadata to featured_tour_slots

1. Modified Tables
- `featured_tour_slots`: adds `pending_payment_metadata` (jsonb, nullable).
  Stores Openpay SPEI/cash payment instructions (clabe, reference, barcode, PDF URLs)
  for featured slot purchases that don't have a payment_transactions row (booking_id is NOT NULL on that table).

2. Security
- No RLS changes — the table already has existing policies.
*/

ALTER TABLE featured_tour_slots
  ADD COLUMN IF NOT EXISTS pending_payment_metadata jsonb;