/*
# Crear 5 funciones contables para extras y extender tour_completion

## Propósito
Crear funciones SQL SECURITY DEFINER que generen asientos contables automáticos para:
1. Suplementos pagados (booking_supplements)
2. Servicios opcionales pagados (booking_optional_services)
3. Seguro de viaje pagado (bookings con travel_insurance)
4. Membresía pagada (payment_transactions de cobro de membresía)
5. Abonos de plan de pagos (booking_payment_plan_transactions)

Además, extender la función existente `create_accounting_entry_for_tour_completion`
para que libere de la cuenta 208 (Anticipos de clientes) no solo el deposit_amount
sino también los montos netos de suplementos, servicios opcionales y abonos de plan
de pagos que se acumularon en 208.

## Criterio contable
- Cargo de servicio (service_charge) → 402 (ingreso inmediato, ya registrado al momento del cobro)
- Monto neto (total_paid - service_charge) → 208 (pasivo, se difiere hasta devengamiento)
- Al completar el tour:
  - 208 se libera por el total neto (anticipo + extras + abonos)
  - 401 recibe la comisión de ToursRed (tour + suplementos + opcionales)
  - 201 recibe el neto a pagar a la agencia (tour + suplementos + opcionales + abonos 100%)

## Abonos de plan de pagos
Los abonos NO generan comisión adicional — la comisión del tour ya se calculó sobre
total_tour_price completo desde el anticipo. Por eso van 100% a 201 (CxP agencia),
sin pasar por 401.

## Funciones
1. create_accounting_entry_for_supplement(p_supplement_id uuid)
2. create_accounting_entry_for_optional_service(p_bos_id uuid)
3. create_accounting_entry_for_insurance_purchase(p_booking_id uuid)
4. create_accounting_entry_for_membership(p_payment_transaction_id uuid)
5. create_accounting_entry_for_payment_plan_installment(p_installment_tx_id uuid)

## Modificación
- create_accounting_entry_for_tour_completion: extender para liberar extras de 208

## Seguridad
- Todas las funciones son SECURITY DEFINER con search_path = 'public'
- Idempotentes: retornan NULL si ya existe el asiento
*/

-- ============================================================
-- 1. FUNCIÓN: create_accounting_entry_for_supplement
-- ============================================================
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

  -- Débito: Bancos (neto tras comisión pasarela ya descontada en el asiento del booking)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '102', 'Cobro suplemento viajero', v_net_amount + v_service_charge, 0, v_cfdi_uuid);

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
$function$;

-- ============================================================
-- 2. FUNCIÓN: create_accounting_entry_for_optional_service
-- ============================================================
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
  VALUES (v_entry_id, 1, '102', 'Cobro servicio opcional viajero', v_net_amount + v_service_charge, 0, v_cfdi_uuid);

  IF v_service_charge > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, 2, '402', 'Cargo de servicio — servicio opcional', 0, v_service_charge, v_cfdi_uuid);
  END IF;

  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 3, '208', 'Anticipo pendiente — servicio opcional', 0, v_net_amount, v_cfdi_uuid);

  RETURN v_entry_id;
END;
$function$;

-- ============================================================
-- 3. FUNCIÓN: create_accounting_entry_for_insurance_purchase
-- ============================================================
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

  -- Débito: Bancos
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '102', 'Cobro seguro de viaje viajero', v_insurance_cost, 0, v_cfdi_uuid);

  -- Crédito: Anticipos de clientes (208) — se difiere hasta devengamiento
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 2, '208', 'Anticipo pendiente — seguro de viaje', 0, v_insurance_cost, v_cfdi_uuid);

  RETURN v_entry_id;
END;
$function$;

