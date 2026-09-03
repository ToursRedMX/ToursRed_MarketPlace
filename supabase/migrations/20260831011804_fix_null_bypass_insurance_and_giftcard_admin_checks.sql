-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831011804
--   name:    fix_null_bypass_insurance_and_giftcard_admin_checks
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_settlement(p_settlement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
v_settlement record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized';
END IF;

IF EXISTS (SELECT 1 FROM accounting_entries WHERE source_type = 'insurance_settlement' AND source_id = p_settlement_id) THEN
RETURN NULL;
END IF;

SELECT * INTO v_settlement FROM insurance_settlements WHERE id = p_settlement_id AND status = 'completed';
IF NOT FOUND THEN
RETURN NULL;
END IF;

v_year := EXTRACT(YEAR FROM v_settlement.payment_date)::integer;
v_month := EXTRACT(MONTH FROM v_settlement.payment_date)::integer;
v_entry_number := generate_entry_number('egreso', v_year, v_month);

INSERT INTO accounting_entries (entry_number, entry_type, entry_date, period_year, period_month, description, source_type, source_id, is_posted)
VALUES (v_entry_number, 'egreso', v_settlement.payment_date, v_year, v_month,
'Liquidacion prima de seguros a ' || v_settlement.provider_name || COALESCE(' — ' || v_settlement.reference, ''),
'insurance_settlement', p_settlement_id, true)
RETURNING id INTO v_entry_id;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 1, '201.01', 'Pago a ' || v_settlement.provider_name, v_settlement.amount, 0);

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 2, '102', 'Transferencia — liquidacion seguro ' || COALESCE(v_settlement.reference, ''), 0, v_settlement.amount);

RETURN v_entry_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_commission(p_receipt_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
v_receipt record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized';
END IF;

IF EXISTS (SELECT 1 FROM accounting_entries WHERE source_type = 'insurance_commission' AND source_id = p_receipt_id) THEN
RETURN NULL;
END IF;

SELECT * INTO v_receipt FROM insurance_commission_receipts WHERE id = p_receipt_id AND status = 'completed';
IF NOT FOUND THEN
RETURN NULL;
END IF;

v_year := EXTRACT(YEAR FROM v_receipt.receipt_date)::integer;
v_month := EXTRACT(MONTH FROM v_receipt.receipt_date)::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (entry_number, entry_type, entry_date, period_year, period_month, description, source_type, source_id, is_posted)
VALUES (v_entry_number, 'ingreso', v_receipt.receipt_date, v_year, v_month,
'Comision de ' || v_receipt.provider_name || ' por venta de seguros' || COALESCE(' — ' || v_receipt.invoice_reference, ''),
'insurance_commission', p_receipt_id, true)
RETURNING id INTO v_entry_id;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 1, '102', 'Comision recibida de ' || v_receipt.provider_name, v_receipt.amount, 0, v_receipt.cfdi_uuid);

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 2, '401.02', 'Comision aseguradora — ' || COALESCE(v_receipt.invoice_reference, ''), 0, v_receipt.amount, v_receipt.cfdi_uuid);

RETURN v_entry_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_gift_card_accounting_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role       text;
v_pending_balance   numeric := 0;
v_sold_count        integer := 0;
v_redeemed_count    integer := 0;
v_expired_count     integer := 0;
v_expiration_income numeric := 0;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin', 'accountant') THEN
RAISE EXCEPTION 'Unauthorized';
END IF;

SELECT COALESCE(SUM(l.credit - l.debit), 0)
INTO v_pending_balance
FROM accounting_entry_lines l
WHERE l.account_code = '218-12';

SELECT COUNT(*) INTO v_sold_count
FROM accounting_entries WHERE source_type = 'gift_card_sale';

SELECT COUNT(*) INTO v_redeemed_count
FROM accounting_entries WHERE source_type = 'gift_card_redemption';

SELECT COUNT(*) INTO v_expired_count
FROM gift_cards WHERE status = 'expired';

SELECT COALESCE(SUM(l.credit), 0)
INTO v_expiration_income
FROM accounting_entry_lines l
JOIN accounting_entries ae ON ae.id = l.entry_id
WHERE l.account_code = '4090'
AND ae.source_type = 'gift_card_expiration';

RETURN jsonb_build_object(
'pending_balance',   v_pending_balance,
'sold_count',        v_sold_count,
'redeemed_count',    v_redeemed_count,
'expired_count',     v_expired_count,
'expiration_income', v_expiration_income
);
END;
$function$
;
