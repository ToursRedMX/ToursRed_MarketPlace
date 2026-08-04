/*
# Add Openpay processor support, configurable processor commissions, and processor fee breakdown

## Overview
This migration adds Openpay as a fifth payment processor alongside Stripe, PayPal, MercadoPago, and Conekta.
It adds configurable commission rates per processor to platform_settings, extends payment_transactions
with Openpay-specific columns and processor fee IVA breakdown, extends payment_refunds with Openpay
support and processor refund fee tracking, updates the charge_context CHECK constraint to include
'gift_card', and rewrites create_accounting_entry_for_booking to record real processor fees
(with IVA separation) instead of assuming the full amount hits the bank account.

## 1. platform_settings — new columns
- `openpay_enabled` (boolean, default true) — master toggle for showing Openpay as a payment option
- `openpay_commission_pct` (numeric, default 2.9) — Openpay percentage commission
- `openpay_commission_fixed` (numeric, default 0) — Openpay fixed commission per transaction
- `stripe_commission_pct` (numeric, default 3.1034) — Stripe percentage commission (IVA inclusive)
- `stripe_commission_fixed` (numeric, default 2.5862) — Stripe fixed commission (IVA inclusive)
- `paypal_commission_pct` (numeric, default 3.95) — PayPal percentage commission
- `paypal_commission_fixed` (numeric, default 4.0) — PayPal fixed commission
- `mercadopago_commission_pct` (numeric, default 3.49) — MercadoPago percentage commission
- `mercadopago_commission_fixed` (numeric, default 4.0) — MercadoPago fixed commission
- `conekta_commission_pct` (numeric, default 3.29) — Conekta percentage commission
- `conekta_commission_fixed` (numeric, default 2.5) — Conekta fixed commission

## 2. payment_transactions — new columns
- `openpay_charge_id` (text, nullable) — Openpay charge ID
- `processor_fee_base` (numeric, nullable) — processor fee base amount WITHOUT IVA
- `processor_fee_iva` (numeric, nullable) — IVA portion of the processor fee
- Updated `charge_context` CHECK to include 'gift_card'

## 3. payment_refunds — modifications
- Updated `payment_processor` CHECK to include 'conekta' and 'openpay'
- `processor_refund_fee` (numeric, default 0) — additional fee charged by processor on the refund itself

## 4. bookings — payment_provider CHECK
- Updated to include 'openpay'

## 5. gift_cards — payment_provider CHECK
- Updated to include 'openpay'

## 6. Rewrite create_accounting_entry_for_booking
- Queries payment_transactions for the most recent succeeded transaction for this booking
- If processor_fee_base is NOT NULL (Openpay): uses base + IVA directly
- If only processor_fee is available (Stripe/PayPal/MercadoPago/Conekta): separates base = fee/1.16, IVA = fee - base
- If processor_fee is NULL or 0 and payment was via a processor: uses fallback formula from platform_settings
- Adjusts bank account (102) line to debit net amount (total - processor_fee_total)
- Adds line: Debit 604 (Comisiones bancarias) by processor_fee_base
- Adds line: Debit 108 (IVA Acreditable) by processor_fee_iva
- If payment was via wallet (no processor): no fee lines, full amount hits bank

## 7. Indexes
- idx_payment_transactions_openpay_charge_id
*/

-- ============================================================
-- 1. platform_settings: Openpay toggle + configurable commissions
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'openpay_enabled'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN openpay_enabled boolean DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'openpay_commission_pct'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN openpay_commission_pct numeric(6,4) DEFAULT 2.9;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'openpay_commission_fixed'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN openpay_commission_fixed numeric(10,2) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'stripe_commission_pct'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN stripe_commission_pct numeric(6,4) DEFAULT 3.1034;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'stripe_commission_fixed'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN stripe_commission_fixed numeric(10,2) DEFAULT 2.5862;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_commission_pct'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_commission_pct numeric(6,4) DEFAULT 3.95;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_commission_fixed'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_commission_fixed numeric(10,2) DEFAULT 4.0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mercadopago_commission_pct'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN mercadopago_commission_pct numeric(6,4) DEFAULT 3.49;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mercadopago_commission_fixed'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN mercadopago_commission_fixed numeric(10,2) DEFAULT 4.0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'conekta_commission_pct'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN conekta_commission_pct numeric(6,4) DEFAULT 3.29;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'conekta_commission_fixed'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN conekta_commission_fixed numeric(10,2) DEFAULT 2.5;
  END IF;
END $$;

