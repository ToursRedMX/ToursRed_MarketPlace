-- 1. Agregar cuenta 401.02 al catalogo de cuentas
-- Copiar sat_group_code y otros campos requeridos de la cuenta padre 401
INSERT INTO chart_of_accounts (code, name, account_type, sat_group_code, is_active)
SELECT '401.02',
       'Ingresos por intermediacion de seguros de viaje',
       'ingreso',
       sat_group_code,
       true
FROM chart_of_accounts WHERE code = '401'
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  account_type = EXCLUDED.account_type,
  is_active = EXCLUDED.is_active;

-- 2. Actualizar RPC: seguro usa cuenta 401.02 en lugar de 405
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

-- Linea 1: Debito Bancos
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_num, '102',
  'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, ''),
  v_total_received, 0, v_cfdi_uuid);
v_line_num := v_line_num + 1;

-- Linea 2: Credito Anticipos de clientes (pasivo)
IF v_deposit > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '208',
    'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_deposit, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

-- Linea 3: Credito Ingresos por cargo de servicio
IF v_service_charge > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '402',
    'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_service_charge, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

-- Linea 4: Credito Ingresos por intermediacion de seguro de viaje (401.02)
IF v_insurance_cost > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '401.02',
    'Seguro de viaje Viaja Protegido (intermediacion) — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_insurance_cost, v_cfdi_uuid);
  v_line_num := v_line_num + 1;
END IF;

-- Linea 5: Credito Ingresos por membresia ToursRed Plus (403)
IF v_membership_cost > 0 THEN
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_line_num, '403',
    'Membresia ToursRed Plus (' || COALESCE(v_booking.membership_plan, 'monthly') || ') — reserva ' || COALESCE(v_booking.booking_code, ''),
    0, v_membership_cost, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$;
