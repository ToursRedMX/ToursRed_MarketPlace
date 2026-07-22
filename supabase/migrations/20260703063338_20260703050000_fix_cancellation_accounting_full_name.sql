CREATE OR REPLACE FUNCTION create_accounting_entry_for_cancellation(
  p_cancellation_id uuid,
  p_cancellation_type text DEFAULT 'full'
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
      u.first_name || ' ' || u.last_name
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
      u.first_name || ' ' || u.last_name
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

  IF v_deposit > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 1, '208',
      'Reverso anticipo cancelado — ' || COALESCE(v_booking_code, COALESCE(v_tour_name, '')),
      v_deposit, 0, v_cfdi_uuid
    );
  END IF;

  IF v_refund_to_traveler > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 2, '102.01',
      'Reembolso ToursRed Cash — ' || COALESCE(v_traveler_name, 'viajero'),
      0, v_refund_to_traveler, v_cfdi_uuid
    );
  END IF;

  IF v_amount_to_agency > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 3, '201',
      'Penalizacion por cancelacion — parte agencia ' || COALESCE(v_tour_name, ''),
      0, v_amount_to_agency, v_cfdi_uuid
    );
  END IF;

  IF v_amount_to_platform > 0 THEN
    INSERT INTO accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (
      v_entry_id, 4, '402.02',
      'Ingreso ToursRed por penalizacion de cancelacion',
      0, v_amount_to_platform, v_cfdi_uuid
    );
  END IF;

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
        INSERT INTO accounting_entry_lines
          (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
        VALUES (
          v_entry_id, 5, '402',
          'Ajuste servicios no reembolsables / cargos de servicio',
          0, v_residual, v_cfdi_uuid
        );
      ELSE
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
