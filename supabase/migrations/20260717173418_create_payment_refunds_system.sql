/*
# Create payment_refunds system and extend payment_transactions for multi-processor refunds

## Overview
This migration creates the core infrastructure for the multi-processor refund system.
It adds a new `payment_refunds` table to track refunds across Stripe, PayPal, and MercadoPago,
extends `payment_transactions` to store processor-specific IDs and fees, and adds refund
tracking columns to the cancellation tables.

## 1. New Table: payment_refunds
- `id` (uuid, PK)
- `booking_id` (uuid, FK to bookings)
- `cancellation_id` (uuid, nullable — links to booking_cancellations or admin_booking_cancellations)
- `partial_cancellation_id` (uuid, nullable — links to booking_partial_cancellations)
- `payment_transaction_id` (uuid, FK to payment_transactions)
- `refund_method` (text: 'original_payment_method' — this table only tracks processor refunds)
- `payment_processor` (text: 'stripe', 'paypal', 'mercadopago')
- `processor_refund_id` (text, nullable — ID returned by the processor for this refund)
- `processor_original_reference` (text, nullable — the original payment intent / capture / payment ID)
- `requested_amount` (numeric, the amount being refunded)
- `processor_fee_lost` (numeric, default 0 — the non-recoverable processor fee portion)
- `net_cost_to_toursred` (generated column: requested_amount + processor_fee_lost)
- `currency` (text, default 'mxn')
- `status` (text: pending, processing, succeeded, failed, requires_action, cancelled)
- `failure_reason` (text, nullable)
- `idempotency_key` (text, UNIQUE NOT NULL)
- `requested_at` (timestamptz, default now())
- `processed_at` (timestamptz, nullable)
- `confirmed_at` (timestamptz, nullable — set when webhook confirms success)
- `webhook_last_event` (text, nullable)
- `webhook_last_payload` (jsonb, nullable)
- `created_by_user_id` (uuid, nullable)
- `notes` (text, nullable)

## 2. Modified Table: payment_transactions
- Added `payment_processor` (text: 'stripe', 'paypal', 'mercadopago', nullable — nullable since existing rows are all Stripe)
- Added `paypal_capture_id` (text, nullable)
- Added `mercadopago_payment_id` (text, nullable)
- Added `processor_fee` (numeric, default 0 — the fee charged by the processor on the original payment)
- Changed `stripe_payment_intent_id` from NOT NULL to NULLABLE (PayPal and MP rows won't have a Stripe PI)

## 3. Modified Table: booking_cancellations
- Added `refund_method` (text, default 'toursred_cash')
- Added `payment_refund_id` (uuid, FK to payment_refunds, nullable)

## 4. Modified Table: booking_partial_cancellations
- Added `refund_method` (text, default 'toursred_cash')
- Added `payment_refund_id` (uuid, FK to payment_refunds, nullable)

## 5. Modified Table: admin_booking_cancellations
- Extended CHECK constraint on `refund_method` to include 'original_payment_method'
- Added `payment_refund_id` (uuid, FK to payment_refunds, nullable)

## 6. New Chart of Accounts entry
- `606.02` "Comisiones de procesamiento no recuperables" (gasto/deudora, level 4, parent 606)

## 7. Backfill
- Existing `payment_transactions` rows get `payment_processor = 'stripe'` and `processor_fee = COALESCE(stripe_fee, 0)`

## 8. Security
- RLS enabled on `payment_refunds`
- SELECT: authenticated users can read refunds for their own bookings (via join to bookings.user_id)
- INSERT/UPDATE/DELETE: service role only (edge functions use service role key, which bypasses RLS)
- No anon access — refunds are internal financial records

## 9. Indexes
- idx on payment_refunds(booking_id)
- idx on payment_refunds(status)
- idx on payment_refunds(processor_refund_id)
- idx on payment_refunds(payment_transaction_id)
- idx on payment_transactions(paypal_capture_id)
- idx on payment_transactions(mercadopago_payment_id)
- idx on payment_transactions(payment_processor)
*/

-- ============================================================
-- 1. Extend payment_transactions: make stripe_payment_intent_id nullable + add processor columns
-- ============================================================

ALTER TABLE payment_transactions ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'payment_processor'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN payment_processor text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'paypal_capture_id'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN paypal_capture_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'mercadopago_payment_id'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN mercadopago_payment_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'processor_fee'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN processor_fee numeric(10,2) DEFAULT 0;
  END IF;
