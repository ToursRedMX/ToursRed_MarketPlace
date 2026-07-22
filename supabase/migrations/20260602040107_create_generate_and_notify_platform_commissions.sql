
CREATE OR REPLACE FUNCTION generate_and_notify_platform_commissions(
  p_month INTEGER,
  p_year  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings     executive_commission_settings%ROWTYPE;
  v_count        INTEGER := 0;
  v_rec          RECORD;
  v_exec_rec     RECORD;
  -- Para agrupar por ejecutivo
  v_exec_id      UUID;
  v_exec_total   DECIMAL(10,2);
  v_agencies_arr JSONB;
BEGIN
  SELECT * INTO v_settings FROM executive_commission_settings WHERE is_current = true LIMIT 1;

  -- Insertar comisiones nuevas
  FOR v_rec IN
    SELECT * FROM calculate_executive_platform_commissions(p_month, p_year)
    WHERE NOT already_exists AND commission_amount > 0
  LOOP
    INSERT INTO executive_commissions (
      executive_id,
      agency_id,
      commission_type,
      amount,
      period_month,
      period_year,
      status,
      commission_settings_snapshot
    ) VALUES (
      v_rec.executive_id,
      v_rec.agency_id,
      'platform_period',
      v_rec.commission_amount,
      p_month,
      p_year,
      'pending',
      jsonb_build_object(
        'platform_revenue',       v_rec.platform_revenue,
        'commission_percentage',  v_rec.commission_percentage,
        'settings_id',            v_settings.id
      )
    );
    v_count := v_count + 1;
  END LOOP;

  -- Si no se insertó nada, no enviamos emails
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  -- Enviar un email consolidado por ejecutivo (agrupa todas sus agencias del mes)
  FOR v_exec_rec IN
    SELECT
      ae.id             AS executive_id,
      ae.first_name,
      ae.last_name,
      ae.email,
      SUM(ec.amount)    AS total_amount,
      jsonb_agg(
        jsonb_build_object(
          'agencyName', a.name,
          'amount',     ec.amount
        ) ORDER BY a.name
      )                 AS agencies_detail
    FROM executive_commissions ec
    JOIN account_executives ae ON ae.id = ec.executive_id
    JOIN agencies a ON a.id = ec.agency_id
    WHERE ec.commission_type = 'platform_period'
      AND ec.period_month = p_month
      AND ec.period_year  = p_year
      AND ec.status = 'pending'
      AND ec.created_at >= (now() - INTERVAL '5 minutes')
    GROUP BY ae.id, ae.first_name, ae.last_name, ae.email
  LOOP
    -- Email consolidado
    PERFORM notify_executive_by_email(jsonb_build_object(
      'type',               'monthly_commission',
      'executiveEmail',     v_exec_rec.email,
      'executiveFirstName', v_exec_rec.first_name,
      'executiveLastName',  v_exec_rec.last_name,
      'periodMonth',        p_month,
      'periodYear',         p_year,
      'totalAmount',        v_exec_rec.total_amount,
      'agenciesDetail',     v_exec_rec.agencies_detail
    ));

    -- Notificación en app
    INSERT INTO notifications (user_id, type, title, message, data)
    SELECT
      ae.user_id,
      'commission_earned',
      'Comisiones de ' || TO_CHAR(make_date(p_year, p_month, 1), 'TMMonth YYYY'),
      'Generaste ' || TO_CHAR(v_exec_rec.total_amount, 'FM$999,990.00') || ' MXN en comisiones de plataforma este mes.',
      jsonb_build_object(
        'commission_type',  'platform_period',
        'period_month',     p_month,
        'period_year',      p_year,
        'total_amount',     v_exec_rec.total_amount,
        'agencies_count',   jsonb_array_length(v_exec_rec.agencies_detail)
      )
    FROM account_executives ae
    WHERE ae.id = v_exec_rec.executive_id;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_and_notify_platform_commissions(INTEGER, INTEGER) TO authenticated;
