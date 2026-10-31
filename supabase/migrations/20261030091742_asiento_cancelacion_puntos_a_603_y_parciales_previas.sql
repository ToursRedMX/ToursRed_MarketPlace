-- Asiento de cancelacion: los puntos devueltos revierten 603, y la cancelacion total ya no revierte dos veces lo que las parciales previas revirtieron.
--
-- DOS DEFECTOS, medidos el 30-oct-2026 contra la base (reserva TRG-NHQUK2Y2IWR y otras tres cancelaciones al 100% pagadas con puntos):
--
--   1. PUNTOS A 402 EN VEZ DE 603. Al reservar con puntos, el descuento se carga a 603 (gasto absorbido por ToursRed). Al cancelar, los
--      puntos regresan al viajero COMO PUNTOS, no como dinero, asi que no entran en `refund_amount_to_traveler` y la linea de "ajuste
--      residual" que cuadraba el asiento los acreditaba como INGRESO en 402. Resultado: el ingreso salia inflado y 603 quedaba sin
--      reversa. Decision de Axel y del contador (30-oct-2026): se acreditan a 603.
--      Los puntos se leen de lo que de verdad se devolvio (toursred_points_transactions, type 'refund' de la reserva; 100 puntos = $1) y
--      no de una columna nueva, para que funcionen los 6 llamadores sin tocarlos. Si el reembolso aun no existe cuando se asienta, el
--      residuo cae donde caia antes (402): no se inventa un importe. Solo cuentan los puntos de la reserva ('booking'): los de extras,
--      abonos y seguro ('post_booking_extra') se reembolsan con su propio importe y no estan en el anticipo que este asiento revierte.
--      En la cancelacion parcial salen de `booking_partial_cancellations.points_refunded`.
--
--   2. REVERSO DOBLE DEL ANTICIPO. La cancelacion total usa `original_deposit_amount`, que es el anticipo de TODA la reserva, aunque ya se
--      hayan cancelado viajeros por la via parcial. Desde el #485 las parciales SI dejan su asiento (y ya revirtieron su parte de 208),
--      asi que la total revertia esa parte otra vez y la diferencia caia en 402. Ahora la total descuenta lo que las parciales previas
--      que TIENEN asiento ya revirtieron. Las que no tienen (las 3 de jul-sep, anteriores al #485) no se descuentan: su 208 nunca se
--      revirtio y la total sigue siendo la que lo hace, como hasta hoy. Son datos de prueba que PRE-01 depura; no hay relleno historico.
--
-- NO cambia: el reparto 70/30 de la penalizacion (218 / 402.02), la cuenta del reembolso (218-11 o 102.01) ni el ajuste residual por
-- cargo de servicio retenido (402) o seguro cancelado (401.02).

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_cancellation(p_cancellation_id uuid, p_cancellation_type text DEFAULT 'full'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_cfdi_uuid text;
v_entry_type text;

v_booking_id uuid;
v_agency_id uuid;
v_deposit numeric;
v_service_charge numeric;
v_refund_to_traveler numeric;
v_amount_to_agency numeric;
v_amount_to_platform numeric;
v_policy_type text;
v_cancelled_at timestamptz;
v_tour_name text;
v_booking_code text;
v_traveler_name text;
v_refund_method text;
v_refund_account_code text;
v_prev_partials numeric := 0;
v_points_mxn numeric := 0;
v_points_partial integer := 0;
BEGIN

IF p_cancellation_type IN ('full', 'agency_booking') THEN
SELECT
bc.booking_id,
bc.cancellation_policy_type,
bc.original_deposit_amount,
bc.original_service_charge,
bc.refund_amount_to_traveler,
bc.amount_to_agency,
bc.amount_to_platform,
COALESCE(bc.cancelled_at, bc.created_at),
b.agency_id,
t.name,
b.booking_code,
u.first_name || ' ' || u.last_name,
bc.refund_method
INTO
v_booking_id, v_policy_type, v_deposit, v_service_charge,
v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name,
v_refund_method
FROM booking_cancellations bc
JOIN bookings b ON b.id = bc.booking_id
JOIN tours t ON t.id = b.tour_id
LEFT JOIN users u ON u.id = b.user_id
WHERE bc.id = p_cancellation_id;

ELSIF p_cancellation_type = 'partial' THEN
SELECT
bpc.booking_id,
bpc.cancellation_policy_type,
bpc.original_partial_amount,
0,
bpc.refund_amount_to_traveler,
bpc.amount_to_agency,
bpc.amount_to_platform,
COALESCE(bpc.created_at, now()),
b.agency_id,
t.name,
b.booking_code,
u.first_name || ' ' || u.last_name,
bpc.refund_method,
COALESCE(bpc.points_refunded, 0)
INTO
v_booking_id, v_policy_type, v_deposit, v_service_charge,
v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name,
v_refund_method, v_points_partial
FROM booking_partial_cancellations bpc
JOIN bookings b ON b.id = bpc.booking_id
JOIN tours t ON t.id = b.tour_id
LEFT JOIN users u ON u.id = b.user_id
WHERE bpc.id = p_cancellation_id;

ELSIF p_cancellation_type = 'agency_tour' THEN
SELECT
NULL::uuid,
'100_percent',
tc.total_refunded_amount,
0,
tc.total_refunded_amount,
0,
0,
COALESCE(tc.created_at, now()),
tc.agency_id,
t.name,
NULL,
NULL,
NULL::text
INTO
v_booking_id, v_policy_type, v_deposit, v_service_charge,
v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name,
v_refund_method
FROM tour_cancellations tc
JOIN tours t ON t.id = tc.tour_id
WHERE tc.id = p_cancellation_id;
END IF;

IF v_cancelled_at IS NULL THEN
RETURN NULL;
END IF;

IF EXISTS (
SELECT 1 FROM accounting_entries
WHERE source_type = 'cancellation'
AND source_id = p_cancellation_id
) THEN
RETURN NULL;
END IF;

IF v_booking_id IS NOT NULL THEN
SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = v_booking_id AND status = 'stamped'
LIMIT 1;
END IF;

-- Cancelacion total: el anticipo a revertir es el que NO revirtieron ya las parciales previas.
-- Solo cuentan las parciales que tienen su asiento; sin asiento, su 208 sigue en el libro y esta cancelacion lo revierte.
IF p_cancellation_type IN ('full', 'agency_booking') AND v_booking_id IS NOT NULL THEN
SELECT COALESCE(SUM(bpc.original_partial_amount), 0)
INTO v_prev_partials
FROM booking_partial_cancellations bpc
WHERE bpc.booking_id = v_booking_id
AND bpc.created_at <= v_cancelled_at
AND EXISTS (
SELECT 1 FROM accounting_entries e
WHERE e.source_type = 'cancellation'
AND e.source_id = bpc.id
);
v_deposit := GREATEST(COALESCE(v_deposit, 0) - v_prev_partials, 0);
END IF;

-- Puntos devueltos al viajero (100 puntos = $1). Parcial: lo que registro la propia cancelacion. Total: lo que de verdad se
-- reembolso de la reserva. Se topa en lo que queda por cuadrar para nunca dejar un residual negativo.
IF p_cancellation_type = 'partial' THEN
v_points_mxn := v_points_partial / 100.0;
ELSIF p_cancellation_type IN ('full', 'agency_booking') AND v_booking_id IS NOT NULL THEN
SELECT COALESCE(SUM(t.amount), 0) / 100.0
INTO v_points_mxn
FROM toursred_points_transactions t
WHERE t.type = 'refund'
AND t.reference_type = 'booking'
AND t.reference_id = v_booking_id;
END IF;
v_points_mxn := ROUND(LEAST(
GREATEST(v_points_mxn, 0),
GREATEST(COALESCE(v_deposit, 0) - COALESCE(v_refund_to_traveler, 0) - COALESCE(v_amount_to_agency, 0) - COALESCE(v_amount_to_platform, 0), 0)
), 2);

-- Antes esta linea SIEMPRE acreditaba 102.01 (Cuenta bancaria - Transferencia
-- SPEI, un activo de banco REAL), sin importar el metodo de reembolso. Segun
-- el modelo contable (seccion 8), el reembolso estandar (politicas C2/C3) se
-- acredita al PASIVO del monedero ToursRed Cash (218-11) -- no sale dinero
-- real del banco, solo se reclasifica como algo que la empresa le debe al
-- viajero. Solo el caso excepcional C5 (reembolso en efectivo a solicitud
-- expresa) debe tocar una cuenta de banco real. Confirmado en datos reales:
-- 3 cancelaciones ya habian acreditado incorrectamente $11,988.04 a la cuenta
-- de banco SPEI cuando en realidad el dinero se convirtio en saldo de
-- monedero (cada una con su propio toursred_cash_transaction_id). Se corrige
-- eligiendo la cuenta segun refund_method; por defecto (NULL o
-- 'toursred_cash', que es el flujo estandar) usa el pasivo del monedero.
v_refund_account_code := CASE
WHEN v_refund_method IS NULL OR v_refund_method = 'toursred_cash' THEN '218-11'
ELSE '102.01'
END;

v_year  := EXTRACT(YEAR  FROM v_cancelled_at)::integer;
v_month := EXTRACT(MONTH FROM v_cancelled_at)::integer;

v_entry_type := CASE
WHEN v_refund_to_traveler > 0 THEN 'egreso'
ELSE 'diario'
END;

v_entry_number := generate_entry_number(v_entry_type, v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
)
VALUES (
v_entry_number,
v_entry_type,
v_cancelled_at::date,
v_year,
v_month,
CASE p_cancellation_type
WHEN 'partial'        THEN 'Cancelacion parcial ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '')
WHEN 'agency_tour'    THEN 'Cancelacion total de tour por agencia — ' || COALESCE(v_tour_name, '')
WHEN 'agency_booking' THEN 'Cancelacion de reserva por agencia ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '')
ELSE 'Cancelacion reserva ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '') ||
' | Politica: ' || COALESCE(v_policy_type, '')
END,
'cancellation',
p_cancellation_id,
true
)
RETURNING id INTO v_entry_id;

-- Línea 1: Reverso anticipo (208 Anticipos de clientes)
IF v_deposit > 0 THEN
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 1, '208',
'Reverso anticipo cancelado — ' || COALESCE(v_booking_code, COALESCE(v_tour_name, '')),
v_deposit, 0, v_cfdi_uuid
);
END IF;

-- Línea 2: Reembolso al viajero — 218-11 (ToursRed Cash) por defecto,
-- 102.01 (Bancos SPEI) solo si el metodo de reembolso fue efectivo real.
IF v_refund_to_traveler > 0 THEN
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 2, v_refund_account_code,
CASE WHEN v_refund_account_code = '218-11'
  THEN 'Reembolso a monedero ToursRed Cash — ' || COALESCE(v_traveler_name, 'viajero')
  ELSE 'Reembolso en efectivo (SPEI) — ' || COALESCE(v_traveler_name, 'viajero')
END,
0, v_refund_to_traveler, v_cfdi_uuid
);
END IF;