END $$;

-- Backfill existing Stripe rows
UPDATE payment_transactions
SET payment_processor = 'stripe',
    processor_fee = COALESCE(stripe_fee, 0)
WHERE stripe_payment_intent_id IS NOT NULL AND payment_processor IS NULL;

-- Indexes for processor lookups
CREATE INDEX IF NOT EXISTS idx_payment_transactions_paypal_capture_id
  ON payment_transactions(paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_mercadopago_payment_id
  ON payment_transactions(mercadopago_payment_id)
  WHERE mercadopago_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_processor
  ON payment_transactions(payment_processor)
  WHERE payment_processor IS NOT NULL;

-- ============================================================
-- 2. Create payment_refunds table
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cancellation_id uuid,
  partial_cancellation_id uuid,
  payment_transaction_id uuid NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
  refund_method text NOT NULL DEFAULT 'original_payment_method',
  payment_processor text NOT NULL CHECK (payment_processor IN ('stripe', 'paypal', 'mercadopago')),
  processor_refund_id text,
  processor_original_reference text,
  requested_amount numeric(10,2) NOT NULL,
  processor_fee_lost numeric(10,2) NOT NULL DEFAULT 0,
  net_cost_to_toursred numeric(10,2) GENERATED ALWAYS AS (requested_amount + processor_fee_lost) STORED,
  currency text NOT NULL DEFAULT 'mxn',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'requires_action', 'cancelled')),
  failure_reason text,
  idempotency_key text UNIQUE NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  confirmed_at timestamptz,
  webhook_last_event text,
  webhook_last_payload jsonb,
  created_by_user_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_booking_id ON payment_refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_status ON payment_refunds(status);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_processor_refund_id ON payment_refunds(processor_refund_id) WHERE processor_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_transaction_id ON payment_refunds(payment_transaction_id);

-- ============================================================
-- 3. RLS on payment_refunds
-- ============================================================

ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;

-- Travelers can SELECT their own refunds (via join to bookings.user_id)
DROP POLICY IF EXISTS "traveler_select_own_refunds" ON payment_refunds;
CREATE POLICY "traveler_select_own_refunds"
ON payment_refunds FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM bookings
    WHERE bookings.id = payment_refunds.booking_id
    AND bookings.user_id = auth.uid()
  )
);

-- All write operations are done via service role (edge functions), which bypasses RLS.
-- No INSERT/UPDATE/DELETE policies for authenticated or anon — service role only.

-- ============================================================
-- 4. Add refund columns to booking_cancellations
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_cancellations' AND column_name = 'refund_method'
  ) THEN
    ALTER TABLE booking_cancellations ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_cancellations' AND column_name = 'payment_refund_id'
  ) THEN
    ALTER TABLE booking_cancellations ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 5. Add refund columns to booking_partial_cancellations
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_partial_cancellations' AND column_name = 'refund_method'
  ) THEN
    ALTER TABLE booking_partial_cancellations ADD COLUMN refund_method text NOT NULL DEFAULT 'toursred_cash';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_partial_cancellations' AND column_name = 'payment_refund_id'
  ) THEN
    ALTER TABLE booking_partial_cancellations ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 6. Extend admin_booking_cancellations: add 'original_payment_method' to refund_method CHECK + add payment_refund_id
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_booking_cancellations' AND column_name = 'payment_refund_id'
  ) THEN
    ALTER TABLE admin_booking_cancellations ADD COLUMN payment_refund_id uuid REFERENCES payment_refunds(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drop and recreate the CHECK constraint to include 'original_payment_method'
DO $$ BEGIN
  -- Find and drop the existing CHECK constraint on refund_method
  DECLARE
    constraint_name text;
  BEGIN
    SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'admin_booking_cancellations'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%refund_method%';

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE admin_booking_cancellations DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE admin_booking_cancellations
    ADD CONSTRAINT admin_booking_cancellations_refund_method_check
    CHECK (refund_method IN ('none', 'toursred_cash', 'bank_transfer', 'original_payment_method'));
  END;
END $$;

-- ============================================================
-- 7. Chart of accounts: add non-recoverable processor fee account
-- ============================================================

INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
SELECT '606.02', '606', 'Comisiones de procesamiento no recuperables', 'gasto', '606', 4, 'deudora', true, true,
  'Comisiones cobradas por pasarelas de pago (Stripe, PayPal) que no son reembolsables al cancelar una reserva.'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE code = '606.02'
);