-- ============================================================
-- 2. payment_transactions: Openpay charge ID + fee IVA breakdown
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'openpay_charge_id'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN openpay_charge_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'processor_fee_base'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN processor_fee_base numeric(10,2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'processor_fee_iva'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN processor_fee_iva numeric(10,2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_openpay_charge_id
  ON payment_transactions(openpay_charge_id)
  WHERE openpay_charge_id IS NOT NULL;

-- Update charge_context CHECK to include 'gift_card'
DO $$ BEGIN
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT c.conname INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'payment_transactions'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%charge_context%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE payment_transactions DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_charge_context_check
    CHECK (charge_context IN ('booking_deposit', 'payment_plan_installment', 'supplement', 'insurance', 'optional_service', 'gift_card'));
  END;
END $$;

-- ============================================================
-- 3. payment_refunds: add 'conekta' and 'openpay' to processor CHECK + refund fee column
-- ============================================================

DO $$ BEGIN
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT c.conname INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'payment_refunds'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%payment_processor%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE payment_refunds DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE payment_refunds
    ADD CONSTRAINT payment_refunds_payment_processor_check
    CHECK (payment_processor IN ('stripe', 'paypal', 'mercadopago', 'conekta', 'openpay'));
  END;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_refunds' AND column_name = 'processor_refund_fee'
  ) THEN
    ALTER TABLE payment_refunds ADD COLUMN processor_refund_fee numeric(10,2) DEFAULT 0;
  END IF;
END $$;

-- ============================================================
-- 4. bookings: add 'openpay' to payment_provider CHECK
-- ============================================================

DO $$ BEGIN
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT c.conname INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'bookings'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%payment_provider%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE bookings DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_provider_check
    CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal', 'conekta', 'openpay'));
  END;
END $$;

-- ============================================================
-- 5. gift_cards: add 'openpay' to payment_provider CHECK
-- ============================================================

DO $$ BEGIN
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT c.conname INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'gift_cards'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%payment_provider%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE gift_cards DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE gift_cards
    ADD CONSTRAINT gift_cards_payment_provider_check
    CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal', 'conekta', 'openpay'));
  END;
END $$;

-- ============================================================
-- 6. Rewrite create_accounting_entry_for_booking with real processor fees
-- ============================================================

CREATE OR REPLACE FUNCTION create_accounting_entry_for_booking(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_cfdi_uuid text;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_deposit numeric;
  v_service_charge numeric;
  v_total_received numeric;
  v_tx record;
  v_processor_fee_total numeric;
  v_fee_base numeric;
  v_fee_iva numeric;
  v_net_to_bank numeric;
  v_line_number integer;
  v_settings record;
  v_is_wallet_payment boolean;
BEGIN
  -- Verificar que no exista ya una poliza para este booking
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'booking' AND source_id = p_booking_id
      AND entry_type = 'ingreso'
  ) THEN
    RETURN NULL;
  END IF;

  -- Obtener datos del booking
  SELECT b.*, t.name AS tour_name, u.full_name AS traveler_name
  INTO v_booking
  FROM bookings b
  LEFT JOIN tours t ON t.id = b.tour_id
  LEFT JOIN users u ON u.id = b.user_id
  WHERE b.id = p_booking_id
    AND b.payment_status = 'succeeded';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Obtener UUID del CFDI si existe
  SELECT uuid_fiscal INTO v_cfdi_uuid
  FROM cfdi_invoices
  WHERE booking_id = p_booking_id AND status = 'stamped'
  LIMIT 1;

  v_deposit := COALESCE(v_booking.deposit_amount, v_booking.total_price, 0);
  v_service_charge := COALESCE(v_booking.service_charge, 0);
  v_total_received := v_deposit + v_service_charge;

  -- Obtener la transaccion de pago mas reciente exitosa para este booking
  SELECT * INTO v_tx
  FROM payment_transactions
  WHERE booking_id = p_booking_id
    AND status = 'succeeded'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Determinar si el pago fue via wallet (sin procesador externo)
  v_is_wallet_payment := v_tx.payment_processor IS NULL
    OR v_tx.payment_processor = 'toursred_cash'
    OR v_tx.charge_context = 'wallet_topup';

  -- Calcular comision del procesador
  v_processor_fee_total := 0;
  v_fee_base := 0;
  v_fee_iva := 0;

  IF NOT v_is_wallet_payment AND v_tx.payment_processor IS NOT NULL THEN
    -- Si ya tenemos el fee desglosado (Openpay lo guarda asi)
    IF v_tx.processor_fee_base IS NOT NULL THEN
      v_fee_base := v_tx.processor_fee_base;
      v_fee_iva := COALESCE(v_tx.processor_fee_iva, 0);
      v_processor_fee_total := v_fee_base + v_fee_iva;
    ELSIF v_tx.processor_fee IS NOT NULL AND v_tx.processor_fee > 0 THEN
      -- Fee total conocido pero sin desglose (Stripe, PayPal, MercadoPago, Conekta)
      -- Separar IVA: base = fee / 1.16, iva = fee - base
      v_fee_base := ROUND(v_tx.processor_fee / 1.16, 2);
      v_fee_iva := v_tx.processor_fee - v_fee_base;
      v_processor_fee_total := v_tx.processor_fee;
    ELSE
      -- Fallback: calcular con porcentajes de platform_settings
      SELECT * INTO v_settings FROM platform_settings LIMIT 1;

      IF v_settings IS NOT NULL THEN
        CASE v_tx.payment_processor
          WHEN 'stripe' THEN
            v_processor_fee_total := ROUND((v_total_received * COALESCE(v_settings.stripe_commission_pct, 3.1034) / 100) + COALESCE(v_settings.stripe_commission_fixed, 2.5862), 2);
          WHEN 'paypal' THEN
            v_processor_fee_total := ROUND((v_total_received * COALESCE(v_settings.paypal_commission_pct, 3.95) / 100) + COALESCE(v_settings.paypal_commission_fixed, 4.0), 2);
          WHEN 'mercadopago' THEN
            v_processor_fee_total := ROUND((v_total_received * COALESCE(v_settings.mercadopago_commission_pct, 3.49) / 100) + COALESCE(v_settings.mercadopago_commission_fixed, 4.0), 2);
          WHEN 'conekta' THEN
            v_processor_fee_total := ROUND((v_total_received * COALESCE(v_settings.conekta_commission_pct, 3.29) / 100) + COALESCE(v_settings.conekta_commission_fixed, 2.5), 2);
          WHEN 'openpay' THEN
            v_processor_fee_total := ROUND((v_total_received * COALESCE(v_settings.openpay_commission_pct, 2.9) / 100) + COALESCE(v_settings.openpay_commission_fixed, 0), 2);
          ELSE
            v_processor_fee_total := 0;
        END CASE;

        IF v_processor_fee_total > 0 THEN
          v_fee_base := ROUND(v_processor_fee_total / 1.16, 2);
          v_fee_iva := v_processor_fee_total - v_fee_base;
        END IF;
      END IF;
    END IF;
  END IF;

  v_net_to_bank := v_total_received - v_processor_fee_total;

  v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;

  v_entry_number := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  )
  VALUES (
    v_entry_number,
    'ingreso',
    COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
    v_year,
    v_month,
    'Anticipo reserva ' || COALESCE(v_booking.booking_code, p_booking_id::text) ||
      ' — ' || COALESCE(v_booking.tour_name, 'Tour'),
    'booking',
    p_booking_id,
    true
  )
  RETURNING id INTO v_entry_id;

  v_line_number := 1;

  -- Linea 1: Debito Bancos (entra el dinero NETO despues de comision del procesador)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_number, '102',
    'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, '') ||
    CASE WHEN v_processor_fee_total > 0 THEN ' (neto tras comision pasarela)' ELSE '' END,
    v_net_to_bank, 0, v_cfdi_uuid);
  v_line_number := v_line_number + 1;

  -- Linea 2: Debito Comisiones bancarias (base sin IVA)
  IF v_fee_base > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_number, '604',
      'Comision pasarela ' || COALESCE(v_tx.payment_processor, '') || ' — reserva ' || COALESCE(v_booking.booking_code, ''),
      v_fee_base, 0, v_cfdi_uuid);
    v_line_number := v_line_number + 1;
  END IF;

  -- Linea 3: Debito IVA Acreditable (IVA de la comision)
  IF v_fee_iva > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_number, '108',
      'IVA acreditable comision pasarela ' || COALESCE(v_tx.payment_processor, ''),
      v_fee_iva, 0, v_cfdi_uuid);
    v_line_number := v_line_number + 1;
  END IF;

  -- Linea 4: Credito Anticipos de clientes (pasivo)
  IF v_deposit > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_number, '208',
      'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''),
      0, v_deposit, v_cfdi_uuid);
    v_line_number := v_line_number + 1;
  END IF;

  -- Linea 5: Credito Ingresos por cargo de servicio
  IF v_service_charge > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_number, '402',
      'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''),
      0, v_service_charge, v_cfdi_uuid);
  END IF;

  RETURN v_entry_id;
END;
$$;

-- ============================================================
-- 7. Grant execute on the rewritten function
-- ============================================================
GRANT EXECUTE ON FUNCTION create_accounting_entry_for_booking(uuid) TO authenticated, service_role;
