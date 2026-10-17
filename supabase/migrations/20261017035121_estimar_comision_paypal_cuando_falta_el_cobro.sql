-- Dos huecos encontrados probando un pago real de PayPal el 17-oct-2026:
--
-- 1. create_accounting_entry_for_booking nunca estimaba la comision de PayPal
--    aunque platform_settings.paypal_commission_pct/fixed (3.95% + $4.00) ya
--    existia para eso -- el mismo respaldo que ya usan stripe/mercadopago/
--    conekta/openpay. La causa: la funcion decidia "es pago con wallet, no
--    hay procesador" viendo si v_tx (la fila de payment_transactions) era
--    NULL. Pero v_tx puede ser NULL simplemente porque todavia no se
--    inserto -- el asiento contable se dispara (sync-booking-to-accounting)
--    muy poco despues de que la reserva pasa a 'succeeded', y en la carrera
--    con el INSERT de payment_transactions a veces gana el asiento. Medido
--    hoy: 2 de 2 reservas de PayPal probadas quedaron sin ninguna linea de
--    comision (604/108) ni la leyenda "(neto tras comision pasarela)".
--
--    v_processor_charged_amount YA es un indicador correcto e independiente
--    de v_tx (se calcula de deposit_amount/service_charge del booking menos
--    wallet/puntos via reparto_saldo_de_reserva) -- un pago cubierto 100% por
--    wallet/puntos siempre da 0 ahi, sin importar la carrera. El error estaba
--    en exigir TAMBIEN v_tx.payment_processor IS NOT NULL. Se quita esa
--    condicion y, para saber CUAL procesador estimar, se usa
--    COALESCE(v_tx.payment_processor, v_booking.payment_provider) --
--    bookings.payment_provider no sirve por si solo para decidir SI hubo
--    pasarela (se queda con el ultimo seleccionado en el selector aunque el
--    pago termine siendo 100% wallet/puntos, medido en la base: hay reservas
--    con user_payment=0 y payment_provider='stripe'), pero una vez que
--    v_processor_charged_amount > 0 ya prueba que SI se cobro algo a una
--    pasarela, y ahi si es la fuente correcta de cual.
--
--    Por el mismo motivo se sube el piso de 0 a 10 (MIN_PROCESSOR_AMOUNT, el
--    mismo umbral que ya usa el front en BookingFlowStep4.tsx): sin el
--    filtro de v_tx, un residuo de redondeo de centavos en un pago 100%
--    wallet ya no queda cubierto por "v_tx es NULL" y podria disparar una
--    estimacion de centavos.
--
-- 2. paypal-webhook, en PAYMENT.CAPTURE.COMPLETED, solo rellenaba
--    payment_transactions cuando la fila NO EXISTIA. Cuando la captura queda
--    en PENDING (normal: PayPal no manda seller_receivable_breakdown hasta
--    liquidar) se inserta con processor_fee=0, y cuando el COMPLETED real
--    llega despues, el codigo encontraba la fila y simplemente hacia `break`
--    -- la comision real nunca se escribia. Ni el punto 1 de arriba (que
--    estima una vez, al crear el asiento) ni el cron diario
--    asentar_comisiones_faltantes() (que solo corrige asientos YA
--    publicados comparando contra payment_transactions) pueden arreglar esto
--    despues: los dos dependen de que la fila tenga la comision real en
--    algun momento, y nada se la escribia. Medido: un cobro de PayPal de
--    julio-2026 sigue en comision $0 tres meses despues.
--
--    Se reusa asentarCobroPaypal (_shared/cobrosPaypal.ts), que ya tenia la
--    regla "solo rellena si la nueva es > 0 y la guardada es 0" -- nadie la
--    llamaba desde el camino de COMPLETED-sobre-fila-existente, solo desde
--    capture-paypal-order. Con esto, cuando la comision real llegue, se
--    escribe en payment_transactions, y el cron ya existente genera el
--    asiento de ajuste 604/108 si el original ya se publico sin ella --
--    exactamente lo que el cron se disenio para hacer (migracion
--    20260911030000).

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
v_points_used numeric;
v_reparto record;
v_processor_charged_amount numeric;
v_tx record;
v_processor_fee_total numeric;
v_fee_base numeric;
v_fee_iva numeric;
v_net_to_bank numeric;
v_line_number integer;
v_settings record;
v_is_wallet_payment boolean;
v_processor_name text;
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

-- Cuanto de deposito + cargo por servicio salio de puntos y cuanto de Cash
-- (reparto_saldo_de_reserva). Los puntos solo pudieron pagar el deposito, no el
-- cargo por servicio. Lo que queda es lo que cobro la pasarela.
v_reparto := public.reparto_saldo_de_reserva(p_booking_id, v_total_received, v_deposit);
v_wallet_used := v_reparto.cash;
v_points_used := v_reparto.puntos;
v_processor_charged_amount := GREATEST(0, v_total_received - v_wallet_used - v_points_used);

-- Obtener la transaccion de pago mas reciente exitosa para este booking
SELECT * INTO v_tx
FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
ORDER BY created_at DESC
LIMIT 1;

-- Determinar si el pago fue via wallet (sin procesador externo). NO se usa
-- v_tx.payment_processor IS NULL para esto: v_tx puede ser NULL solo porque
-- el INSERT de payment_transactions todavia no llega (carrera con el disparo
-- del asiento), no porque de verdad no haya pasarela. v_processor_charged_amount,
-- calculado arriba sin tocar v_tx, ya distingue correctamente un pago 100%
-- wallet/puntos (da 0) de uno con pasarela de por medio.
v_is_wallet_payment := COALESCE(v_tx.charge_context = 'wallet_topup', false);

-- Cual procesador: el de la transaccion si ya se encontro, si no el que
-- quedo guardado en la reserva (confiable aqui porque solo se usa DENTRO del
-- bloque que ya probo, con v_processor_charged_amount, que si hubo cobro de
-- pasarela -- bookings.payment_provider por si solo no basta, se queda con
-- el ultimo seleccionado en el selector aunque el pago termine siendo 100%
-- wallet/puntos).
v_processor_name := COALESCE(v_tx.payment_processor, v_booking.payment_provider);

-- Calcular comision del procesador
v_processor_fee_total := 0;
v_fee_base := 0;
v_fee_iva := 0;

-- El piso sube de 0 a 10 (MIN_PROCESSOR_AMOUNT, el mismo que ya usa el front
-- en BookingFlowStep4.tsx): sin el filtro de v_tx que habia antes, un
-- residuo de redondeo de centavos en un pago 100% wallet ya no queda
-- cubierto por "v_tx es NULL" y podria disparar una estimacion de centavos.
IF NOT v_is_wallet_payment AND v_processor_charged_amount >= 10 THEN
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
CASE v_processor_name
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

IF v_points_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '603',
'Descuento por ToursRed Points absorbido por ToursRed — reserva ' || COALESCE(v_booking.booking_code, ''),
v_points_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_base > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '604',
'Comision pasarela ' || COALESCE(v_processor_name, '') || ' — reserva ' || COALESCE(v_booking.booking_code, ''),
v_fee_base, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_iva > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '108',
'IVA acreditable comision pasarela ' || COALESCE(v_processor_name, ''),
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
$function$;
