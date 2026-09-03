-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831011600
--   name:    fix_null_role_bypass_in_accounting_stats_checks
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

-- BUG CONFIRMADO: "v_caller_role NOT IN (...)" cuando v_caller_role es NULL
-- (auth.uid() no encuentra usuario, ej. llamada sin sesion o con anon key)
-- evalua a NULL, no a TRUE -- el IF nunca dispara la excepcion y CUALQUIERA
-- podia llamar la funcion sin autenticarse. Confirmado en vivo: se pudo
-- ejecutar get_cfdi_stats() sin ningun auth.uid() presente. Se corrige
-- agregando "v_caller_role IS NULL OR" antes del NOT IN.
CREATE OR REPLACE FUNCTION public.get_accounting_sync_stats()
 RETURNS TABLE(provider text, total_synced bigint, total_pending bigint, total_errors bigint, total_skipped bigint, contacts_synced bigint, bookings_synced bigint, payouts_synced bigint, last_sync_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'super_admin', 'accountant') THEN
RAISE EXCEPTION 'Unauthorized';
END IF;

RETURN QUERY
SELECT
asl.provider,
COUNT(*) FILTER (WHERE asl.status = 'synced') AS total_synced,
COUNT(*) FILTER (WHERE asl.status = 'pending') AS total_pending,
COUNT(*) FILTER (WHERE asl.status = 'error') AS total_errors,
COUNT(*) FILTER (WHERE asl.status = 'skipped') AS total_skipped,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('contact_agency', 'contact_traveler')) AS contacts_synced,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type = 'booking') AS bookings_synced,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('payout', 'commission')) AS payouts_synced,
MAX(asl.synced_at) FILTER (WHERE asl.status = 'synced') AS last_sync_at
FROM accounting_sync_log asl
GROUP BY asl.provider;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cfdi_stats()
 RETURNS TABLE(total_stamped bigint, total_pending bigint, total_errors bigint, total_cancelled bigint, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'super_admin', 'accountant') THEN
RAISE EXCEPTION 'Unauthorized';
END IF;

RETURN QUERY
SELECT
COUNT(*) FILTER (WHERE status = 'stamped'),
COUNT(*) FILTER (WHERE status = 'pending'),
COUNT(*) FILTER (WHERE status = 'error'),
COUNT(*) FILTER (WHERE status = 'cancelled'),
COALESCE(SUM(total) FILTER (WHERE status = 'stamped'), 0)
FROM cfdi_invoices;
END;
$function$
;
