-- =============================================
-- CUENTAS CONTABLES FALTANTES
-- =============================================

-- Subcuenta 402.01: Cargo de servicio (mover lineas existentes de 402)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES ('402.01', '401-01', 'Cargo de servicio plataforma', 'ingreso', '402', 4, 'acreedora', false,
        'Cargo de servicio cobrado a viajeros al momento de la reserva')
ON CONFLICT (code) DO NOTHING;

-- Subcuenta 402.02: Penalizaciones de cancelacion (ingreso de ToursRed cuando viajero cancela tarde)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES ('402.02', '401-01', 'Penalizaciones por cancelacion', 'ingreso', '402', 4, 'acreedora', false,
        'Porcion de penalizacion que se queda ToursRed cuando un viajero cancela con menos de 15 dias de anticipacion (30% del monto retenido)')
ON CONFLICT (code) DO NOTHING;

-- Subcuenta 606.01: Reembolsos a viajeros
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES ('606.01', '601-01', 'Reembolsos a viajeros — ToursRed Cash', 'gasto', '606', 4, 'deudora', false,
        'Monto devuelto al viajero como ToursRed Cash cuando cancela dentro de la politica de reembolso')
ON CONFLICT (code) DO NOTHING;

-- =============================================
-- FUNCION: Poliza contable para cancelacion total de reserva
-- =============================================
-- Escenarios cubiertos:
--   source_type = 'cancellation' (booking_cancellation_id)
--   source_type = 'agency_booking_cancellation' (idem)
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_cancellation(
  p_cancellation_id uuid,
  p_cancellation_type text DEFAULT 'full'  -- 'full' | 'partial' | 'agency_booking' | 'agency_tour'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_cfdi_uuid text;
  v_entry_type text;

  -- Campos comunes
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
BEGIN

  -- ── Extraer datos segun tipo de cancelacion ──────────────────────────────
  IF p_cancellation_type IN ('full', 'agency_booking') THEN
    -- Cancelacion total de reserva (booking_cancellations)
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
      u.full_name
    INTO
      v_booking_id, v_policy_type, v_deposit, v_service_charge,
      v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
      v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name
    FROM booking_cancellations bc
    JOIN bookings b ON b.id = bc.booking_id
    JOIN tours t ON t.id = b.tour_id
    LEFT JOIN users u ON u.id = b.user_id
    WHERE bc.id = p_cancellation_id;

  ELSIF p_cancellation_type = 'partial' THEN
    -- Cancelacion parcial (booking_partial_cancellations)
    SELECT
      bpc.booking_id,
      bpc.cancellation_policy_type,
      bpc.original_partial_amount,
      0,  -- no hay service_charge en parciales
      bpc.refund_amount_to_traveler,
      bpc.amount_to_agency,
      bpc.amount_to_platform,
      COALESCE(bpc.created_at, now()),
      b.agency_id,
      t.name,
      b.booking_code,
      u.full_name
    INTO
      v_booking_id, v_policy_type, v_deposit, v_service_charge,
      v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
      v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name
    FROM booking_partial_cancellations bpc
    JOIN bookings b ON b.id = bpc.booking_id
    JOIN tours t ON t.id = b.tour_id
    LEFT JOIN users u ON u.id = b.user_id
    WHERE bpc.id = p_cancellation_id;

  ELSIF p_cancellation_type = 'agency_tour' THEN
    -- Cancelacion de tour completo (tour_cancellations) — un registro por tour, no por booking
    -- Genera una poliza global. El source_id es el tour_cancellation id.
    SELECT
      NULL::uuid,  -- no hay un solo booking_id
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
      NULL
    INTO
      v_booking_id, v_policy_type, v_deposit, v_service_charge,
      v_refund_to_traveler, v_amount_to_agency, v_amount_to_platform,
      v_cancelled_at, v_agency_id, v_tour_name, v_booking_code, v_traveler_name
    FROM tour_cancellations tc
    JOIN tours t ON t.id = tc.tour_id
    WHERE tc.id = p_cancellation_id;
  END IF;

  IF v_cancelled_at IS NULL THEN
    RETURN NULL;  -- no encontrado
  END IF;

  -- ── Idempotencia: verificar si ya existe poliza para esta cancelacion ────
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'cancellation'
      AND source_id = p_cancellation_id
  ) THEN
    RETURN NULL;
  END IF;

  -- ── Obtener CFDI del booking si existe ───────────────────────────────────
  IF v_booking_id IS NOT NULL THEN
    SELECT uuid_fiscal INTO v_cfdi_uuid
    FROM cfdi_invoices
    WHERE booking_id = v_booking_id AND status = 'stamped'
    LIMIT 1;
  END IF;

  v_year  := EXTRACT(YEAR  FROM v_cancelled_at)::integer;
  v_month := EXTRACT(MONTH FROM v_cancelled_at)::integer;

  -- Tipo de poliza: egreso si hay reembolso (sale dinero), diario si solo movimientos internos
  v_entry_type := CASE
    WHEN v_refund_to_traveler > 0 THEN 'egreso'
    ELSE 'diario'
  END;

  v_entry_number := generate_entry_number(v_entry_type, v_year, v_month);

  -- ── Crear encabezado de poliza ────────────────────────────────────────────
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
      WHEN 'partial'       THEN 'Cancelacion parcial ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '')
      WHEN 'agency_tour'   THEN 'Cancelacion total de tour por agencia — ' || COALESCE(v_tour_name, '')
      WHEN 'agency_booking' THEN 'Cancelacion de reserva por agencia ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '')
      ELSE 'Cancelacion reserva ' || COALESCE(v_booking_code, '') || ' — ' || COALESCE(v_tour_name, '') ||
           ' | Politica: ' || COALESCE(v_policy_type, '')
    END,
    'cancellation',
    p_cancellation_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- ── Generar partidas segun politica ───────────────────────────────────────
  --
  -- Linea 1 SIEMPRE: Cargo (debito) a Anticipos de clientes (208) — reverso del pasivo original
  IF v_deposit > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 1, '208',
      'Reverso anticipo cancelado — ' || COALESCE(v_booking_code, COALESCE(v_tour_name, '')),
      v_deposit, 0, v_cfdi_uuid
    );
  END IF;

  -- Linea 2: Abono (credito) Bancos — sale el reembolso al viajero
  -- Se usa 102.01 (SPEI) como cuenta de bancos por defecto para reembolsos ToursRed Cash
  -- (el ToursRed Cash es un pasivo interno que se financia con los fondos del banco)
  IF v_refund_to_traveler > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 2, '102.01',
      'Reembolso ToursRed Cash — ' || COALESCE(v_traveler_name, 'viajero'),
      0, v_refund_to_traveler, v_cfdi_uuid
    );
  END IF;

  -- Linea 3: Segun politica — penalizacion a agencia (CxP Agencias 201)
  IF v_amount_to_agency > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 3, '201',
      'Penalizacion por cancelacion — parte agencia ' || COALESCE(v_tour_name, ''),
      0, v_amount_to_agency, v_cfdi_uuid
    );
  END IF;

  -- Linea 4: Ingreso de ToursRed por penalizacion (402.02)
  IF v_amount_to_platform > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 4, '402.02',
      'Ingreso ToursRed por penalizacion de cancelacion',
      0, v_amount_to_platform, v_cfdi_uuid
    );
  END IF;

  -- Linea 5 (solo 100%): Si deposit > refund (diferencia no explicada, ej. servicios opcionales
  -- no reembolsables que ya se reconocieron como ingreso en el booking original).
  -- En ese caso el saldo ya esta cuadrado por la linea 1 y lineas 2-4, pero si hay residuo
  -- por redondeo o servicios opcionales no reembolsables, se lleva a 402 (ingreso).
  DECLARE
    v_residual numeric;
  BEGIN
    SELECT
      COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)
    INTO v_residual
    FROM accounting_entry_lines
    WHERE entry_id = v_entry_id;

    IF ABS(v_residual) > 0.001 THEN
      -- Residual positivo (debito mayor): credito adicional a ingresos por servicios no reembolsables
      IF v_residual > 0 THEN
        INSERT INTO accounting_entry_lines
          (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
        VALUES (
          v_entry_id, 5, '402',
          'Ajuste servicios no reembolsables / cargos de servicio',
          0, v_residual, v_cfdi_uuid
        );
      ELSE
        -- Residual negativo (credito mayor): debito a cuenta de reembolsos/ajustes
        INSERT INTO accounting_entry_lines
          (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
        VALUES (
          v_entry_id, 5, '606',
          'Ajuste diferencia de cancelacion',
          ABS(v_residual), 0, v_cfdi_uuid
        );
      END IF;
    END IF;
  END;

  RETURN v_entry_id;
END;
$$;


-- =============================================
-- FUNCION: Poliza al liquidar penalizacion a agencia
-- Cuando admin marca un cancellation_penalty_record como 'processed'
-- y le paga a la agencia su parte de la penalizacion
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_penalty_payout(
  p_penalty_record_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_penalty record;
BEGIN
  -- Idempotencia
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'cancellation'
      AND source_id = p_penalty_record_id
      AND description LIKE 'Pago penalizacion%'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    cpr.agency_net_amount,
    cpr.processed_at,
    COALESCE(cpr.processed_at, now()) AS ts,
    ag.name AS agency_name,
    t.name AS tour_name
  INTO v_penalty
  FROM cancellation_penalty_records cpr
  JOIN agencies ag ON ag.id = cpr.agency_id
  JOIN tours t ON t.id = cpr.tour_id
  WHERE cpr.id = p_penalty_record_id
    AND cpr.status = 'processed';

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_year  := EXTRACT(YEAR  FROM v_penalty.ts)::integer;
  v_month := EXTRACT(MONTH FROM v_penalty.ts)::integer;

  v_entry_number := generate_entry_number('egreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  )
  VALUES (
    v_entry_number, 'egreso',
    v_penalty.ts::date, v_year, v_month,
    'Pago penalizacion a agencia ' || v_penalty.agency_name || ' — ' || v_penalty.tour_name,
    'cancellation',
    p_penalty_record_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Dr. CxP Agencias (cancela el pasivo registrado en la poliza de cancelacion)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '201',
    'Liquidacion penalizacion agencia ' || v_penalty.agency_name,
    v_penalty.agency_net_amount, 0);

  -- Cr. Bancos (sale el dinero)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 2, '102.01',
    'Transferencia penalizacion — ' || v_penalty.tour_name,
    0, v_penalty.agency_net_amount);

  RETURN v_entry_id;
END;
$$;
