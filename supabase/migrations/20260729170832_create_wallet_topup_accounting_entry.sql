/*
# Accounting Entry for Wallet Top-Ups (SPEI/CoDi)

## Purpose
Creates an accounting entry (póliza de ingreso) whenever a ToursRed Cash wallet
top-up is credited. Previously, wallet top-ups credited the balance but did not
generate a double-entry accounting record, leaving the books out of balance.

## 1. Constraint Changes
- `accounting_entries.source_type` CHECK constraint extended to include
  `'wallet_topup'` so the new source type is accepted.

## 2. New Function
- `create_accounting_entry_for_wallet_topup(p_topup_id uuid)`:
  - Idempotent: returns NULL if an entry already exists for the same topup.
  - Reads the topup from `openpay_wallet_topups` (must be status = 'completed').
  - Generates a two-line póliza:
    - Debe  102    — Bancos (cash received via SPEI/CoDi)
    - Haber 218-11 — ToursRed Cash / Monedero de Clientes (pasivo owed to user)
  - Returns the accounting_entries.id, or NULL if skipped.

## 3. Grants
- `service_role` only — matches the pattern of gift card accounting functions.
  Edge functions (which use the service key) can call it; the anon/authenticated
  client cannot invoke it directly.

## 4. Backfill
- Runs the function for every `openpay_wallet_topups` row with status =
  'completed' that does not yet have an accounting entry. This covers historical
  top-ups that were credited before the accounting integration existed.

## 5. Security
- No RLS changes. The function is SECURITY DEFINER with search_path = public.
- No new tables or columns.
*/

-- ── 1. Extend source_type constraint ──────────────────────────
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
    CHECK (source_type IN (
      'booking', 'payout', 'cancellation', 'manual', 'membership',
      'gift_card', 'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
      'featured_slot',
      'apertura', 'insurance_settlement', 'insurance_commission',
      'wallet_topup'
    ));

-- ── 2. Function: create_accounting_entry_for_wallet_topup ────
CREATE OR REPLACE FUNCTION create_accounting_entry_for_wallet_topup(p_topup_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup     record;
  v_entry_id  uuid;
  v_entry_num text;
  v_year      integer;
  v_month     integer;
BEGIN
  -- Idempotency: skip if an entry already exists for this topup
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'wallet_topup' AND source_id = p_topup_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id, amount, payment_method_type, credited_at, order_id
  INTO v_topup
  FROM openpay_wallet_topups
  WHERE id = p_topup_id
    AND status = 'completed';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_year  := EXTRACT(YEAR  FROM COALESCE(v_topup.credited_at, NOW()))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_topup.credited_at, NOW()))::integer;

  v_entry_num := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_num,
    'ingreso',
    COALESCE(v_topup.credited_at::date, CURRENT_DATE),
    v_year,
    v_month,
    'Recarga ToursRed Cash via ' || UPPER(v_topup.payment_method_type) || ' — Orden ' || v_topup.order_id,
    'wallet_topup',
    p_topup_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Debe: 102 Bancos (entra el efectivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (
    v_entry_id, 1, '102',
    'Cobro recarga ' || UPPER(v_topup.payment_method_type) || ' — ' || v_topup.order_id,
    v_topup.amount, 0
  );

  -- Haber: 218-11 ToursRed Cash / Monedero de Clientes (pasivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (
    v_entry_id, 2, '218-11',
    'Saldo monedero ToursRed Cash — ' || v_topup.order_id,
    0, v_topup.amount
  );

  RETURN v_entry_id;
END;
$$;

-- ── 3. Grants ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION create_accounting_entry_for_wallet_topup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_accounting_entry_for_wallet_topup(uuid) TO service_role;

-- ── 4. Backfill: create entries for already-completed topups ──
DO $$
DECLARE
  v_topup_id uuid;
  v_count    integer := 0;
BEGIN
  FOR v_topup_id IN
    SELECT t.id
    FROM openpay_wallet_topups t
    WHERE t.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'wallet_topup' AND ae.source_id = t.id
      )
  LOOP
    PERFORM create_accounting_entry_for_wallet_topup(v_topup_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: created % wallet topup accounting entries', v_count;
END $$;
