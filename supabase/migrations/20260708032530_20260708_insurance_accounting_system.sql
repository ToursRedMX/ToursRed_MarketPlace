-- ============================================================
-- DOCUMENTACION: Estado de produccion al 2026-07-08
-- Todo el SQL a continuacion YA FUE aplicado directamente en
-- produccion. Esta migracion es idempotente y existe para que
-- el historial del repo coincida con el esquema real de la DB.
-- ============================================================

-- 1) Fix cuenta 401.02: nature invertida + jerarquia incorrecta
UPDATE chart_of_accounts
SET nature = 'acreedora', level = 4, parent_code = '401'
WHERE code = '401.02';

-- 2) Nueva cuenta de pasivo: 201.01 Aseguradoras
INSERT INTO chart_of_accounts (code, name, account_type, parent_code, level, nature, sat_group_code, is_system, is_active, description)
VALUES ('201.01', 'Aseguradoras', 'pasivo', '201', 4, 'acreedora', '201-01', false, true,
        'Monto retenido de viajeros pendiente de liquidar a aseguradoras (ej. Universal Assistance) por venta de seguros de viaje intermediados')
ON CONFLICT (code) DO NOTHING;

-- 3) Config de economics del seguro en platform_settings
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS travel_insurance_cost_per_day_per_traveler numeric DEFAULT 59.00,
  ADD COLUMN IF NOT EXISTS travel_insurance_commission_pct numeric DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS travel_insurance_provider_name text DEFAULT 'Universal Assistance';

UPDATE platform_settings
SET travel_insurance_cost_per_day_per_traveler = COALESCE(travel_insurance_cost_per_day_per_traveler, 59.00),
    travel_insurance_commission_pct = COALESCE(travel_insurance_commission_pct, 20.00),
    travel_insurance_provider_name = COALESCE(travel_insurance_provider_name, 'Universal Assistance');

-- 4) Fix create_accounting_entry_for_booking: separar cobro de seguro
--    en pasivo (lo que se debe a la aseguradora) e ingreso (solo el spread)
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
v_insurance_cost numeric;
v_membership_cost numeric;
v_total_received numeric;
v_line_num integer;
v_insurance_price_per_unit numeric;
v_insurance_cost_per_unit numeric;
v_insurance_units numeric;
v_insurance_liability numeric;
v_insurance_income numeric;
BEGIN
IF EXISTS (
  SELECT 1 FROM accounting_entries
  WHERE source_type = 'booking' AND source_id = p_booking_id
  AND entry_type = 'ingreso'
) THEN
  RETURN NULL;
END IF;

SELECT b.*,
  t.name AS tour_name,
  TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS traveler_name
INTO v_booking
FROM bookings b
LEFT JOIN tours t ON t.id = b.tour_id
LEFT JOIN users u ON u.id = b.user_id
WHERE b.id = p_booking_id
AND b.payment_status = 'succeeded';

IF NOT FOUND THEN
  RETURN NULL;
END IF;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = p_booking_id AND status = 'stamped'
LIMIT 1;

v_deposit        := COALESCE(v_booking.deposit_amount, v_booking.total_price, 0);
v_service_charge := COALESCE(v_booking.service_charge, 0);
v_insurance_cost := COALESCE(v_booking.travel_insurance_cost, 0);
v_membership_cost := CASE
  WHEN COALESCE(v_booking.membership_purchased, false) = true
  THEN COALESCE(v_booking.membership_cost::numeric, 0)
  ELSE 0
END;
v_total_received := v_deposit + v_service_charge + v_insurance_cost + v_membership_cost;

v_insurance_liability := 0;
v_insurance_income := 0;

IF v_insurance_cost > 0 THEN
  SELECT travel_insurance_price_per_day_per_traveler, travel_insurance_cost_per_day_per_traveler
  INTO v_insurance_price_per_unit, v_insurance_cost_per_unit
  FROM platform_settings LIMIT 1;

  v_insurance_price_per_unit := COALESCE(v_insurance_price_per_unit, 79.00);
  v_insurance_cost_per_unit  := COALESCE(v_insurance_cost_per_unit, 59.00);

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
END IF;

v_year  := EXTRACT(YEAR  FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;

v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
  entry_number, entry_type, entry_date, period_year, period_month,
  description, source_type, source_id, is_posted
)
VALUES (
  v_entry_number, 'ingreso',
  COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
  v_year, v_month,
  'Anticipo reserva ' || COALESCE(v_booking.booking_code, p_booking_id::text) ||
  ' — ' || COALESCE(v_booking.tour_name, 'Tour'),
  'booking', p_booking_id, true
)
RETURNING id INTO v_entry_id;

v_line_num := 1;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '102',
  'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, ''),
  v_total_received, 0, v_cfdi_uuid);
v_line_num := v_line_num + 1;

IF v_deposit > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '208',
    'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_deposit, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

IF v_service_charge > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '402',
    'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_service_charge, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

IF v_insurance_liability > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '201.01',
    'Prima de seguro de viaje pendiente de liquidar a aseguradora — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_insurance_liability, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

