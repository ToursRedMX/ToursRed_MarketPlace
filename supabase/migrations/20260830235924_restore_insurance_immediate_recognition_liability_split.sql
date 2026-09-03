-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830235924
--   name:    restore_insurance_immediate_recognition_liability_split
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
v_insurance_price_per_unit numeric;
v_insurance_cost_per_unit numeric;
v_insurance_units numeric;
v_insurance_liability numeric;
v_insurance_income numeric;
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

-- RESTAURADO (30-ago-2026): esta funcion se creo el 13-ago diriendo TODO el
-- cobro de seguro a 208 (Anticipos de clientes), igual que un extra
-- cualquiera -- pero create_accounting_entry_for_tour_completion (extendida
-- en esa misma migracion) nunca la incluyo en el calculo de liberacion de
-- 208, asi que el dinero de seguro se quedaba atorado en esa cuenta para
-- siempre. Ademas, conceptualmente el seguro NO deberia diferirse como el
-- anticipo: la prima se le debe a la aseguradora (Universal Assistance)
-- desde el momento de la compra, independientemente de si el tour se
-- completa o se cancela -- no es un ingreso contingente al cumplimiento del
-- servicio como la comision de la agencia. El diseño original del 8-jul
-- (antes de la migracion del 13-ago que lo rompio) ya resolvia esto
-- correctamente: reconocer de inmediato, separando cuanto se le debe a la
-- aseguradora (201.01, pasivo) de cuanto se queda ToursRed como spread
-- (401.02, ingreso), usando la razon precio/costo por dia por viajero de
-- platform_settings. Se restaura esa logica, combinada con el prorrateo de
-- wallet agregado hoy (por si el seguro se pago parcial o totalmente con
-- saldo de ToursRed Cash).
SELECT travel_insurance_price_per_day_per_traveler, travel_insurance_cost_per_day_per_traveler
INTO v_insurance_price_per_unit, v_insurance_cost_per_unit
FROM platform_settings LIMIT 1;

v_insurance_price_per_unit := COALESCE(v_insurance_price_per_unit, 79.00);
v_insurance_cost_per_unit := COALESCE(v_insurance_cost_per_unit, 59.00);

IF v_insurance_price_per_unit > 0 THEN
v_insurance_units := v_insurance_cost / v_insurance_price_per_unit;
ELSE
v_insurance_units := 0;
END IF;

v_insurance_liability := ROUND(v_insurance_units * v_insurance_cost_per_unit, 2);
IF v_insurance_liability > v_insurance_cost THEN
v_insurance_liability := v_insurance_cost;
END IF;
v_insurance_income := v_insurance_cost - v_insurance_liability;

-- Prorrateo de wallet (ver get_wallet_portion_for_booking_component): si el
-- seguro se pago parcial o totalmente con saldo de monedero, esa parte no
-- entro como dinero nuevo al banco.
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

-- Crédito: Aseguradoras (201.01) — lo que se le debe a Universal Assistance
IF v_insurance_liability > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '201.01',
'Prima de seguro de viaje pendiente de liquidar a aseguradora — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_insurance_liability, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Ingresos por intermediacion de seguros (401.02) — spread de ToursRed
IF v_insurance_income > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '401.02',
'Spread por intermediacion de seguro de viaje — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_insurance_income, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$
;
