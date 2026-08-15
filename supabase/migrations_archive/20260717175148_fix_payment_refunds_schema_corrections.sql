/*
# Correction migration: payment_refunds schema fixes

## Overview
Three corrections requested after Block 1 review:
1. Add missing `requested_by` enum column to payment_refunds
2. Add missing CHECK constraint on refund_method
3. Change booking_id FK from ON DELETE CASCADE to ON DELETE RESTRICT

## 1. New Column: requested_by
- `requested_by` (text, NOT NULL, DEFAULT 'admin_override')
- CHECK constraint: values must be 'traveler_default', 'traveler_profeco_request', or 'admin_override'
- This is an enum-like string that identifies the *trigger source* of the refund
- Separated from `created_by_user_id` (uuid) which identifies the *admin user* who executed the action

## 2. CHECK constraint on refund_method
- Ensures refund_method can only be 'toursred_cash' or 'original_payment_method'

## 3. FK change: booking_id ON DELETE RESTRICT
- Prevents deleting a booking that has refund history
- Must drop the existing CASCADE FK and recreate as RESTRICT
*/

-- ============================================================
-- 1. Add requested_by column
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_refunds' AND column_name = 'requested_by'
  ) THEN
    ALTER TABLE payment_refunds
    ADD COLUMN requested_by text NOT NULL DEFAULT 'admin_override'
    CHECK (requested_by IN ('traveler_default', 'traveler_profeco_request', 'admin_override'));
  END IF;
END $$;

-- ============================================================
-- 2. Add CHECK constraint on refund_method
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_refunds_refund_method_check'
    AND conrelid = 'public.payment_refunds'::regclass
  ) THEN
    ALTER TABLE payment_refunds
    ADD CONSTRAINT payment_refunds_refund_method_check
    CHECK (refund_method IN ('toursred_cash', 'original_payment_method'));
  END IF;
END $$;

-- ============================================================
-- 3. Change booking_id FK from CASCADE to RESTRICT
-- ============================================================

DO $$ BEGIN
  -- Drop the existing CASCADE constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payment_refunds_booking_id_fkey'
    AND table_name = 'payment_refunds'
  ) THEN
    ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_booking_id_fkey;
  END IF;

  -- Recreate as RESTRICT
  ALTER TABLE payment_refunds
  ADD CONSTRAINT payment_refunds_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT;
END $$;
