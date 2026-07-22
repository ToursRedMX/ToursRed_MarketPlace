/*
# Add charge_context + charge_reference_id to payment_transactions and enable points clawback

## Overview
This migration prepares the schema for per-line (granular) refunds and points clawback.
It adds two columns to `payment_transactions` so each payment row knows WHAT it paid for
(deposit, installment, supplement, insurance, optional service) and the ID of that specific
record. It also relaxes the points-wallet balance constraint to allow a temporary negative
balance during clawback (when a refund reverts more points than the user currently holds),
extends the CHECK constraints on `toursred_points_transactions` to include the new
`clawback` type and the missing reference types used by extras, and backfills historical
payment rows from `booking_payment_plan_transactions` and `booking_supplements` into
`payment_transactions` so they become refundable lines.

## 1. Modified Table: payment_transactions
- `charge_context` (text, NOT NULL, DEFAULT 'booking_deposit')
  Values: 'booking_deposit' | 'payment_plan_installment' | 'supplement' | 'insurance' | 'optional_service'
  Identifies which kind of charge this row represents.
- `charge_reference_id` (uuid, nullable)
  Points to the specific record this payment settled:
  - booking_deposit -> bookings.id
  - payment_plan_installment -> booking_payment_plan_transactions.id
  - supplement -> booking_supplements.id
  - insurance / optional_service -> booking_optional_services.id (or booking_id fallback)
- Backfill: existing rows get charge_context='booking_deposit', charge_reference_id=booking_id.
- CHECK constraint on charge_context.

## 2. Modified Table: toursred_points_transactions (CHECK extensions)
- `type` CHECK extended to include 'clawback'.
- `reference_type` CHECK extended to include 'optional_service_payment', 'insurance_payment',
  'supplement' (alias of supplement_payment) and 'post_booking_extra'.

## 3. Modified Table: toursred_points_wallets (balance relaxation)
- `balance >= 0` replaced with `balance >= -100000` to allow clawback to drive the wallet
  negative when the user has already spent the points. total_earned stays >= 0.
  The -100000 floor is a safety net against runaway drift; realistic clawbacks are small.

## 4. Backfill: payment_transactions from booking_payment_plan_transactions
- For each completed installment transaction with a provider_transaction_id that is NOT
  already present in payment_transactions (by stripe_payment_intent_id /
  mercadopago_payment_id / paypal_capture_id match), insert a new payment_transactions row
  with charge_context='payment_plan_installment', charge_reference_id = that row's id,
  payment_processor inferred from payment_provider column.
- Dedupe via NOT EXISTS on the processor reference columns.

## 5. Backfill: payment_transactions from booking_supplements
- For each supplement with status='paid' and a non-null payment_intent_id not already in
  payment_transactions, insert a row with charge_context='supplement',
  charge_reference_id = booking_supplements.id, payment_processor='stripe'.

## 6. Indexes
- idx on payment_transactions(charge_reference_id) WHERE charge_reference_id IS NOT NULL
- idx on payment_transactions(charge_context)
- composite idx on payment_transactions(booking_id, charge_context)

## 7. Security
- No new tables. payment_transactions RLS already restricts access. No policy changes.
*/

-- ============================================================
-- 1. Add charge_context + charge_reference_id to payment_transactions
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'charge_context'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN charge_context text NOT NULL DEFAULT 'booking_deposit';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'charge_reference_id'
  ) THEN
    ALTER TABLE payment_transactions
    ADD COLUMN charge_reference_id uuid;
  END IF;
END $$;

-- Backfill existing rows: they are all booking deposits
UPDATE payment_transactions
SET charge_context = 'booking_deposit',
    charge_reference_id = booking_id
WHERE charge_reference_id IS NULL;

-- Add CHECK constraint on charge_context (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_transactions_charge_context_check'
    AND conrelid = 'public.payment_transactions'::regclass
  ) THEN
    ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_charge_context_check
    CHECK (charge_context IN ('booking_deposit', 'payment_plan_installment', 'supplement', 'insurance', 'optional_service'));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_transactions_charge_reference_id
  ON payment_transactions(charge_reference_id)
  WHERE charge_reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_charge_context
  ON payment_transactions(charge_context);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_context
  ON payment_transactions(booking_id, charge_context);

