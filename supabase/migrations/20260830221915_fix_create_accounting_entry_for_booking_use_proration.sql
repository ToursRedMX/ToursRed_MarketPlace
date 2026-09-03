-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830221915
--   name:    fix_create_accounting_entry_for_booking_use_proration
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

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_booking(p_booking_id uuid)
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
v_deposit numeric;
v_service_charge numeric;
v_total_received numeric;
v_wallet_used numeric;
v_processor_charged_amount numeric;
v_tx record;
v_processor_fee_total numeric;
v_fee_base numeric;
v_fee_iva numeric;
v_net_to_bank numeric;
v_line_number integer;
v_settings record;
v_is_wallet_payment boolean;
BEGIN
-- Verificar que no exista ya una poliza para este booking
IF EXISTS (
SELECT 1 FROM accounting_entries
WHERE source_type = 'booking' AND source_id = p_booking_id
AND entry_type = 'ingreso'
) THEN
RETURN NULL;
END IF;

-- Obtener datos del booking
SELECT b.*, t.name AS tour_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS traveler_name
INTO v_booking
FROM bookings b
LEFT JOIN tours t ON t.id = b.tour_id
LEFT JOIN users u ON u.id = b.user_id
WHERE b.id = p_booking_id
AND b.payment_status = 'succeeded';

IF NOT FOUND THEN
RETURN NULL;
END IF;

-- Obtener UUID del CFDI si existe
SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = p_booking_id AND status = 'stamped'
LIMIT 1;

v_deposit := COALESCE(v_booking.deposit_amount, v_booking.total_price, 0);
v_service_charge := COALESCE(v_booking.service_charge, 0);
v_total_received := v_deposit + v_service_charge;

-- Prorrateo: cuanto del wallet usado en TODA la reserva (deposito+SC+extras+
-- seguro) le corresponde proporcionalmente a la porcion deposito+SC de esta
-- funcion. Reemplaza el tope crudo (LEAST contra v_total_received) de la
-- version anterior, que subestimaba el wallet aplicado aqui cuando tambien
-- se uso wallet para pagar seguro o extras de la misma reserva.
v_wallet_used := public.get_wallet_portion_for_booking_component(p_booking_id, v_total_received);
v_processor_charged_amount := v_total_received - v_wallet_used;

-- Obtener la transaccion de pago mas reciente exitosa para este booking
SELECT * INTO v_tx
FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
ORDER BY created_at DESC
LIMIT 1;

-- Determinar si el pago fue via wallet (sin procesador externo)
v_is_wallet_payment := v_tx.payment_processor IS NULL
OR v_tx.payment_processor = 'toursred_cash'
OR v_tx.charge_context = 'wallet_topup';

-- Calcular comision del procesador
v_processor_fee_total := 0;
v_fee_base := 0;
v_fee_iva := 0;

IF NOT v_is_wallet_payment AND v_tx.payment_processor IS NOT NULL AND v_processor_charged_amount > 0 THEN
IF v_tx.processor_fee_base IS NOT NULL THEN
v_fee_base := v_tx.processor_fee_base;
v_fee_iva := COALESCE(v_tx.processor_fee_iva, 0);
v_processor_fee_total := v_fee_base + v_fee_iva;
ELSIF v_tx.processor_fee IS NOT NULL AND v_tx.processor_fee > 0 THEN
v_fee_base := ROUND(v_tx.processor_fee / 1.16, 2);
v_fee_iva := v_tx.processor_fee - v_fee_base;
v_processor_fee_total := v_tx.processor_fee;
ELSE
SELECT * INTO v_settings FROM platform_settings LIMIT 1;

IF v_settings IS NOT NULL THEN
CASE v_tx.payment_processor
WHEN 'stripe' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.stripe_commission_pct, 3.1034) / 100) + COALESCE(v_settings.stripe_commission_fixed, 2.5862), 2);
WHEN 'paypal' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.paypal_commission_pct, 3.95) / 100) + COALESCE(v_settings.paypal_commission_fixed, 4.0), 2);
WHEN 'mercadopago' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.mercadopago_commission_pct, 3.49) / 100) + COALESCE(v_settings.mercadopago_commission_fixed, 4.0), 2);
WHEN 'conekta' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.conekta_commission_pct, 3.29) / 100) + COALESCE(v_settings.conekta_commission_fixed, 2.5), 2);
WHEN 'openpay' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.openpay_commission_pct, 2.9) / 100) + COALESCE(v_settings.openpay_commission_fixed, 0), 2);
ELSE
v_processor_fee_total := 0;
END CASE;

IF v_processor_fee_total > 0 THEN
v_fee_base := ROUND(v_processor_fee_total / 1.16, 2);
v_fee_iva := v_processor_fee_total - v_fee_base;
END IF;
END IF;
END IF;
END IF;

v_net_to_bank := v_processor_charged_amount - v_processor_fee_total;

v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;

v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
)
VALUES (
v_entry_number,
'ingreso',
COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
v_year,
v_month,
'Anticipo reserva ' || COALESCE(v_booking.booking_code, p_booking_id::text) ||
' — ' || COALESCE(v_booking.tour_name, 'Tour'),
'booking',
p_booking_id,
true
)
RETURNING id INTO v_entry_id;

v_line_number := 1;

IF v_net_to_bank > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102',
'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, '') ||
CASE WHEN v_processor_fee_total > 0 THEN ' (neto tras comision pasarela)' ELSE '' END ||
CASE WHEN v_wallet_used > 0 THEN ' (parcial, resto via ToursRed Cash)' ELSE '' END,
v_net_to_bank, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11',
'Aplicacion de saldo ToursRed Cash — reserva ' || COALESCE(v_booking.booking_code, ''),
v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_base > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '604',
'Comision pasarela ' || COALESCE(v_tx.payment_processor, '') || ' — reserva ' || COALESCE(v_booking.booking_code, ''),
v_fee_base, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_iva > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '108',
'IVA acreditable comision pasarela ' || COALESCE(v_tx.payment_processor, ''),
v_fee_iva, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_deposit > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208',
'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_deposit, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '402',
'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_service_charge, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$
;