-- ============================================================
-- 4. FUNCIÓN: create_accounting_entry_for_membership
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_membership(p_payment_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_membership record;
  v_user record;
  v_cfdi_uuid text;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_amount numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_entries ae
    WHERE ae.source_type = 'membership' AND ae.source_id = p_payment_transaction_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tx
  FROM payment_transactions
  WHERE id = p_payment_transaction_id AND status = 'succeeded'
    AND charge_context = 'membership';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT m.*, u.first_name, u.last_name INTO v_membership
  FROM memberships m
  LEFT JOIN users u ON u.id = m.user_id
  WHERE m.id = v_tx.charge_reference_id;

  v_amount := COALESCE(v_tx.amount, 0);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT uuid_fiscal INTO v_cfdi_uuid
  FROM cfdi_invoices
  WHERE membership_id = v_membership.id AND status = 'stamped'
  ORDER BY created_at DESC LIMIT 1;

  v_year := EXTRACT(YEAR FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_entry_number := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number, 'ingreso',
    COALESCE(v_tx.created_at::date, CURRENT_DATE),
    v_year, v_month,
    'Membresía ToursRed Plus — ' || COALESCE(v_membership.plan_type, '') ||
    ' — Usuario: ' || COALESCE(v_membership.first_name, '') || ' ' || COALESCE(v_membership.last_name, ''),
    'membership', p_payment_transaction_id, true
  ) RETURNING id INTO v_entry_id;

  -- Débito: Bancos
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '102', 'Cobro membresía ToursRed Plus', v_amount, 0, v_cfdi_uuid);

  -- Crédito: Ingresos por membresías (401)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 2, '401', 'Ingreso membresía — ' || COALESCE(v_membership.plan_type, ''), 0, v_amount, v_cfdi_uuid);

  RETURN v_entry_id;
END;
$function$;

-- ============================================================
-- 5. FUNCIÓN: create_accounting_entry_for_payment_plan_installment
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_payment_plan_installment(p_installment_tx_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_booking record;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_net_amount numeric;
  v_service_charge numeric;
  v_total_received numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_entries ae
    WHERE ae.source_type = 'payment_plan_installment' AND ae.source_id = p_installment_tx_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT bpt.*, b.booking_code, b.tour_id
  INTO v_tx
  FROM booking_payment_plan_transactions bpt
  LEFT JOIN bookings b ON b.id = bpt.booking_id
  WHERE bpt.id = p_installment_tx_id AND bpt.status = 'succeeded';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking FROM bookings WHERE id = v_tx.booking_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total_received := COALESCE(v_tx.total_charged, 0);
  v_service_charge := COALESCE(v_tx.service_charge, 0);
  v_net_amount := v_total_received - v_service_charge;

  IF v_net_amount <= 0 THEN
    RETURN NULL;
  END IF;

  v_year := EXTRACT(YEAR FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_entry_number := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number, 'ingreso',
    COALESCE(v_tx.created_at::date, CURRENT_DATE),
    v_year, v_month,
    'Abono plan de pagos — Reserva: ' || COALESCE(v_booking.booking_code, v_tx.booking_id::text),
    'payment_plan_installment', p_installment_tx_id, true
  ) RETURNING id INTO v_entry_id;

  -- Débito: Bancos
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '102', 'Cobro abono plan de pagos viajero', v_total_received, 0);

  -- Crédito: Ingreso por cargo de servicio (402) — inmediato
  IF v_service_charge > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
    VALUES (v_entry_id, 2, '402', 'Cargo de servicio — abono plan de pagos', 0, v_service_charge);
  END IF;

  -- Crédito: Anticipos de clientes (208) — el neto se difiere
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 3, '208', 'Anticipo pendiente — abono plan de pagos', 0, v_net_amount);

  RETURN v_entry_id;
END;
$function$;

-- ============================================================
-- 6. EXTENDER: create_accounting_entry_for_tour_completion
-- ============================================================
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
  v_commission numeric;
  v_agency_net numeric;
  v_supp_net numeric := 0;
  v_opt_net numeric := 0;
  v_plan_net numeric := 0;
  v_supp_commission numeric := 0;
  v_opt_commission numeric := 0;
  v_total_to_release numeric := 0;
  v_line_num integer;
