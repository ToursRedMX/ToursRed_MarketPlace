
CREATE OR REPLACE FUNCTION get_account_balances_full(
  p_year integer,
  p_month integer
)
RETURNS TABLE (
  code             text,
  name             text,
  account_type     text,
  nature           text,
  period_debit     numeric,
  period_credit    numeric,
  period_balance   numeric,
  historic_debit   numeric,
  historic_credit  numeric,
  historic_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.code,
    ca.name,
    ca.account_type,
    ca.nature,
    -- Period: only the selected month/year
    COALESCE(SUM(CASE WHEN ae.period_year = p_year AND ae.period_month = p_month
                      THEN ael.debit ELSE 0 END), 0)::numeric  AS period_debit,
    COALESCE(SUM(CASE WHEN ae.period_year = p_year AND ae.period_month = p_month
                      THEN ael.credit ELSE 0 END), 0)::numeric AS period_credit,
    CASE ca.nature
      WHEN 'deudora'   THEN COALESCE(SUM(CASE WHEN ae.period_year = p_year AND ae.period_month = p_month THEN ael.debit - ael.credit ELSE 0 END), 0)::numeric
      WHEN 'acreedora' THEN COALESCE(SUM(CASE WHEN ae.period_year = p_year AND ae.period_month = p_month THEN ael.credit - ael.debit ELSE 0 END), 0)::numeric
      ELSE 0::numeric
    END AS period_balance,
    -- Historic: all posted entries up to and including the selected period
    COALESCE(SUM(CASE WHEN (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
                      THEN ael.debit ELSE 0 END), 0)::numeric  AS historic_debit,
    COALESCE(SUM(CASE WHEN (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
                      THEN ael.credit ELSE 0 END), 0)::numeric AS historic_credit,
    CASE ca.nature
      WHEN 'deudora'   THEN COALESCE(SUM(CASE WHEN (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month)) THEN ael.debit - ael.credit ELSE 0 END), 0)::numeric
      WHEN 'acreedora' THEN COALESCE(SUM(CASE WHEN (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month)) THEN ael.credit - ael.debit ELSE 0 END), 0)::numeric
      ELSE 0::numeric
    END AS historic_balance
  FROM chart_of_accounts ca
  LEFT JOIN accounting_entry_lines ael ON ael.account_code = ca.code
  LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id AND ae.is_posted = true
  WHERE ca.is_active = true
  GROUP BY ca.code, ca.name, ca.account_type, ca.nature
  ORDER BY ca.code;
END;
$$;

GRANT EXECUTE ON FUNCTION get_account_balances_full(integer, integer) TO authenticated;
