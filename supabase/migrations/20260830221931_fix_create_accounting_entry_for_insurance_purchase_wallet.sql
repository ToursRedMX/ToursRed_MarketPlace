-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830221931
--   name:    fix_create_accounting_entry_for_insurance_purchase_wallet
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

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_purchase(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_insurance_cost numeric;
v_wallet_used numeric;
v_bank_portion numeric;
v_line_number integer;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'insurance' AND ae.source_id = p_booking_id
) THEN
RETURN NULL;
END IF;

SELECT b.*, t.name AS tour_name
INTO v_booking
FROM bookings b
LEFT JOIN tours t ON t.id = b.tour_id
WHERE b.id = p_booking_id
AND b.travel_insurance_included = true
AND COALESCE(b.travel_insurance_cost, 0) > 0;

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = p_booking_id AND invoice_type = 'insurance' AND status = 'stamped'
LIMIT 1;

v_insurance_cost := COALESCE(v_booking.travel_insurance_cost, 0);

-- Prorrateo del wallet usado en la reserva completa hacia la porcion de
-- seguro. Ver get_wallet_portion_for_booking_component para el detalle.
v_wallet_used := public.get_wallet_portion_for_booking_component(p_booking_id, v_insurance_cost);
v_bank_portion := v_insurance_cost - v_wallet_used;

v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
v_year, v_month,
'Seguro de viaje — ' || COALESCE(v_booking.tour_name, '') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, p_booking_id::text),
'insurance', p_booking_id, true
) RETURNING id INTO v_entry_id;

v_line_number := 1;

-- Débito: Bancos (solo la parte que realmente entro via procesador)
IF v_bank_portion > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102', 'Cobro seguro de viaje viajero', v_bank_portion, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Débito: ToursRed Cash por la parte pagada con monedero
IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11', 'Aplicacion de saldo ToursRed Cash — seguro de viaje', v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Anticipos de clientes (208) — se difiere hasta devengamiento
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208', 'Anticipo pendiente — seguro de viaje', 0, v_insurance_cost, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$
;
