-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260815072931
--   name:    fix_get_blocked_ips_count_null_bypass
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

-- New finding (TR-AC-004 / related to Hallazgo #70): get_blocked_ips_count()
-- checks `NOT (v_is_super OR v_can_view)` but when the caller doesn't match
-- any row in `users` (e.g. anon/no session, auth.uid() = NULL), both variables
-- stay NULL. In PL/pgSQL, `IF NULL THEN` is treated as false, so the exception
-- never fires and the function silently returns real blocked-IP data to an
-- unauthenticated caller. PUBLIC/anon/authenticated all have EXECUTE on this
-- function, so it's reachable via PostgREST without a session.
CREATE OR REPLACE FUNCTION public.get_blocked_ips_count()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id     uuid := auth.uid();
v_is_super      boolean;
v_can_view      boolean;
v_max_attempts  int;
v_block_minutes int;
v_window_start  timestamptz;
v_count         bigint;
BEGIN
SELECT
COALESCE(u.is_super_admin, false),
COALESCE(ap.can_view_audit_log, false)
INTO v_is_super, v_can_view
FROM users u
LEFT JOIN admin_permissions ap ON ap.user_id = u.id
WHERE u.id = v_caller_id;

IF v_caller_id IS NULL OR NOT (COALESCE(v_is_super, false) OR COALESCE(v_can_view, false)) THEN
RAISE EXCEPTION 'permission_denied';
END IF;

SELECT
COALESCE(login_max_attempts_ip, 20),
COALESCE(login_block_duration_min, 30)
INTO v_max_attempts, v_block_minutes
FROM platform_settings
LIMIT 1;

v_window_start := now() - (v_block_minutes || ' minutes')::interval;

SELECT COUNT(*) INTO v_count
FROM (
SELECT ip_address
FROM failed_login_attempts
WHERE ip_address IS NOT NULL
AND attempted_at >= v_window_start
GROUP BY ip_address
HAVING COUNT(*) >= v_max_attempts
) blocked;

RETURN COALESCE(v_count, 0);
END;
$function$
;