IF v_insurance_income > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '401.02',
    'Spread por intermediacion de seguro de viaje — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_insurance_income, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

IF v_membership_cost > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '403',
    'Membresia ToursRed Plus (' || COALESCE(v_booking.membership_plan, 'monthly') || ') — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_membership_cost, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$;

-- 5) Tabla de liquidaciones a la aseguradora (Flujo B)
CREATE TABLE IF NOT EXISTS insurance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL DEFAULT 'Universal Assistance',
  period_start date,
  period_end date,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE insurance_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_settlements_admin_all" ON insurance_settlements;
CREATE POLICY "insurance_settlements_admin_all" ON insurance_settlements
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin','accountant')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_settlement(p_settlement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
v_settlement record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF v_caller_role NOT IN ('admin', 'super_admin') THEN
  RAISE EXCEPTION 'Unauthorized';
END IF;

IF EXISTS (SELECT 1 FROM accounting_entries WHERE source_type = 'insurance_settlement' AND source_id = p_settlement_id) THEN
  RETURN NULL;
END IF;

SELECT * INTO v_settlement FROM insurance_settlements WHERE id = p_settlement_id AND status = 'completed';
IF NOT FOUND THEN
  RETURN NULL;
END IF;

v_year := EXTRACT(YEAR FROM v_settlement.payment_date)::integer;
v_month := EXTRACT(MONTH FROM v_settlement.payment_date)::integer;
v_entry_number := generate_entry_number('egreso', v_year, v_month);

INSERT INTO accounting_entries (entry_number, entry_type, entry_date, period_year, period_month, description, source_type, source_id, is_posted)
VALUES (v_entry_number, 'egreso', v_settlement.payment_date, v_year, v_month,
        'Liquidacion prima de seguros a ' || v_settlement.provider_name || COALESCE(' — ' || v_settlement.reference, ''),
        'insurance_settlement', p_settlement_id, true)
RETURNING id INTO v_entry_id;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 1, '201.01', 'Pago a ' || v_settlement.provider_name, v_settlement.amount, 0);

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 2, '102', 'Transferencia — liquidacion seguro ' || COALESCE(v_settlement.reference, ''), 0, v_settlement.amount);

RETURN v_entry_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_accounting_entry_for_insurance_settlement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_settlement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_insurance_settlement_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public.create_accounting_entry_for_insurance_settlement(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_insurance_settlement_completed ON insurance_settlements;
CREATE TRIGGER trg_insurance_settlement_completed
AFTER UPDATE ON insurance_settlements
FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_settlement_completed();

-- 6) Tabla de comisiones recibidas de la aseguradora (Flujo C)
CREATE TABLE IF NOT EXISTS insurance_commission_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL DEFAULT 'Universal Assistance',
  period_start date,
  period_end date,
  amount numeric NOT NULL CHECK (amount > 0),
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  invoice_reference text,
  cfdi_uuid text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE insurance_commission_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_commission_receipts_admin_all" ON insurance_commission_receipts;
CREATE POLICY "insurance_commission_receipts_admin_all" ON insurance_commission_receipts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin','accountant')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_commission(p_receipt_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
v_receipt record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF v_caller_role NOT IN ('admin', 'super_admin') THEN
  RAISE EXCEPTION 'Unauthorized';
END IF;

IF EXISTS (SELECT 1 FROM accounting_entries WHERE source_type = 'insurance_commission' AND source_id = p_receipt_id) THEN
  RETURN NULL;
END IF;

SELECT * INTO v_receipt FROM insurance_commission_receipts WHERE id = p_receipt_id AND status = 'completed';
IF NOT FOUND THEN
  RETURN NULL;
END IF;

v_year := EXTRACT(YEAR FROM v_receipt.receipt_date)::integer;
v_month := EXTRACT(MONTH FROM v_receipt.receipt_date)::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (entry_number, entry_type, entry_date, period_year, period_month, description, source_type, source_id, is_posted)
VALUES (v_entry_number, 'ingreso', v_receipt.receipt_date, v_year, v_month,
        'Comision de ' || v_receipt.provider_name || ' por venta de seguros' || COALESCE(' — ' || v_receipt.invoice_reference, ''),
        'insurance_commission', p_receipt_id, true)
RETURNING id INTO v_entry_id;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 1, '102', 'Comision recibida de ' || v_receipt.provider_name, v_receipt.amount, 0, v_receipt.cfdi_uuid);

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, 2, '401.02', 'Comision aseguradora — ' || COALESCE(v_receipt.invoice_reference, ''), 0, v_receipt.amount, v_receipt.cfdi_uuid);

RETURN v_entry_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_accounting_entry_for_insurance_commission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_commission(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_insurance_commission_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public.create_accounting_entry_for_insurance_commission(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_insurance_commission_completed ON insurance_commission_receipts;
CREATE TRIGGER trg_insurance_commission_completed
AFTER UPDATE ON insurance_commission_receipts
FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_commission_completed();

-- Fix source_type constraint to allow new insurance types
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type IN ('booking', 'payout', 'cancellation', 'manual', 'membership', 'gift_card', 'apertura', 'insurance_settlement', 'insurance_commission'));
