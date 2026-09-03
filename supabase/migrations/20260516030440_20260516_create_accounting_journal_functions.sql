
-- =============================================
-- POLIZA: BOOKING CONFIRMADO (anticipo recibido)
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_booking(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  SELECT b.*, t.name AS tour_name, u.full_name AS traveler_name
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

  v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;

  -- Generar numero de poliza
  v_entry_number := generate_entry_number('ingreso', v_year, v_month);

  -- Crear poliza
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

  -- Linea 1: Debito Bancos (entra el dinero)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '102', 'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, ''), v_total_received, 0, v_cfdi_uuid);

  -- Linea 2: Credito Anticipos de clientes (pasivo — no es ingreso todavia)
  IF v_deposit > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, 2, '208', 'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''), 0, v_deposit, v_cfdi_uuid);
  END IF;

  -- Linea 3: Credito Ingresos por cargo de servicio (este SI es ingreso inmediato de ToursRed)
  IF v_service_charge > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, 3, '402', 'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''), 0, v_service_charge, v_cfdi_uuid);
  END IF;

  RETURN v_entry_id;
END;
$$;

-- =============================================
-- POLIZA: TOUR COMPLETADO (devengamiento de ingresos)
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_tour_completion(p_commission_record_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_year := EXTRACT(YEAR FROM COALESCE(v_cr.tour_end_date, CURRENT_DATE))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_cr.tour_end_date, CURRENT_DATE))::integer;

  v_entry_number := generate_entry_number('diario', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  )
  VALUES (
    v_entry_number,
    'diario',
    COALESCE(v_cr.tour_end_date, CURRENT_DATE),
    v_year,
    v_month,
    'Devengamiento tour completado — ' || COALESCE(v_cr.tour_name, '') ||
      ' — Agencia: ' || COALESCE(v_cr.agency_name, ''),
    'booking',
    v_cr.booking_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Debito Anticipos de clientes (cancela el pasivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '208', 'Liquidacion anticipo devengado', v_deposit, 0, v_cfdi_uuid);

  -- Credito Ingresos por comisiones propias (solo la comision de ToursRed es ingreso)
  IF v_commission > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, 2, '401', 'Comision ToursRed por tour completado', 0, v_commission, v_cfdi_uuid);
  END IF;

  -- Credito CxP Agencias (lo que se le debe a la agencia)
  IF v_agency_net > 0 THEN
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, 3, '201', 'Por pagar a agencia ' || COALESCE(v_cr.agency_name, ''), 0, v_agency_net, v_cfdi_uuid);
  END IF;

  RETURN v_entry_id;
END;
$$;

-- =============================================
-- POLIZA: PAGO A AGENCIA (egreso)
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_payout(p_payout_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout record;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_net numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'payout' AND source_id = p_payout_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT ap.*, ag.name AS agency_name
  INTO v_payout
  FROM agency_payouts ap
  LEFT JOIN agencies ag ON ag.id = ap.agency_id
  WHERE ap.id = p_payout_id AND ap.status = 'completed';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_net := COALESCE(v_payout.net_amount, v_payout.amount, 0);

  v_year := EXTRACT(YEAR FROM COALESCE(v_payout.payment_date, CURRENT_DATE))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_payout.payment_date, CURRENT_DATE))::integer;

  v_entry_number := generate_entry_number('egreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  )
  VALUES (
    v_entry_number,
    'egreso',
    COALESCE(v_payout.payment_date, CURRENT_DATE),
    v_year,
    v_month,
    'Pago a agencia ' || COALESCE(v_payout.agency_name, '') ||
      ' — ' || COALESCE(v_payout.payout_code, ''),
    'payout',
    p_payout_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Debito CxP Agencias (cancela el pasivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '201', 'Pago agencia ' || COALESCE(v_payout.agency_name, ''), v_net, 0);

  -- Credito Bancos (sale el dinero)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 2, '102', 'Transferencia bancaria — ' || COALESCE(v_payout.payout_code, ''), 0, v_net);

  RETURN v_entry_id;
END;
$$;

-- =============================================
-- FUNCION: Balanza de comprobacion (para Anexo 24)
-- =============================================
CREATE OR REPLACE FUNCTION get_trial_balance(p_year integer, p_month integer)
RETURNS TABLE (
  code text,
  name text,
  sat_group_code text,
  account_type text,
  nature text,
  opening_debit numeric,
  opening_credit numeric,
  period_debit numeric,
  period_credit numeric,
  closing_debit numeric,
  closing_credit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH period_movements AS (
    SELECT
      ael.account_code,
      SUM(ael.debit) AS period_debit,
      SUM(ael.credit) AS period_credit
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.period_year = p_year AND ae.period_month = p_month
      AND ae.is_posted = true
    GROUP BY ael.account_code
  ),
  prior_movements AS (
    SELECT
      ael.account_code,
      SUM(ael.debit) AS prior_debit,
      SUM(ael.credit) AS prior_credit
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month < p_month))
      AND ae.is_posted = true
    GROUP BY ael.account_code
  )
  SELECT
    coa.code,
    coa.name,
    coa.sat_group_code,
    coa.account_type,
    coa.nature,
    COALESCE(pm_prior.prior_debit, 0) AS opening_debit,
    COALESCE(pm_prior.prior_credit, 0) AS opening_credit,
    COALESCE(pm.period_debit, 0) AS period_debit,
    COALESCE(pm.period_credit, 0) AS period_credit,
    COALESCE(pm_prior.prior_debit, 0) + COALESCE(pm.period_debit, 0) AS closing_debit,
    COALESCE(pm_prior.prior_credit, 0) + COALESCE(pm.period_credit, 0) AS closing_credit
  FROM chart_of_accounts coa
  LEFT JOIN period_movements pm ON pm.account_code = coa.code
  LEFT JOIN prior_movements pm_prior ON pm_prior.account_code = coa.code
  WHERE coa.is_active = true
    AND coa.level >= 3
    AND (
      COALESCE(pm.period_debit, 0) > 0
      OR COALESCE(pm.period_credit, 0) > 0
      OR COALESCE(pm_prior.prior_debit, 0) > 0
      OR COALESCE(pm_prior.prior_credit, 0) > 0
    )
  ORDER BY coa.code;
