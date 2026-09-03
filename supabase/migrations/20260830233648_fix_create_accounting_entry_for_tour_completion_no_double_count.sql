-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830233648
--   name:    fix_create_accounting_entry_for_tour_completion_no_double_count
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

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_tour_completion(p_commission_record_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_cr record;
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_deposit numeric;
v_commission_total numeric;
v_agency_net numeric;
v_supp_net numeric := 0;
v_opt_net numeric := 0;
v_plan_net numeric := 0;
v_total_to_release numeric := 0;
v_line_num integer;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'booking'
AND ae.source_id = (SELECT booking_id FROM commission_records WHERE id = p_commission_record_id)
AND ae.description LIKE 'Devengamiento%'
) THEN
RETURN NULL;
END IF;

-- Refrescar primero para asegurar que commission_records refleje el estado
-- mas reciente de extras/suplementos antes de generar el asiento final.
SELECT booking_id INTO v_booking FROM commission_records WHERE id = p_commission_record_id;
IF FOUND THEN
PERFORM public.refresh_commission_record(v_booking.booking_id);
END IF;

SELECT cr.*, t.name AS tour_name, ag.name AS agency_name
INTO v_cr
FROM commission_records cr
LEFT JOIN tours t ON t.id = cr.tour_id
LEFT JOIN agencies ag ON ag.id = cr.agency_id
WHERE cr.id = p_commission_record_id;

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT * INTO v_booking FROM bookings WHERE id = v_cr.booking_id;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = v_cr.booking_id AND status = 'stamped'
LIMIT 1;

v_deposit := COALESCE(v_booking.deposit_amount, 0);

-- CORRECCION (30-ago-2026, junto con el fix de agency_net_tour en
-- calculate_booking_financial_breakdown): v_cr.agency_net_amount (via
-- agency_payout_total) YA INCLUYE el neto de suplementos y servicios
-- opcionales para la agencia. Las lineas 4-7 de la version anterior volvian
-- a acreditar ese mismo neto por separado -- doble conteo confirmado en
-- vivo (diferencia de $14,588.60 en una prueba con la reserva
-- TRG-EZQM8GFP37U). Ahora se usa agency_net_amount tal cual (ya neto de
-- todo) y v_commission_total agrega TODAS las comisiones de ToursRed
-- (tour + extras + suplementos + penalizaciones) en una sola linea de 401,
-- sin repetir montos que ya estan dentro de agency_net_amount.
v_commission_total := COALESCE(v_cr.agency_commission_amount, 0)
+ COALESCE(v_cr.optional_services_commission, 0)
+ COALESCE(v_cr.supplements_commission, 0)
+ COALESCE(v_cr.late_payment_penalty_commission, 0);

v_agency_net := COALESCE(v_cr.agency_net_amount, v_deposit - COALESCE(v_cr.agency_commission_amount, 0));

-- Neto acumulado en 208 de suplementos y servicios opcionales pagados
-- (para saber cuanto liberar del pasivo -- esto es independiente de cuanto
-- le corresponde a la agencia vs a ToursRed, solo es "cuanto entro a 208").
SELECT COALESCE(SUM(total_paid - COALESCE(service_charge, 0)), 0)
INTO v_supp_net
FROM booking_supplements
WHERE booking_id = v_cr.booking_id AND status = 'paid';

SELECT COALESCE(SUM(total_paid - COALESCE(service_charge, 0)), 0)
INTO v_opt_net
FROM booking_optional_services
WHERE booking_id = v_cr.booking_id AND paid_at IS NOT NULL AND is_cancelled = false;

SELECT COALESCE(SUM(total_charged - COALESCE(service_charge, 0)), 0)
INTO v_plan_net
FROM booking_payment_plan_transactions
WHERE booking_id = v_cr.booking_id AND status = 'succeeded';

-- Total a liberar de 208 = anticipo + extras netos + abonos netos
v_total_to_release := v_deposit + v_supp_net + v_opt_net + v_plan_net;

v_year := EXTRACT(YEAR FROM COALESCE(v_cr.tour_end_date, CURRENT_DATE))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_cr.tour_end_date, CURRENT_DATE))::integer;
v_entry_number := generate_entry_number('diario', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'diario',
COALESCE(v_cr.tour_end_date, CURRENT_DATE),
v_year, v_month,
'Devengamiento tour completado — ' || COALESCE(v_cr.tour_name, '') ||
' — Agencia: ' || COALESCE(v_cr.agency_name, ''),
'booking', v_cr.booking_id, true
) RETURNING id INTO v_entry_id;

v_line_num := 1;

-- Línea 1: Débito Anticipos de clientes (libera todo el pasivo acumulado en 208)
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '208',
'Liquidacion anticipo y extras devengados',
v_total_to_release, 0, v_cfdi_uuid);
v_line_num := v_line_num + 1;

-- Línea 2: Crédito Ingresos por comisiones (TODAS: tour + extras + suplementos + penalizaciones)
IF v_commission_total > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '401',
'Comision ToursRed por tour completado (incluye extras/suplementos/penalizaciones)', 0, v_commission_total, v_cfdi_uuid);
v_line_num := v_line_num + 1;
END IF;

-- Línea 3: Crédito CxP Agencias (neto total ya consolidado: deposito+extras+suplementos-comision)
IF v_agency_net > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '201',
'Por pagar a agencia ' || COALESCE(v_cr.agency_name, ''), 0, v_agency_net, v_cfdi_uuid);
v_line_num := v_line_num + 1;
ELSIF v_agency_net < 0 THEN
-- Si la comision (sobre precio de lista) supera el anticipo neto+extras,
-- la agencia le debe a ToursRed en vez de al reves. Se registra como
-- cuenta por cobrar en vez de como pasivo negativo.
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '106',
'Por cobrar a agencia (comision excede anticipo) ' || COALESCE(v_cr.agency_name, ''), ABS(v_agency_net), 0, v_cfdi_uuid);
v_line_num := v_line_num + 1;
END IF;

RETURN v_entry_id;
END;
$function$
;
