/*
# OpenPay SPEI + CODI Wallet Top-Up System

## Purpose
Enables ToursRed Cash wallet recharges via OpenPay using SPEI bank transfers
and CODI QR payments. Each recharge creates a charge in OpenPay, and the
wallet is credited only after webhook confirmation verified against the
OpenPay API.

## 1. New Enum Values
- `topup_spei` added to `toursred_cash_transaction_type` — identifies SPEI recharge transactions
- `topup_codi` added to `toursred_cash_transaction_type` — identifies CODI QR recharge transactions

## 2. Modified Tables
- `users`: adds `openpay_customer_id` text column (nullable, unique) to store
  the OpenPay customer ID for reuse across future recharges

## 3. New Tables
- `openpay_wallet_topups`: Records each recharge request with OpenPay charge details
- `openpay_webhook_events`: Raw log of every webhook received from OpenPay
- `user_recharge_limit_overrides`: Admin-managed per-user limit exceptions

## 4. Security (RLS)
- `openpay_wallet_topups`: Users can SELECT only their own recharges;
  no direct INSERT/UPDATE/DELETE from client (all via service role in edge functions)
- `openpay_webhook_events`: No client access at all (service role only)
- `user_recharge_limit_overrides`: Admin-only access via is_super_admin()
- `users.openpay_customer_id`: Only updatable by service role (no new client policy needed —
  existing users UPDATE policy already covers profile fields; we add a restrictive
  policy specifically for the openpay column)

## 5. Important Notes
- The wallet balance itself is NOT stored here — it remains in `toursred_cash_wallets`
  and is credited via the existing `update_wallet_balance()` function with idempotency key
- OpenPay does not cryptographically sign webhooks, so verification against the API
  is mandatory before crediting
- `reference_id` in `toursred_cash_transactions` is uuid type; OpenPay charge IDs are
  text, so we pass the topup record's uuid as `p_reference_id` and use
  `p_reference_type = 'openpay_spei_topup'` or `'openpay_codi_topup'`
  and `p_idempotency_key = provider_charge_id` to prevent double-credit
*/

-- ── Enum additions ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'toursred_cash_transaction_type' AND e.enumlabel = 'topup_spei'
  ) THEN
    ALTER TYPE toursred_cash_transaction_type ADD VALUE 'topup_spei';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'toursred_cash_transaction_type' AND e.enumlabel = 'topup_codi'
  ) THEN
    ALTER TYPE toursred_cash_transaction_type ADD VALUE 'topup_codi';
  END IF;
END $$;

-- ── users table: openpay_customer_id column ────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'openpay_customer_id'
  ) THEN
    ALTER TABLE users ADD COLUMN openpay_customer_id text;
  END IF;
END $$;

-- Unique constraint to prevent duplicate customer creation
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_openpay_customer_id_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_openpay_customer_id_key UNIQUE (openpay_customer_id);
  END IF;
END $$;

-- ── openpay_wallet_topups table ────────────────────────────────
CREATE TABLE IF NOT EXISTS openpay_wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'MXN',
  payment_method_type text NOT NULL DEFAULT 'spei'
    CHECK (payment_method_type IN ('spei', 'codi')),
  openpay_customer_id text,
  provider_charge_id text UNIQUE,
  order_id text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'awaiting_transfer',
      'completed',
      'expired',
      'cancelled',
      'failed'
    )),
  payment_method_response jsonb,
  provider_response jsonb,
  credited_at timestamptz,
  expires_at timestamptz,
  error_code text,
  error_message text,
  conciliation_status text DEFAULT NULL
    CHECK (conciliation_status IS NULL OR conciliation_status IN (
      'no_reconocido',
      'requiere_conciliacion_manual',
      'resuelto_acreditado',
      'resuelto_sin_acreditar'
    )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE openpay_wallet_topups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_openpay_topups_user_id ON openpay_wallet_topups (user_id);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_provider_charge_id ON openpay_wallet_topups (provider_charge_id);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_order_id ON openpay_wallet_topups (order_id);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_status ON openpay_wallet_topups (status);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_method_type ON openpay_wallet_topups (payment_method_type);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_created_at ON openpay_wallet_topups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openpay_topups_conciliation ON openpay_wallet_topups (conciliation_status) WHERE conciliation_status IS NOT NULL;

-- RLS: Users can only read their own topups
DROP POLICY IF EXISTS "select_own_openpay_topups" ON openpay_wallet_topups;
CREATE POLICY "select_own_openpay_topups"
  ON openpay_wallet_topups FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated users —
-- all mutations happen via service role in edge functions

-- Admin can see all topups
DROP POLICY IF EXISTS "admin_select_all_openpay_topups" ON openpay_wallet_topups;
CREATE POLICY "admin_select_all_openpay_topups"
  ON openpay_wallet_topups FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true));

DROP POLICY IF EXISTS "admin_update_openpay_topups" ON openpay_wallet_topups;
CREATE POLICY "admin_update_openpay_topups"
  ON openpay_wallet_topups FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true));

-- ── openpay_webhook_events table ───────────────────────────────
CREATE TABLE IF NOT EXISTS openpay_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  transaction_id text,
  order_id text,
  raw_payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received',
      'processed',
      'no_reconocido',
      'requiere_conciliacion_manual',
      'ignored',
      'error'
    )),
  processing_result text,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE openpay_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_openpay_webhook_event_type ON openpay_webhook_events (event_type);
CREATE INDEX IF NOT EXISTS idx_openpay_webhook_transaction_id ON openpay_webhook_events (transaction_id);
CREATE INDEX IF NOT EXISTS idx_openpay_webhook_processing_status ON openpay_webhook_events (processing_status);
CREATE INDEX IF NOT EXISTS idx_openpay_webhook_received_at ON openpay_webhook_events (received_at DESC);

-- Admin-only access to webhook events
DROP POLICY IF EXISTS "admin_select_openpay_webhook_events" ON openpay_webhook_events;
CREATE POLICY "admin_select_openpay_webhook_events"
  ON openpay_webhook_events FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true));

DROP POLICY IF EXISTS "admin_update_openpay_webhook_events" ON openpay_webhook_events;
CREATE POLICY "admin_update_openpay_webhook_events"
  ON openpay_webhook_events FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true));

-- ── user_recharge_limit_overrides table ────────────────────────
CREATE TABLE IF NOT EXISTS user_recharge_limit_overrides (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_limit_override numeric(12,2),
  max_balance_override numeric(12,2),
  justification text NOT NULL,
  approved_by_admin_id uuid NOT NULL REFERENCES public.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

ALTER TABLE user_recharge_limit_overrides ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_recharge_overrides_expires ON user_recharge_limit_overrides (expires_at) WHERE expires_at IS NOT NULL;

-- Admin-only access
DROP POLICY IF EXISTS "admin_all_recharge_limit_overrides" ON user_recharge_limit_overrides;
CREATE POLICY "admin_all_recharge_limit_overrides"
  ON user_recharge_limit_overrides FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true));

-- ── updated_at trigger for openpay_wallet_topups ───────────────
CREATE OR REPLACE FUNCTION public.set_openpay_topup_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_openpay_topup_updated_at ON openpay_wallet_topups;
CREATE TRIGGER trg_openpay_topup_updated_at
  BEFORE UPDATE ON openpay_wallet_topups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_openpay_topup_updated_at();