END;
$$;

-- =============================================
-- FUNCION: Estado de resultados
-- =============================================
CREATE OR REPLACE FUNCTION get_income_statement(p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
RETURNS TABLE (
  code text,
  name text,
  account_type text,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    coa.code,
    coa.name,
    coa.account_type,
    CASE
      WHEN coa.nature = 'acreedora' THEN
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
      ELSE
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
    END AS total_amount
  FROM chart_of_accounts coa
  LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
  LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
    AND ae.is_posted = true
    AND (
      ae.period_year > p_from_year
      OR (ae.period_year = p_from_year AND ae.period_month >= p_from_month)
    )
    AND (
      ae.period_year < p_to_year
      OR (ae.period_year = p_to_year AND ae.period_month <= p_to_month)
    )
  WHERE coa.account_type IN ('ingreso', 'gasto', 'costo')
    AND coa.is_active = true
    AND coa.level >= 3
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING (
    COALESCE(SUM(ael.debit), 0) > 0 OR COALESCE(SUM(ael.credit), 0) > 0
  )
  ORDER BY coa.code;
END;
$$;

-- =============================================
-- FUNCION: Balance general
-- =============================================
CREATE OR REPLACE FUNCTION get_balance_sheet(p_year integer, p_month integer)
RETURNS TABLE (
  code text,
  name text,
  account_type text,
  nature text,
  balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    coa.code,
    coa.name,
    coa.account_type,
    coa.nature,
    CASE
      WHEN coa.nature = 'deudora' THEN
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
      ELSE
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
    END AS balance
  FROM chart_of_accounts coa
  LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
  LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
    AND ae.is_posted = true
    AND (
      ae.period_year < p_year
      OR (ae.period_year = p_year AND ae.period_month <= p_month)
    )
  WHERE coa.account_type IN ('activo', 'pasivo', 'capital')
    AND coa.is_active = true
    AND coa.level >= 3
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING ABS(
    CASE
      WHEN coa.nature = 'deudora' THEN
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
      ELSE
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
    END
  ) > 0
  ORDER BY coa.code;
END;
$$;

-- =============================================
-- FUNCION: Procesar eventos pendientes en lote
-- =============================================
CREATE OR REPLACE FUNCTION generate_accounting_entries_batch(
  p_from_date date DEFAULT (CURRENT_DATE - interval '90 days')::date,
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_count integer := 0;
  v_completion_count integer := 0;
  v_payout_count integer := 0;
  v_booking record;
  v_cr record;
  v_payout record;
  v_result uuid;
BEGIN
  -- Procesar bookings con pago exitoso sin poliza
  FOR v_booking IN
    SELECT b.id
    FROM bookings b
    WHERE b.payment_status = 'succeeded'
      AND COALESCE(b.paid_at, b.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'booking' AND ae.source_id = b.id
          AND ae.entry_type = 'ingreso'
      )
  LOOP
    v_result := create_accounting_entry_for_booking(v_booking.id);
    IF v_result IS NOT NULL THEN
      v_booking_count := v_booking_count + 1;
    END IF;
  END LOOP;

  -- Procesar commission records completados sin poliza de devengamiento
  FOR v_cr IN
    SELECT cr.id
    FROM commission_records cr
    WHERE cr.tour_end_date BETWEEN p_from_date AND p_to_date
      AND cr.status IN ('pending', 'processed', 'paid_out')
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'booking' AND ae.source_id = cr.booking_id
          AND ae.description LIKE 'Devengamiento%'
      )
  LOOP
    v_result := create_accounting_entry_for_tour_completion(v_cr.id);
    IF v_result IS NOT NULL THEN
      v_completion_count := v_completion_count + 1;
    END IF;
  END LOOP;

  -- Procesar payouts completados sin poliza
  FOR v_payout IN
    SELECT ap.id
    FROM agency_payouts ap
    WHERE ap.status = 'completed'
      AND ap.payment_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'payout' AND ae.source_id = ap.id
      )
  LOOP
    v_result := create_accounting_entry_for_payout(v_payout.id);
    IF v_result IS NOT NULL THEN
      v_payout_count := v_payout_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'bookings_processed', v_booking_count,
    'completions_processed', v_completion_count,
    'payouts_processed', v_payout_count,
    'total', v_booking_count + v_completion_count + v_payout_count
  );
END;
$$;