BEGIN
  -- Verificar que no exista ya una poliza para este commission_record
  IF EXISTS (
    SELECT 1 FROM accounting_entries ae
    WHERE ae.source_type = 'booking'
    AND ae.source_id = (SELECT booking_id FROM commission_records WHERE id = p_commission_record_id)
    AND ae.description LIKE 'Devengamiento%'
  ) THEN
    RETURN NULL;
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

  v_deposit := COALESCE(v_booking.deposit_amount, v_booking.total_price, 0);
  v_commission := COALESCE(v_cr.agency_commission_amount, 0);
  v_agency_net := COALESCE(v_cr.agency_net_amount, v_deposit - v_commission);

  -- Neto acumulado en 208 de suplementos pagados (total_paid - service_charge)
  SELECT COALESCE(SUM(total_paid - COALESCE(service_charge, 0)), 0)
    INTO v_supp_net
  FROM booking_supplements
  WHERE booking_id = v_cr.booking_id AND status = 'paid';

  -- Neto acumulado en 208 de servicios opcionales pagados
  SELECT COALESCE(SUM(total_paid - COALESCE(service_charge, 0)), 0)
    INTO v_opt_net
  FROM booking_optional_services
  WHERE booking_id = v_cr.booking_id AND paid_at IS NOT NULL AND is_cancelled = false;

  -- Neto acumulado en 208 de abonos de plan de pagos
  SELECT COALESCE(SUM(total_charged - COALESCE(service_charge, 0)), 0)
    INTO v_plan_net
  FROM booking_payment_plan_transactions
  WHERE booking_id = v_cr.booking_id AND status = 'succeeded';

  -- Comisiones de ToursRed sobre suplementos y servicios opcionales
  SELECT COALESCE(SUM(supplement_commission), 0)
    INTO v_supp_commission
  FROM booking_supplements
  WHERE booking_id = v_cr.booking_id AND status = 'paid';

  SELECT COALESCE(SUM(agency_commission), 0)
    INTO v_opt_commission
  FROM booking_optional_services
  WHERE booking_id = v_cr.booking_id AND paid_at IS NOT NULL AND is_cancelled = false;

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

  -- Línea 2: Crédito Ingresos por comisiones propias (comisión del tour)
  IF v_commission > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '401',
      'Comision ToursRed por tour completado', 0, v_commission, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 3: Crédito CxP Agencias (neto del tour)
  IF v_agency_net > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '201',
      'Por pagar a agencia ' || COALESCE(v_cr.agency_name, ''), 0, v_agency_net, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 4: Crédito 401 — Comisión ToursRed por suplementos
  IF v_supp_commission > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '401',
      'Comision ToursRed por suplementos', 0, v_supp_commission, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 5: Crédito 201 — Neto a agencia por suplementos
  IF (v_supp_net - v_supp_commission) > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '201',
      'Por pagar a agencia (suplementos) — ' || COALESCE(v_cr.agency_name, ''),
      0, v_supp_net - v_supp_commission, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 6: Crédito 401 — Comisión ToursRed por servicios opcionales
  IF v_opt_commission > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '401',
      'Comision ToursRed por servicios opcionales', 0, v_opt_commission, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 7: Crédito 201 — Neto a agencia por servicios opcionales
  IF (v_opt_net - v_opt_commission) > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '201',
      'Por pagar a agencia (servicios opcionales) — ' || COALESCE(v_cr.agency_name, ''),
      0, v_opt_net - v_opt_commission, v_cfdi_uuid);
    v_line_num := v_line_num + 1;
  END IF;

  -- Línea 8: Crédito 201 — Abonos de plan de pagos (100% a agencia, sin comisión adicional)
  IF v_plan_net > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line_num, '201',
      'Por pagar a agencia (abonos plan de pagos) — ' || COALESCE(v_cr.agency_name, ''),
      0, v_plan_net, v_cfdi_uuid);
  END IF;

  RETURN v_entry_id;
END;
$function$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_supplement(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_optional_service(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_purchase(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_membership(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_payment_plan_installment(uuid) TO authenticated, service_role;
