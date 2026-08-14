/*
# Actualizar funcion get_balance_sheet para incluir gastos, costos e ingresos

1. Cambios
- La funcion get_balance_sheet ahora devuelve TODOS los tipos de cuenta (activo, pasivo, capital, ingreso, gasto, costo)
  en lugar de solo activo, pasivo y capital.
- Esto permite que el Balance General muestre una imagen completa de todas las cuentas con saldo.
- Los saldos se calculan acumulados hasta el periodo seleccionado (p_year, p_month), igual que antes.
- Se mantiene el filtro de level >= 3 y is_active = true.
- Se mantiene el HAVING ABS(balance) > 0 para no mostrar cuentas sin movimiento.
2. Notas
- La interfaz se encargara de agrupar y mostrar las secciones apropiadas.
- El resultado del ejercicio (ingresos - gastos) se calculara en el frontend.
*/

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
  WHERE coa.account_type IN ('activo', 'pasivo', 'capital', 'ingreso', 'gasto', 'costo')
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