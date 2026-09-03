-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831050912
--   name:    fix_financial_statement_getters_missing_auth
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- BUG: get_account_balances_full, get_income_statement y get_trial_balance
-- no tenian NINGUN chequeo de autorizacion, a diferencia de su funcion
-- hermana get_balance_sheet (que si valida is_admin_user() OR
-- is_accountant_user()). Cualquier usuario autenticado -- incluyendo
-- viajeros -- podia ver el balance de cuentas completo, el estado de
-- resultados, y la balanza de comprobacion de ToursRed. Se agrega la misma
-- verificacion usada en get_balance_sheet.
CREATE OR REPLACE FUNCTION public.get_account_balances_full(p_year integer, p_month integer)
 RETURNS TABLE(code text, name text, account_type text, nature text, level integer, parent_code text, is_system boolean, period_debit numeric, period_credit numeric, period_balance numeric, historic_debit numeric, historic_credit numeric, historic_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

RETURN QUERY
WITH leaf_balances AS (
SELECT
coa.code AS acct_code,
COALESCE(SUM(CASE
WHEN ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
THEN ael.debit ELSE 0 END), 0) AS pd,
COALESCE(SUM(CASE
WHEN ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
THEN ael.credit ELSE 0 END), 0) AS pc,
COALESCE(SUM(CASE
WHEN ae.is_posted = true AND (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
THEN ael.debit ELSE 0 END), 0) AS hd,
COALESCE(SUM(CASE
WHEN ae.is_posted = true AND (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
THEN ael.credit ELSE 0 END), 0) AS hc
FROM chart_of_accounts coa
LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
GROUP BY coa.code
)
SELECT
a.code, a.name, a.account_type, a.nature, a.level, a.parent_code, a.is_system,
COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
CASE
WHEN a.nature = 'deudora' THEN
COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
ELSE
COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
END,
COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
CASE
WHEN a.nature = 'deudora' THEN
COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
ELSE
COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
END
FROM chart_of_accounts a
WHERE a.is_active = true
ORDER BY a.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_income_statement(p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
 RETURNS TABLE(code text, name text, account_type text, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

RETURN QUERY
SELECT
coa.code, coa.name, coa.account_type,
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
AND (ae.period_year > p_from_year OR (ae.period_year = p_from_year AND ae.period_month >= p_from_month))
AND (ae.period_year < p_to_year OR (ae.period_year = p_to_year AND ae.period_month <= p_to_month))
WHERE coa.account_type IN ('ingreso', 'gasto', 'costo') AND coa.is_active = true
GROUP BY coa.code, coa.name, coa.account_type, coa.nature
HAVING (COALESCE(SUM(ael.debit), 0) > 0 OR COALESCE(SUM(ael.credit), 0) > 0)
ORDER BY coa.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_trial_balance(p_year integer, p_month integer)
 RETURNS TABLE(code text, name text, sat_group_code text, account_type text, nature text, opening_debit numeric, opening_credit numeric, period_debit numeric, period_credit numeric, closing_debit numeric, closing_credit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

RETURN QUERY
WITH period_movements AS (
SELECT ael.account_code, SUM(ael.debit) AS period_debit, SUM(ael.credit) AS period_credit
FROM accounting_entry_lines ael
JOIN accounting_entries ae ON ae.id = ael.entry_id
WHERE ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
GROUP BY ael.account_code
),
prior_movements AS (
SELECT ael.account_code, SUM(ael.debit) AS prior_debit, SUM(ael.credit) AS prior_credit
FROM accounting_entry_lines ael
JOIN accounting_entries ae ON ae.id = ael.entry_id
WHERE (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month < p_month))
AND ae.is_posted = true
GROUP BY ael.account_code
)
SELECT
coa.code, coa.name, coa.sat_group_code, coa.account_type, coa.nature,
COALESCE(pm_prior.prior_debit, 0), COALESCE(pm_prior.prior_credit, 0),
COALESCE(pm.period_debit, 0), COALESCE(pm.period_credit, 0),
COALESCE(pm_prior.prior_debit, 0) + COALESCE(pm.period_debit, 0),
COALESCE(pm_prior.prior_credit, 0) + COALESCE(pm.period_credit, 0)
FROM chart_of_accounts coa
LEFT JOIN period_movements pm ON pm.account_code = coa.code
LEFT JOIN prior_movements pm_prior ON pm_prior.account_code = coa.code
WHERE coa.is_active = true AND coa.level >= 3
AND (
COALESCE(pm.period_debit, 0) > 0 OR COALESCE(pm.period_credit, 0) > 0
OR COALESCE(pm_prior.prior_debit, 0) > 0 OR COALESCE(pm_prior.prior_credit, 0) > 0
)
ORDER BY coa.code;
END;
$function$
;
