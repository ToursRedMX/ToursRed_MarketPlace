-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830222014
--   name:    cleanup_create_accounting_entry_for_optional_service
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

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_optional_service(p_bos_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_bos record;
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_net_amount numeric;
v_service_charge numeric;
v_total_amount numeric;
v_wallet_used numeric;
v_bank_portion numeric;
v_line_number integer;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'optional_service' AND ae.source_id = p_bos_id
) THEN
RETURN NULL;
END IF;

SELECT bos.*, t.name AS tour_name
INTO v_bos
FROM booking_optional_services bos
LEFT JOIN bookings b ON b.id = bos.booking_id
LEFT JOIN tours t ON t.id = b.tour_id
WHERE bos.id = p_bos_id AND bos.paid_at IS NOT NULL AND bos.is_cancelled = false;

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT * INTO v_booking FROM bookings WHERE id = v_bos.booking_id;
IF NOT FOUND THEN RETURN NULL; END IF;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_optional_service_id = p_bos_id AND status = 'stamped'
LIMIT 1;

v_net_amount := COALESCE(v_bos.total_paid, 0) - COALESCE(v_bos.service_charge, 0);
v_service_charge := COALESCE(v_bos.service_charge, 0);
v_total_amount := v_net_amount + v_service_charge;

IF v_net_amount <= 0 THEN
RETURN NULL;
END IF;

-- Si este extra tiene su propio payment_method (comprado post-reserva via
-- purchase-post-booking-extras), usamos ese flag exacto -- no hace falta
-- prorratear. Si es un extra capturado al momento de la reserva
-- (payment_method IS NULL), el wallet usado en la reserva pudo cubrir parte
-- de este extra junto con el deposito/seguro, asi que se prorratea via
-- get_wallet_portion_for_booking_component sobre el booking real.
IF v_bos.payment_method = 'toursred_cash' THEN
v_wallet_used := v_total_amount;
ELSIF v_bos.payment_method IS NULL THEN
v_wallet_used := public.get_wallet_portion_for_booking_component(v_bos.booking_id, v_total_amount);
ELSE
v_wallet_used := 0;
END IF;

v_bank_portion := v_total_amount - v_wallet_used;

v_year := EXTRACT(YEAR FROM COALESCE(v_bos.paid_at, CURRENT_TIMESTAMP))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_bos.paid_at, CURRENT_TIMESTAMP))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_bos.paid_at::date, CURRENT_DATE),
v_year, v_month,
'Servicio opcional pagado — ' || COALESCE(v_bos.description, 'Servicio') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, v_bos.booking_id::text),
'optional_service', p_bos_id, true
) RETURNING id INTO v_entry_id;

v_line_number := 1;

IF v_bank_portion > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102', 'Cobro servicio opcional viajero', v_bank_portion, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11', 'Aplicacion de saldo ToursRed Cash — servicio opcional', v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '402', 'Cargo de servicio — servicio opcional', 0, v_service_charge, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208', 'Anticipo pendiente — servicio opcional', 0, v_net_amount, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$
;
