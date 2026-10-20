-- Pago de una reserva con "mas de un metodo" (19-oct-2026): contabilidad.
--
-- El viajero puede pagar el anticipo en dos cobros (p. ej. $350 por Stripe y
-- $200 por PayPal). Encontrado al revisar el asiento de ese caso contra el
-- codigo, no contra una reserva real (aun no hay una con dos cobros de
-- anticipo en la base):
--
-- 1. create_accounting_entry_for_booking se postea UNA vez, al confirmar, y
--    tomaba la comision solo de la ultima transaccion. La del primer abono se
--    perdia: la poliza cuadraba (debe = haber) pero Bancos 102 salia mayor que
--    lo realmente depositado y 604/108 menores. Patron 1 de CLAUDE.md: un
--    numero que cuadra puede ser falso.
--
-- 2. comisiones_no_asentadas (la red que corrige comisiones tardias con un
--    asiento de ajuste) unia el asiento contra CADA transaccion y comparaba la
--    comision de esa transaccion contra TODO lo asentado. Con dos cobros daria
--    un ajuste de mas, o una alerta falsa de "el libro tiene mas comision que
--    el cobro". Ahora agrega por asiento: suma la comision de todos los cobros
--    que le corresponden y compara contra lo asentado.
--
-- Con un solo cobro del anticipo (el 100% de los casos de hoy) el resultado es
-- identico al de antes.