-- Línea 3: Penalización parte agencia (218 Otros Pasivos Circulantes — por pagar a agencia)
IF v_amount_to_agency > 0 THEN
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 3, '218',
'Penalizacion por cancelacion — por pagar a agencia ' || COALESCE(v_tour_name, ''),
0, v_amount_to_agency, v_cfdi_uuid
);
END IF;

-- Línea 4: Ingreso plataforma por penalización (402.02)
IF v_amount_to_platform > 0 THEN
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 4, '402.02',
'Ingreso ToursRed por penalizacion de cancelacion',
0, v_amount_to_platform, v_cfdi_uuid
);
END IF;

-- Línea 5: Puntos devueltos al viajero — revierte el descuento por puntos que ToursRed absorbio al reservar (603).
IF v_points_mxn > 0 THEN
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 5, '603',
'Puntos ToursRed devueltos al viajero — reversa del descuento absorbido — ' || COALESCE(v_booking_code, COALESCE(v_tour_name, '')),
0, v_points_mxn, v_cfdi_uuid
);
END IF;

-- Línea 6: Ajuste residual
DECLARE
v_residual numeric;
BEGIN
SELECT
COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)
INTO v_residual
FROM accounting_entry_lines
WHERE entry_id = v_entry_id;

IF ABS(v_residual) > 0.001 THEN
IF v_residual > 0 THEN
-- Débito mayor: crédito a ingresos por servicios no reembolsables
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 6, '402',
'Ajuste servicios no reembolsables / cargos de servicio',
0, v_residual, v_cfdi_uuid
);
ELSE
-- Crédito mayor (ej. reverso de seguro de viaje): debitar 401.02
INSERT INTO accounting_entry_lines
(entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (
v_entry_id, 6, '401.02',
'Reverso ingreso seguro cancelado — ' || COALESCE(v_booking_code, ''),
ABS(v_residual), 0, v_cfdi_uuid
);
END IF;
END IF;
END;

RETURN v_entry_id;
END;
$function$;
