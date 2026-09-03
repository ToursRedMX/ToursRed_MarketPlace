
CREATE OR REPLACE FUNCTION calculate_executive_platform_commissions(
  p_month INTEGER,
  p_year  INTEGER
)
RETURNS TABLE(
  executive_id         UUID,
  executive_name       TEXT,
  agency_id            UUID,
  agency_name          TEXT,
  platform_revenue     DECIMAL,
  commission_percentage DECIMAL,
  commission_amount    DECIMAL,
  already_exists       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_period_start DATE;
  v_period_end   DATE;
BEGIN
  SELECT * INTO v_settings
  FROM executive_commission_settings
  WHERE is_current = true
  LIMIT 1;

  v_period_start := make_date(p_year, p_month, 1);
  v_period_end   := (v_period_start + INTERVAL '1 month')::DATE;

  RETURN QUERY
  SELECT
    ae.id                                                    AS executive_id,
    (ae.first_name || ' ' || ae.last_name)                   AS executive_name,
    a.id                                                     AS agency_id,
    a.name                                                   AS agency_name,
    COALESCE(SUM(cr.platform_total_revenue), 0)              AS platform_revenue,
    v_settings.platform_revenue_percentage                   AS commission_percentage,
    -- Delta: total commission minus what has already been generated
    GREATEST(
      0,
      ROUND(
        COALESCE(SUM(cr.platform_total_revenue), 0)
        * v_settings.platform_revenue_percentage / 100,
        2
      ) - COALESCE((
        SELECT SUM(ec2.amount)
        FROM executive_commissions ec2
        WHERE ec2.executive_id = ae.id
          AND ec2.agency_id    = a.id
          AND ec2.commission_type = 'platform_period'
          AND ec2.period_month = p_month
          AND ec2.period_year  = p_year
      ), 0)
    )                                                        AS commission_amount,
    -- already_exists only when there is nothing new to generate
    (
      GREATEST(
        0,
        ROUND(
          COALESCE(SUM(cr.platform_total_revenue), 0)
          * v_settings.platform_revenue_percentage / 100,
          2
        ) - COALESCE((
          SELECT SUM(ec2.amount)
          FROM executive_commissions ec2
          WHERE ec2.executive_id = ae.id
            AND ec2.agency_id    = a.id
            AND ec2.commission_type = 'platform_period'
            AND ec2.period_month = p_month
            AND ec2.period_year  = p_year
        ), 0)
      ) = 0
    )                                                        AS already_exists
  FROM account_executives ae
  JOIN agencies a ON a.account_executive_id = ae.id
  JOIN commission_records cr ON cr.agency_id = a.id
  WHERE
    ae.is_active               = true
    AND a.registered_by_executive = true
    AND a.approval_period_start IS NOT NULL
    -- Only within the configurable commission window from agency approval
    AND v_period_start >= DATE_TRUNC('month', a.approval_period_start)::DATE
    AND v_period_start < (a.approval_period_start + (v_settings.commission_period_months || ' months')::INTERVAL)::DATE
    -- Only commission_records from the requested month
    AND cr.created_at >= v_period_start
    AND cr.created_at <  v_period_end
    AND cr.status != 'disputed'
  GROUP BY ae.id, ae.first_name, ae.last_name, a.id, a.name
  HAVING COALESCE(SUM(cr.platform_total_revenue), 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_executive_platform_commissions(INTEGER, INTEGER) TO authenticated;