CREATE OR REPLACE FUNCTION public.estimar_comision_pasarela(p_processor text, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
v_settings record;
BEGIN
IF p_amount IS NULL OR p_amount < 10 THEN
RETURN 0;
END IF;
SELECT * INTO v_settings FROM platform_settings LIMIT 1;
IF v_settings IS NULL THEN
RETURN 0;
END IF;
RETURN CASE p_processor
WHEN 'stripe' THEN ROUND((p_amount * COALESCE(v_settings.stripe_commission_pct, 3.1034) / 100) + COALESCE(v_settings.stripe_commission_fixed, 2.5862), 2)
WHEN 'paypal' THEN ROUND((p_amount * COALESCE(v_settings.paypal_commission_pct, 3.95) / 100) + COALESCE(v_settings.paypal_commission_fixed, 4.0), 2)
WHEN 'mercadopago' THEN ROUND((p_amount * COALESCE(v_settings.mercadopago_commission_pct, 3.49) / 100) + COALESCE(v_settings.mercadopago_commission_fixed, 4.0), 2)
WHEN 'conekta' THEN ROUND((p_amount * COALESCE(v_settings.conekta_commission_pct, 3.29) / 100) + COALESCE(v_settings.conekta_commission_fixed, 2.5), 2)
WHEN 'openpay' THEN ROUND((p_amount * COALESCE(v_settings.openpay_commission_pct, 2.9) / 100) + COALESCE(v_settings.openpay_commission_fixed, 0), 2)
ELSE 0
END;
END;
$function$;

REVOKE ALL ON FUNCTION public.estimar_comision_pasarela(text, numeric) FROM PUBLIC, anon, authenticated;

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
v_n_depositos integer;
v_dep record;
v_dep_base numeric;
v_dep_iva numeric;
v_dep_total numeric;
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
-- Pago con mas de un metodo (19-oct-2026): la poliza se asienta UNA vez, al
-- confirmar, y antes tomaba la comision de la ULTIMA transaccion nada mas: con
-- $350 por Stripe y $200 por PayPal quedaba solo la de PayPal y la del primer
-- abono se perdia (Bancos 102 sobrevaluado). Con dos o mas cobros del anticipo
-- se suma la comision de TODOS. Con uno solo se conserva la logica de siempre.
SELECT count(*) INTO v_n_depositos
FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
AND charge_context = 'booking_deposit';

IF NOT v_is_wallet_payment AND v_processor_charged_amount >= 10 AND v_n_depositos >= 2 THEN
v_fee_base := 0;
v_fee_iva := 0;
FOR v_dep IN
SELECT * FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
AND charge_context = 'booking_deposit'
ORDER BY created_at
LOOP
IF v_dep.processor_fee_base IS NOT NULL THEN
v_dep_base := v_dep.processor_fee_base;
v_dep_iva := COALESCE(v_dep.processor_fee_iva, 0);
ELSIF v_dep.processor_fee IS NOT NULL AND v_dep.processor_fee > 0 THEN
v_dep_base := ROUND(v_dep.processor_fee / 1.16, 2);
v_dep_iva := v_dep.processor_fee - v_dep_base;
ELSE
v_dep_total := public.estimar_comision_pasarela(v_dep.payment_processor, v_dep.amount);
v_dep_base := ROUND(v_dep_total / 1.16, 2);
v_dep_iva := v_dep_total - v_dep_base;
END IF;
v_fee_base := v_fee_base + v_dep_base;
v_fee_iva := v_fee_iva + v_dep_iva;
END LOOP;
v_processor_fee_total := v_fee_base + v_fee_iva;
SELECT string_agg(DISTINCT payment_processor, ' + ') INTO v_processor_name
FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
AND charge_context = 'booking_deposit';
ELSIF NOT v_is_wallet_payment AND v_processor_charged_amount >= 10 THEN
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

CREATE OR REPLACE FUNCTION public.comisiones_no_asentadas()
 RETURNS TABLE(entry_id uuid, entry_number text, entry_date date, source_type text, procesador text, base_real numeric, iva_real numeric, base_en_libros numeric, iva_en_libros numeric, d_base numeric, d_iva numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH mapeo AS (
    SELECT
      e.id AS entry_id, e.entry_number, e.entry_date, e.source_type,
      string_agg(DISTINCT coalesce(t.payment_processor, '(sin procesador)'), ' + ') AS procesador,
      -- La MISMA cascada de create_accounting_entry_for_booking. Sin el
      -- coalesce, MercadoPago y Conekta —que no guardan el desglose— dan 0 y
      -- el asiento correcto parece tener comision de mas.
      -- SUMA por asiento: un anticipo pagado con dos metodos tiene dos
      -- transacciones y UNA sola poliza.
      sum(coalesce(t.processor_fee_base, round(t.processor_fee / 1.16, 2))) AS base_real,
      sum(coalesce(t.processor_fee_iva,
               t.processor_fee - round(t.processor_fee / 1.16, 2)))     AS iva_real
    FROM public.accounting_entries e
    JOIN public.payment_transactions t
      -- Un asiento por transaccion, por charge_context. Mapear por «la mas
      -- reciente del booking» cuenta las mensualidades dos veces.
      ON  (e.source_type = 'booking'
           AND t.booking_id = e.source_id
           AND t.charge_context = 'booking_deposit')
       OR (e.source_type = 'payment_plan_installment'
           AND t.charge_reference_id = e.source_id
           AND t.charge_context = 'payment_plan_installment')
       OR (e.source_type = 'membership' AND t.id = e.source_id)
    WHERE t.status = 'succeeded'
      AND coalesce(t.processor_fee, 0) > 0
    GROUP BY e.id, e.entry_number, e.entry_date, e.source_type
  )
  SELECT
    m.entry_id, m.entry_number, m.entry_date, m.source_type, m.procesador,
    m.base_real, m.iva_real,
    coalesce(l.base, 0), coalesce(l.iva, 0),
    round(m.base_real - coalesce(l.base, 0), 2),
    round(m.iva_real  - coalesce(l.iva,  0), 2)
  FROM mapeo m
  LEFT JOIN LATERAL (
    -- Suma el asiento original MAS su ajuste, si ya se genero. Sin esto la
    -- funcion reportaria eternamente los huecos que ella misma cerro.
    SELECT round(sum(x.debit) FILTER (WHERE x.account_code = '604'), 2) AS base,
           round(sum(x.debit) FILTER (WHERE x.account_code = '108'), 2) AS iva
    FROM public.accounting_entry_lines x
    JOIN public.accounting_entries ae ON ae.id = x.entry_id
    WHERE ae.id = m.entry_id
       OR (ae.source_type = 'manual' AND ae.source_id = m.entry_id)
  ) l ON true
  WHERE abs(m.base_real - coalesce(l.base, 0)) > 0.01
     OR abs(m.iva_real  - coalesce(l.iva,  0)) > 0.01;
$function$;