-- ============================================================
-- 2. Extend CHECK on toursred_points_transactions.type to include 'clawback'
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toursred_points_transactions_type_check'
    AND conrelid = 'public.toursred_points_transactions'::regclass
  ) THEN
    ALTER TABLE toursred_points_transactions
    DROP CONSTRAINT toursred_points_transactions_type_check;
  END IF;
  ALTER TABLE toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_type_check
  CHECK (type IN ('earned','redeemed','expired','refund','adjustment','partial_cancellation','clawback'));
END $$;

-- Extend CHECK on reference_type to include extras types + 'supplement' alias
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toursred_points_transactions_reference_type_check'
    AND conrelid = 'public.toursred_points_transactions'::regclass
  ) THEN
    ALTER TABLE toursred_points_transactions
    DROP CONSTRAINT toursred_points_transactions_reference_type_check;
  END IF;
  ALTER TABLE toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_reference_type_check
  CHECK (reference_type IN ('booking','adjustment','promotion','referral','booking_partial_cancellation','supplement_payment','supplement','payment_plan','optional_service_payment','insurance_payment','post_booking_extra'));
END $$;

-- ============================================================
-- 3. Relax toursred_points_wallets.balance to allow negative (clawback)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toursred_points_wallets_balance_check'
    AND conrelid = 'public.toursred_points_wallets'::regclass
  ) THEN
    ALTER TABLE toursred_points_wallets
    DROP CONSTRAINT toursred_points_wallets_balance_check;
  END IF;
  ALTER TABLE toursred_points_wallets
  ADD CONSTRAINT toursred_points_wallets_balance_check
  CHECK (balance >= -100000);
END $$;

-- ============================================================
-- 4. Backfill payment_transactions from booking_payment_plan_transactions
-- ============================================================

INSERT INTO payment_transactions (
  booking_id, stripe_payment_intent_id, mercadopago_payment_id, paypal_capture_id,
  amount, currency, status, payment_processor, processor_fee, net_amount,
  charge_context, charge_reference_id, created_at, updated_at
)
SELECT
  bppt.booking_id,
  CASE WHEN bppt.payment_provider = 'stripe' THEN bppt.provider_transaction_id ELSE NULL END,
  CASE WHEN bppt.payment_provider = 'mercadopago' THEN bppt.provider_transaction_id ELSE NULL END,
  CASE WHEN bppt.payment_provider = 'paypal' THEN bppt.provider_transaction_id ELSE NULL END,
  bppt.amount,
  'mxn',
  CASE WHEN bppt.status = 'completed' THEN 'succeeded' ELSE bppt.status END,
  CASE WHEN bppt.payment_provider IN ('stripe','mercadopago','paypal') THEN bppt.payment_provider ELSE NULL END,
  0,
  bppt.amount,
  'payment_plan_installment',
  bppt.id,
  bppt.created_at,
  bppt.updated_at
FROM booking_payment_plan_transactions bppt
WHERE bppt.status = 'completed'
  AND bppt.provider_transaction_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE (pt.stripe_payment_intent_id = bppt.provider_transaction_id AND bppt.payment_provider = 'stripe')
       OR (pt.mercadopago_payment_id = bppt.provider_transaction_id AND bppt.payment_provider = 'mercadopago')
       OR (pt.paypal_capture_id = bppt.provider_transaction_id AND bppt.payment_provider = 'paypal')
  );

-- ============================================================
-- 5. Backfill payment_transactions from booking_supplements (Stripe paid)
-- ============================================================

INSERT INTO payment_transactions (
  booking_id, stripe_payment_intent_id, amount, currency, status,
  payment_processor, processor_fee, net_amount,
  charge_context, charge_reference_id, created_at, updated_at
)
SELECT
  bs.booking_id,
  bs.payment_intent_id,
  bs.total_paid,
  'mxn',
  'succeeded',
  'stripe',
  0,
  bs.total_paid,
  'supplement',
  bs.id,
  bs.paid_at,
  bs.updated_at
FROM booking_supplements bs
WHERE bs.status = 'paid'
  AND bs.payment_intent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE pt.stripe_payment_intent_id = bs.payment_intent_id
  );

-- ============================================================
-- 6. Grant execute on nothing new (no functions in this migration)
-- ============================================================
