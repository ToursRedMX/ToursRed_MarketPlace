-- create_accounting_entry_for_payout no incluye el numero de factura del
-- proveedor (agency_payouts.bill_number) en la descripcion del asiento.
--
-- ============================================================================
-- COMO SE ENCONTRO
-- ============================================================================
--
-- Revisando sync-payout-to-accounting (Edge Function) para una limpieza de
-- eslint: calcula billNumber = payout.bill_number con un comentario que dice
-- "conservada para trazabilidad del payout", pero nunca lo manda en el body
-- que le pasa a sync-to-accounting.
--
-- Al revisar sync-to-accounting se confirma que esto no importa donde se
-- creyo: esa funcion ignora casi todo el "data" que le llega para payouts
-- -solo lee journal_type (para elegir el RPC) y total/reference (para el
-- log de accounting_sync_log)-. El asiento real lo arma
-- create_accounting_entry_for_payout(p_payout_id), que vuelve a leer la fila
-- completa de agency_payouts por su cuenta (`SELECT ap.* INTO v_payout`).
--
-- O sea: el dato SI esta disponible dentro de la funcion (v_payout.bill_number),
-- simplemente no se usa en la descripcion del asiento, a diferencia de
-- payout_code, que si se incluye.
--
-- ============================================================================
-- EL FIX
-- ============================================================================
--
-- Agrega el numero de factura a la descripcion cuando existe, mismo patron
-- que ya usa payout_code. No cambia el resto de la funcion.
--
-- Cuerpo tomado de pg_get_functiondef sobre la base viva (confirmado igual
-- al unico CREATE del repo para esta funcion).

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_payout(p_payout_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_payout record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_net numeric;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries
WHERE source_type = 'payout' AND source_id = p_payout_id
) THEN
RETURN NULL;
END IF;

SELECT ap.*, ag.name AS agency_name
INTO v_payout
FROM agency_payouts ap
LEFT JOIN agencies ag ON ag.id = ap.agency_id
WHERE ap.id = p_payout_id AND ap.status = 'completed';

IF NOT FOUND THEN
RETURN NULL;
END IF;

v_net := COALESCE(v_payout.net_amount, v_payout.amount, 0);

v_year := EXTRACT(YEAR FROM COALESCE(v_payout.payment_date, CURRENT_DATE))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_payout.payment_date, CURRENT_DATE))::integer;

v_entry_number := generate_entry_number('egreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
)
VALUES (
v_entry_number,
'egreso',
COALESCE(v_payout.payment_date, CURRENT_DATE),
v_year,
v_month,
'Pago a agencia ' || COALESCE(v_payout.agency_name, '') ||
' — ' || COALESCE(v_payout.payout_code, '') ||
CASE WHEN v_payout.bill_number IS NOT NULL AND v_payout.bill_number <> ''
     THEN ' — Factura ' || v_payout.bill_number
     ELSE '' END,
'payout',
p_payout_id,
true
)
RETURNING id INTO v_entry_id;

-- Debito CxP Agencias (cancela el pasivo)
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 1, '201', 'Pago agencia ' || COALESCE(v_payout.agency_name, ''), v_net, 0);

-- Credito Bancos (sale el dinero)
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 2, '102', 'Transferencia bancaria — ' || COALESCE(v_payout.payout_code, ''), 0, v_net);

RETURN v_entry_id;
END;
$function$;
