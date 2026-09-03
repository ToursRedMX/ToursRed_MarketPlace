-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830220015
--   name:    fix_create_accounting_entry_for_supplement_wallet_payment
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

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_supplement(p_supplement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_supp record;
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_net_amount numeric;
v_service_charge numeric;
v_commission numeric;
v_agency_net numeric;
v_tour_name text;
v_agency_name text;
v_debit_account_code text;
v_debit_description text;
BEGIN
-- Idempotencia: no duplicar
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'supplement' AND ae.source_id = p_supplement_id
) THEN
RETURN NULL;
END IF;

SELECT bs.*, t.name AS tour_name, ag.name AS agency_name
INTO v_supp
FROM booking_supplements bs
LEFT JOIN bookings b ON b.id = bs.booking_id
LEFT JOIN tours t ON t.id = b.tour_id
LEFT JOIN agencies ag ON ag.id = b.agency_id
WHERE bs.id = p_supplement_id AND bs.status = 'paid';

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT * INTO v_booking FROM bookings WHERE id = v_supp.booking_id;
IF NOT FOUND THEN RETURN NULL; END IF;

-- CFDI del suplemento si existe
SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_supplement_id = p_supplement_id AND status = 'stamped'
LIMIT 1;

v_net_amount := COALESCE(v_supp.total_paid, 0) - COALESCE(v_supp.service_charge, 0);
v_service_charge := COALESCE(v_supp.service_charge, 0);
v_commission := COALESCE(v_supp.supplement_commission, 0);
v_agency_net := v_net_amount - v_commission;

IF v_net_amount <= 0 THEN
RETURN NULL;
END IF;

-- Antes esta linea SIEMPRE debitaba 102 (Bancos) sin importar payment_method,
-- pero process-supplement-payment permite pagar suplementos con saldo de
-- ToursRed Cash (booking_supplements.payment_method = 'toursred_cash'). En
-- ese caso no entra dinero nuevo al banco -- se corrige igual que en
-- create_accounting_entry_for_booking, debitando el pasivo del monedero
-- (218-11) en vez de Bancos.
-- NOTA: payment_method = 'points' se deja SIN TOCAR por ahora -- no existe
-- una cuenta contable para Puntos en el catalogo (son promocionales, sin
-- respaldo de efectivo real a diferencia de ToursRed Cash), y decidir si un
-- canje de puntos debe registrarse como descuento/gasto de marketing o de
-- otra forma es una decision de criterio contable, no un hecho mecanico como
-- el caso de wallet. Pendiente de definir con el contador/Axel.
IF v_supp.payment_method = 'toursred_cash' THEN
v_debit_account_code := '218-11';
v_debit_description := 'Aplicacion de saldo ToursRed Cash — suplemento';
ELSE
v_debit_account_code := '102';
v_debit_description := 'Cobro suplemento viajero';
END IF;

v_year := EXTRACT(YEAR FROM COALESCE(v_supp.paid_at, CURRENT_TIMESTAMP))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_supp.paid_at, CURRENT_TIMESTAMP))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_supp.paid_at::date, CURRENT_DATE),
v_year, v_month,
'Suplemento pagado — ' || COALESCE(v_tour_name, v_supp.tour_name, '') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, v_supp.booking_id::text),
'supplement', p_supplement_id, true
) RETURNING id INTO v_entry_id;

-- Débito: Bancos, o ToursRed Cash si se pago con monedero
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 1, v_debit_account_code, v_debit_description, v_net_amount + v_service_charge, 0, v_cfdi_uuid);

-- Crédito: Ingreso por cargo de servicio (402)
IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 2, '402', 'Cargo de servicio — suplemento', 0, v_service_charge, v_cfdi_uuid);
END IF;

-- Crédito: Anticipos de clientes (208) — solo el neto, el service charge ya fue a 402
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 3, '208', 'Anticipo pendiente — suplemento', 0, v_net_amount, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$
;
