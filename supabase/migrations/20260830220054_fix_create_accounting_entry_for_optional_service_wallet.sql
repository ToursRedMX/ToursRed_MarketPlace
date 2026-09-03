-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830220054
--   name:    fix_create_accounting_entry_for_optional_service_wallet
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
v_debit_account_code text;
v_debit_description text;
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

IF v_net_amount <= 0 THEN
RETURN NULL;
END IF;

-- Mismo bug que en create_accounting_entry_for_supplement: purchase-post-booking-extras
-- permite pagar servicios opcionales con saldo de ToursRed Cash
-- (booking_optional_services.payment_method = 'toursred_cash'), y esta funcion
-- siempre debitaba Bancos (102) sin importar el metodo. Se corrige igual.
-- 'points' se deja sin tocar por la misma razon documentada en el fix de
-- suplementos (no existe cuenta contable para Puntos, pendiente de definir).
IF v_bos.payment_method = 'toursred_cash' THEN
v_debit_account_code := '218-11';
v_debit_description := 'Aplicacion de saldo ToursRed Cash — servicio opcional';
ELSE
v_debit_account_code := '102';
v_debit_description := 'Cobro servicio opcional viajero';
END IF;

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

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 1, v_debit_account_code, v_debit_description, v_net_amount + v_service_charge, 0, v_cfdi_uuid);

IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 2, '402', 'Cargo de servicio — servicio opcional', 0, v_service_charge, v_cfdi_uuid);
END IF;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 3, '208', 'Anticipo pendiente — servicio opcional', 0, v_net_amount, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$
;
