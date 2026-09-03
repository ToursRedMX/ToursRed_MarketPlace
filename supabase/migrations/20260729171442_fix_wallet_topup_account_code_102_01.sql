/*
# Fix wallet topup accounting entry: use 102.01 instead of 102

## Purpose
The function `create_accounting_entry_for_wallet_topup` was using the generic
parent account '102' (Bancos) for the debit line. The correct account is
'102.01' (Cuenta bancaria - Transferencia SPEI), as agreed in the plan.

## 1. Function update
- `create_accounting_entry_for_wallet_topup`: debit line account_code changes
  from '102' to '102.01'.

## 2. Data fix
- Updates the existing `accounting_entry_lines` row(s) with account_code = '102'
  that belong to entries with source_type = 'wallet_topup' to account_code = '102.01'.
  This corrects the backfill-created entry without creating a duplicate.

## 3. Security
- No RLS or policy changes.
- No new tables or columns.
*/

-- ── 1. Recreate function with corrected account code ─────────
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

  -- Debe: 102.01 Cuenta bancaria - Transferencia SPEI (entra el efectivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (
    v_entry_id, 1, '102.01',
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

-- Re-apply grants
REVOKE ALL ON FUNCTION create_accounting_entry_for_wallet_topup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_accounting_entry_for_wallet_topup(uuid) TO service_role;

-- ── 2. Fix existing backfill-created entry line(s) ───────────
UPDATE accounting_entry_lines
SET account_code = '102.01'
WHERE account_code = '102'
  AND entry_id IN (
    SELECT id FROM accounting_entries WHERE source_type = 'wallet_topup'
  );
