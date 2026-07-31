/*
# Conekta Payment Processor System — Database Foundation

## Context
Adds Conekta as the fourth payment processor in ToursRed (alongside Stripe, PayPal, MercadoPago).
Conekta supports BNPL (Aplazo, Creditea, Coppel Pay) plus card, cash, and SPEI payments.

## Changes

### 1. payment_transactions — new columns
- `conekta_order_id` (text, nullable) — Conekta order ID for the transaction
- `conekta_charge_id` (text, nullable) — Conekta charge ID (for individual charge-level refunds in split orders)
- `bnpl_product_type` (text, nullable) — which BNPL provider: `aplazo_bnpl`, `creditea_bnpl`, or `coppel_bnpl`
- `p_idempotency_key` (text, nullable) — idempotency key for order creation (prevents duplicate orders from double-clicks/retries)

Note: `payment_method_type` already exists on this table and is reused with values `bnpl`, `card`, `cash`, `spei` for Conekta transactions.
Note: `payment_processor` already exists (no CHECK constraint) and will store `'conekta'`.

### 2. CHECK constraint updates (two tables)
- `bookings.payment_provider`: add `'conekta'` to allowed values
- `gift_cards.payment_provider`: add `'conekta'` to allowed values

### 3. bookings.status — new state
- Add `'payment_pending_bnpl'` to allowed status values (transient state while a BNPL order is being processed)

### 4. bookings — incomplete payment tracking columns
- `incomplete_payment_reminder_72h_sent_at` (timestamptz, nullable) — timestamp when the 72h reminder email was sent
- `incomplete_payment_reminder_24h_sent_at` (timestamptz, nullable) — timestamp when the 24h-before-cancellation reminder was sent

### 5. New table: payment_transaction_charges
Tracks individual charges within a Conekta split order (card+cash+spei combos).
Required because Conekta refunds on split orders need the specific `charge_id`, not just the `order_id`.

### 6. platform_settings — new toggle
- `conekta_enabled` (boolean, default false) — master toggle for showing Conekta as a payment option

### 7. Fix auto_cleanup_garbage_bookings()
Exclude bookings where `user_payment > 0` from the 3-day DELETE.
Bookings with partial payments must go through the 72h/7-day incremental payment deadline flow instead of being silently deleted.
*/

-- ============================================================
-- 1. payment_transactions — new columns
-- ============================================================
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS conekta_order_id text,
  ADD COLUMN IF NOT EXISTS conekta_charge_id text,
  ADD COLUMN IF NOT EXISTS bnpl_product_type text CHECK (
    bnpl_product_type IS NULL
    OR bnpl_product_type IN ('aplazo_bnpl', 'creditea_bnpl', 'coppel_bnpl')
  ),
  ADD COLUMN IF NOT EXISTS p_idempotency_key text;

-- Partial unique index on conekta_order_id (only for non-null values, to prevent duplicate orders)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_conekta_order_id
  ON payment_transactions (conekta_order_id)
  WHERE conekta_order_id IS NOT NULL;

-- Idempotency key uniqueness (per booking, to prevent duplicate order creation)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_idempotency_key
  ON payment_transactions (booking_id, p_idempotency_key)
  WHERE p_idempotency_key IS NOT NULL;

-- ============================================================
-- 2. CHECK constraint: bookings.payment_provider + gift_cards.payment_provider
-- ============================================================
DO $$
BEGIN
  -- bookings.payment_provider
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_provider_check;
    ALTER TABLE bookings ADD CONSTRAINT bookings_payment_provider_check
      CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal', 'conekta'));
  END IF;

  -- gift_cards.payment_provider
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_cards' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_payment_provider_check;
    ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_payment_provider_check
      CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal', 'conekta'));
  END IF;
END $$;

-- ============================================================
-- 3. bookings.status — add payment_pending_bnpl
-- ============================================================
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'draft', 'pending', 'confirmed', 'cancelled', 'completed',
    'payment_not_received', 'cancellation_processing', 'payment_pending_bnpl'
  ));

