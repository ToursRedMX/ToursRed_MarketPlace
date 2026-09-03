-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831051033
--   name:    CRITICAL_fix_audit_logs_null_bypass
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

-- CRITICO: v_is_super y v_can_view/v_can_sensitive quedaban en NULL (no en
-- false) cuando la fila del usuario no existia (auth.uid() NULL, sin
-- sesion), porque el SELECT INTO simplemente no toca las variables si la
-- consulta no encuentra filas -- el COALESCE dentro del SELECT list nunca
-- se ejecuta. "IF NOT (NULL OR NULL) THEN" evalua a "IF NOT NULL" = "IF
-- NULL", que en PL/pgSQL NO dispara la excepcion. Confirmado en vivo: sin
-- ninguna sesion se obtuvo un dump completo de 1314 registros de
-- audit_logs, incluyendo RFC/CURP/telefono/direccion completos de usuarios
-- reales, huellas de dispositivo de login, y (en la version sensitive) IP
-- reales sin enmascarar. Se corrige envolviendo la condicion completa en
-- COALESCE.
CREATE OR REPLACE FUNCTION public.get_audit_logs(p_action text DEFAULT NULL::text, p_target_table text DEFAULT NULL::text, p_actor_email text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_severity text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, tenant_type text, actor_id uuid, actor_email text, actor_role text, target_id text, target_table text, action text, old_values jsonb, new_values jsonb, diff jsonb, ip_masked text, session_id text, correlation_id uuid, metadata jsonb, error_message text, created_at timestamp with time zone, total_count bigint, country text, country_code text, city text, region text, severity text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id uuid := auth.uid();
v_can_view  boolean;
v_is_super  boolean;
BEGIN
IF v_caller_id IS NULL THEN
RAISE EXCEPTION 'permission_denied';
END IF;

SELECT
COALESCE(u.is_super_admin, false),
COALESCE(ap.can_view_audit_log, false)
INTO v_is_super, v_can_view
FROM users u
LEFT JOIN admin_permissions ap ON ap.user_id = u.id
WHERE u.id = v_caller_id;

IF NOT COALESCE(v_is_super, false) AND NOT COALESCE(v_can_view, false) THEN
RAISE EXCEPTION 'permission_denied';
END IF;

RETURN QUERY
SELECT
al.id,
al.tenant_type::text,
al.actor_id,
al.actor_email,
al.actor_role,
al.target_id,
al.target_table,
al.action,
al.old_values,
al.new_values,
al.diff,
al.ip_masked,
al.session_id,
al.correlation_id,
al.metadata,
al.error_message,
al.created_at,
COUNT(*) OVER () AS total_count,
al.country,
al.country_code,
al.city,
al.region,
al.severity
FROM audit_logs al
WHERE
(p_action IS NULL        OR al.action = upper(p_action))
AND (p_target_table IS NULL OR al.target_table ILIKE '%' || p_target_table || '%')
AND (p_actor_email IS NULL  OR al.actor_email ILIKE '%' || p_actor_email || '%')
AND (p_correlation_id IS NULL OR al.correlation_id = p_correlation_id)
AND (p_date_from IS NULL    OR al.created_at >= p_date_from)
AND (p_date_to IS NULL      OR al.created_at <= p_date_to)
AND (p_severity IS NULL     OR al.severity = p_severity)
ORDER BY al.created_at DESC
LIMIT p_limit
OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_audit_logs_sensitive(p_action text DEFAULT NULL::text, p_target_table text DEFAULT NULL::text, p_actor_email text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_severity text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, tenant_type text, actor_id uuid, actor_email text, actor_role text, target_id text, target_table text, action text, old_values jsonb, new_values jsonb, diff jsonb, ip_masked text, ip_address text, user_agent text, session_id text, correlation_id uuid, metadata jsonb, error_message text, created_at timestamp with time zone, total_count bigint, country text, country_code text, city text, region text, severity text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id     uuid := auth.uid();
v_can_sensitive boolean;
v_is_super      boolean;
BEGIN
IF v_caller_id IS NULL THEN
RAISE EXCEPTION 'permission_denied';
END IF;

SELECT
COALESCE(u.is_super_admin, false),
COALESCE(ap.can_view_audit_sensitive_data, false)
INTO v_is_super, v_can_sensitive
FROM users u
LEFT JOIN admin_permissions ap ON ap.user_id = u.id
WHERE u.id = v_caller_id;

IF NOT COALESCE(v_is_super, false) AND NOT COALESCE(v_can_sensitive, false) THEN
RAISE EXCEPTION 'permission_denied';
END IF;

RETURN QUERY
SELECT
al.id,
al.tenant_type::text,
al.actor_id,
al.actor_email,
al.actor_role,
al.target_id,
al.target_table,
al.action,
al.old_values,
al.new_values,
al.diff,
al.ip_masked,
al.ip_address::text,
al.user_agent,
al.session_id,
al.correlation_id,
al.metadata,
al.error_message,
al.created_at,
COUNT(*) OVER () AS total_count,
al.country,
al.country_code,
al.city,
al.region,
al.severity
FROM audit_logs al
WHERE
(p_action IS NULL        OR al.action = upper(p_action))
AND (p_target_table IS NULL OR al.target_table ILIKE '%' || p_target_table || '%')
AND (p_actor_email IS NULL  OR al.actor_email ILIKE '%' || p_actor_email || '%')
AND (p_correlation_id IS NULL OR al.correlation_id = p_correlation_id)
AND (p_date_from IS NULL    OR al.created_at >= p_date_from)
AND (p_date_to IS NULL      OR al.created_at <= p_date_to)
AND (p_severity IS NULL     OR al.severity = p_severity)
ORDER BY al.created_at DESC
LIMIT p_limit
OFFSET p_offset;
END;
$function$
;
