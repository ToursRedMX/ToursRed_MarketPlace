/*
# Add Conekta payment columns to bookings table

## Purpose
The frontend already writes `conekta_method` and `bnpl_product_type` to the
bookings table during booking creation, but these columns never existed on
`bookings` — only `bnpl_product_type` existed on `payment_transactions`.
This migration adds the missing columns so the insert stops failing silently,
and adds a new `conekta_sub_charges` jsonb column to support split payments
(dividir un pago entre dos métodos nativos de Conekta).

## Changes to `bookings` table
1. `conekta_method` (text, nullable) — which Conekta payment method the
   traveler selected: `card`, `cash`, `spei`, or `bnpl`.
   CHECK constraint limits to those four values (or NULL).
2. `bnpl_product_type` (text, nullable) — which BNPL provider: `aplazo_bnpl`,
   `creditea_bnpl`, or `coppel_bnpl`. CHECK constraint limits to those three
   values (or NULL).
3. `conekta_sub_charges` (jsonb, nullable) — array of split-charge objects
   when the traveler divides payment between two native Conekta methods.
   Each object has the shape: { "amount": number, "payment_method_type": "card"|"cash"|"spei" }.
   NULL when no split is used.

## Security
- No RLS policy changes. Existing booking ownership policies already govern
  access to all columns on the `bookings` table.

## Notes
- All statements use IF NOT EXISTS for idempotency.
- No data loss: all three columns are nullable and additive.
*/

-- 1. conekta_method
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND table_schema = 'public' AND column_name = 'conekta_method'
  ) THEN
    ALTER TABLE bookings ADD COLUMN conekta_method text;
    ALTER TABLE bookings ADD CONSTRAINT bookings_conekta_method_check
      CHECK (conekta_method IS NULL OR conekta_method IN ('card', 'cash', 'spei', 'bnpl'));
  END IF;
END $$;

-- 2. bnpl_product_type (on bookings, not just payment_transactions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND table_schema = 'public' AND column_name = 'bnpl_product_type'
  ) THEN
    ALTER TABLE bookings ADD COLUMN bnpl_product_type text;
    ALTER TABLE bookings ADD CONSTRAINT bookings_bnpl_product_type_check
      CHECK (
        bnpl_product_type IS NULL
        OR bnpl_product_type IN ('aplazo_bnpl', 'creditea_bnpl', 'coppel_bnpl')
      );
  END IF;
END $$;

-- 3. conekta_sub_charges
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND table_schema = 'public' AND column_name = 'conekta_sub_charges'
  ) THEN
    ALTER TABLE bookings ADD COLUMN conekta_sub_charges jsonb;
  END IF;
END $$;