-- ============================================================
-- 4. bookings — incomplete payment tracking columns
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS incomplete_payment_reminder_72h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS incomplete_payment_reminder_24h_sent_at timestamptz;

-- ============================================================
-- 5. New table: payment_transaction_charges
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_transaction_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_transaction_id uuid NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
  conekta_charge_id text,
  payment_method_type text NOT NULL CHECK (payment_method_type IN ('card', 'cash', 'spei')),
  amount decimal(10,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_transaction_charges ENABLE ROW LEVEL SECURITY;

-- Index for lookup by parent transaction
CREATE INDEX IF NOT EXISTS idx_ptc_payment_transaction_id
  ON payment_transaction_charges (payment_transaction_id);

-- Unique index on conekta_charge_id (non-null only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptc_conekta_charge_id
  ON payment_transaction_charges (conekta_charge_id)
  WHERE conekta_charge_id IS NOT NULL;

-- RLS policies: scoped through payment_transactions -> bookings ownership
DROP POLICY IF EXISTS "Users can read own transaction charges" ON payment_transaction_charges;
CREATE POLICY "Users can read own transaction charges"
  ON payment_transaction_charges FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payment_transactions pt
      INNER JOIN bookings b ON b.id = pt.booking_id
      WHERE pt.id = payment_transaction_charges.payment_transaction_id
      AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Agencies can read their transaction charges" ON payment_transaction_charges;
CREATE POLICY "Agencies can read their transaction charges"
  ON payment_transaction_charges FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payment_transactions pt
      INNER JOIN bookings b ON b.id = pt.booking_id
      INNER JOIN agencies a ON a.id = b.agency_id
      WHERE pt.id = payment_transaction_charges.payment_transaction_id
      AND a.user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. platform_settings — conekta_enabled toggle
-- ============================================================
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS conekta_enabled boolean DEFAULT false;

-- ============================================================
-- 7. Fix auto_cleanup_garbage_bookings() — exclude user_payment > 0
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_cleanup_garbage_bookings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_row RECORD;
  deleted_count int := 0;
BEGIN
  FOR deleted_row IN
    SELECT
      b.id,
      b.booking_code,
      b.total_price,
      b.payment_status,
      b.payment_method,
      CASE
        WHEN b.payment_status = 'pending'                                          THEN 'abandoned'
        WHEN b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria' THEN 'unconfirmed_transfer'
        WHEN b.payment_status = 'processing'                                       THEN 'expired_processing'
        ELSE 'other'
      END AS reason
    FROM bookings b
    WHERE b.status IN ('pending', 'cancelled')
      AND COALESCE(b.user_payment, 0) = 0
      AND (
        (b.payment_status = 'pending'      AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
        OR (b.payment_status = 'processing' AND b.payment_method != 'Transferencia Bancaria'
            AND b.created_at < NOW() - INTERVAL '3 days')
      )
  LOOP
    -- Registrar en audit log antes de eliminar
    INSERT INTO booking_cleanup_logs (
      booking_id,
      booking_code,
      total_price,
      payment_status,
      payment_method,
      deleted_by,
      deletion_reason
    ) VALUES (
      deleted_row.id,
      deleted_row.booking_code,
      deleted_row.total_price,
      deleted_row.payment_status,
      deleted_row.payment_method,
      NULL,
      'auto_cron: ' || deleted_row.reason
    )
    ON CONFLICT DO NOTHING;

    -- Eliminar la reserva
    DELETE FROM bookings WHERE id = deleted_row.id;

    deleted_count := deleted_count + 1;
  END LOOP;

  IF deleted_count > 0 THEN
    RAISE LOG 'auto_cleanup_garbage_bookings: eliminadas % reservas basura', deleted_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_cleanup_garbage_bookings() FROM PUBLIC;
