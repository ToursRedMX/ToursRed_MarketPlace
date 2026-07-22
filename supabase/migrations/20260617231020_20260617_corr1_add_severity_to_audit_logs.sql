-- Correction 1: Add severity column to audit_logs and update all related functions

-- 1. Add column to parent table (partitions inherit it automatically)
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical'));

-- 2. Composite index for severity filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity_created
  ON audit_logs (severity, created_at DESC);

-- 3. Drop and recreate insert_audit_log with p_severity param
DROP FUNCTION IF EXISTS insert_audit_log(text,uuid,text,text,text,text,text,jsonb,jsonb,inet,text,text,text,uuid,jsonb,text,timestamptz,text,text,text,text);

CREATE FUNCTION insert_audit_log(
  p_tenant_type     text,
  p_actor_id        uuid        DEFAULT NULL,
  p_actor_email     text        DEFAULT NULL,
  p_actor_role      text        DEFAULT NULL,
  p_target_id       text        DEFAULT NULL,
  p_target_table    text        DEFAULT NULL,
  p_action          text        DEFAULT NULL,
  p_old_values      jsonb       DEFAULT NULL,
  p_new_values      jsonb       DEFAULT NULL,
  p_ip_address      inet        DEFAULT NULL,
  p_ip_masked       text        DEFAULT NULL,
  p_user_agent      text        DEFAULT NULL,
  p_session_id      text        DEFAULT NULL,
  p_correlation_id  uuid        DEFAULT NULL,
  p_metadata        jsonb       DEFAULT NULL,
  p_error_message   text        DEFAULT NULL,
  p_created_at      timestamptz DEFAULT now(),
  p_country         text        DEFAULT NULL,
  p_country_code    text        DEFAULT NULL,
  p_city            text        DEFAULT NULL,
  p_region          text        DEFAULT NULL,
  p_severity        text        DEFAULT 'info'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid := gen_random_uuid();
  v_diff      jsonb;
  v_tenant    tenant_type;
  v_severity  text;
  v_sqlerrm   text;
  v_sqlstate  text;
BEGIN
  -- Cast tenant_type safely
  BEGIN
    v_tenant := p_tenant_type::tenant_type;
  EXCEPTION WHEN invalid_text_representation THEN
    v_tenant := 'system'::tenant_type;
  END;

  -- Validate severity
  v_severity := CASE WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity ELSE 'info' END;

  -- Compute diff
  IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
    SELECT jsonb_object_agg(n.key, n.value)
      INTO v_diff
      FROM jsonb_each(p_new_values) n
      WHERE NOT (p_old_values @> jsonb_build_object(n.key, n.value));
  END IF;

  INSERT INTO audit_logs (
    id, tenant_type, actor_id, actor_email, actor_role,
    target_id, target_table, action,
    old_values, new_values, diff,
    ip_address, ip_masked, user_agent, session_id,
    correlation_id, metadata, error_message, created_at,
    country, country_code, city, region, severity
  ) VALUES (
    v_id, v_tenant, p_actor_id, p_actor_email, p_actor_role,
    p_target_id, p_target_table, p_action,
    p_old_values, p_new_values, v_diff,
    p_ip_address, p_ip_masked, p_user_agent, p_session_id,
    p_correlation_id, p_metadata, p_error_message, p_created_at,
    p_country, p_country_code, p_city, p_region, v_severity
  );

  RETURN v_id;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;

  RAISE WARNING 'insert_audit_log failed [%]: % | action=% table=% actor=%',
    v_sqlstate, v_sqlerrm, p_action, p_target_table, p_actor_id;

  BEGIN
    INSERT INTO audit_errors (error_message, sqlstate, raw_payload)
    VALUES (
      v_sqlerrm,
      v_sqlstate,
      jsonb_build_object(
        'action',       p_action,
        'target_table', p_target_table,
        'actor_id',     p_actor_id,
        'actor_email',  p_actor_email,
        'tenant_type',  p_tenant_type
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_audit_log TO service_role;
GRANT EXECUTE ON FUNCTION insert_audit_log TO authenticated;

-- 4. Drop and recreate query RPCs with severity column + filter param
DROP FUNCTION IF EXISTS get_audit_logs(text,text,text,uuid,timestamptz,timestamptz,int,int);
DROP FUNCTION IF EXISTS get_audit_logs_sensitive(text,text,text,uuid,timestamptz,timestamptz,int,int);

CREATE FUNCTION get_audit_logs(
  p_action         text        DEFAULT NULL,
  p_target_table   text        DEFAULT NULL,
  p_actor_email    text        DEFAULT NULL,
  p_correlation_id uuid        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_limit          int         DEFAULT 25,
  p_offset         int         DEFAULT 0,
  p_severity       text        DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  tenant_type    text,
  actor_id       uuid,
  actor_email    text,
  actor_role     text,
  target_id      text,
  target_table   text,
  action         text,
  old_values     jsonb,
  new_values     jsonb,
  diff           jsonb,
  ip_masked      text,
  session_id     text,
  correlation_id uuid,
  metadata       jsonb,
  error_message  text,
  created_at     timestamptz,
  total_count    bigint,
  country        text,
  country_code   text,
  city           text,
  region         text,
  severity       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_can_view  boolean;
  v_is_super  boolean;
BEGIN
  SELECT
    COALESCE(u.is_super_admin, false),
    COALESCE(ap.can_view_audit_log, false)
  INTO v_is_super, v_can_view
  FROM users u
  LEFT JOIN admin_permissions ap ON ap.user_id = u.id
  WHERE u.id = v_caller_id;

  IF NOT (v_is_super OR v_can_view) THEN
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
$$;

CREATE FUNCTION get_audit_logs_sensitive(
  p_action         text        DEFAULT NULL,
  p_target_table   text        DEFAULT NULL,
  p_actor_email    text        DEFAULT NULL,
  p_correlation_id uuid        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_limit          int         DEFAULT 25,
  p_offset         int         DEFAULT 0,
  p_severity       text        DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  tenant_type    text,
  actor_id       uuid,
  actor_email    text,
  actor_role     text,
  target_id      text,
  target_table   text,
  action         text,
  old_values     jsonb,
  new_values     jsonb,
  diff           jsonb,
  ip_masked      text,
  ip_address     text,
  user_agent     text,
  session_id     text,
  correlation_id uuid,
  metadata       jsonb,
  error_message  text,
  created_at     timestamptz,
  total_count    bigint,
  country        text,
  country_code   text,
  city           text,
  region         text,
  severity       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid := auth.uid();
  v_can_sensitive boolean;
  v_is_super      boolean;
BEGIN
  SELECT
    COALESCE(u.is_super_admin, false),
    COALESCE(ap.can_view_audit_sensitive_data, false)
  INTO v_is_super, v_can_sensitive
  FROM users u
  LEFT JOIN admin_permissions ap ON ap.user_id = u.id
  WHERE u.id = v_caller_id;

  IF NOT (v_is_super OR v_can_sensitive) THEN
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
$$;

GRANT EXECUTE ON FUNCTION get_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_logs_sensitive TO authenticated;
