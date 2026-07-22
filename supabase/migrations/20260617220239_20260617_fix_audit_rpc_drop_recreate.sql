-- Must DROP first because return type changes (session_id: uuid→text, ip_address: text→text from inet cast)
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
  p_offset         int         DEFAULT 0
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
  total_count    bigint
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
    COUNT(*) OVER () AS total_count
  FROM audit_logs al
  WHERE
    (p_action IS NULL        OR al.action = upper(p_action))
    AND (p_target_table IS NULL OR al.target_table ILIKE '%' || p_target_table || '%')
    AND (p_actor_email IS NULL  OR al.actor_email ILIKE '%' || p_actor_email || '%')
    AND (p_correlation_id IS NULL OR al.correlation_id = p_correlation_id)
    AND (p_date_from IS NULL    OR al.created_at >= p_date_from)
    AND (p_date_to IS NULL      OR al.created_at <= p_date_to)
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
  p_offset         int         DEFAULT 0
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
  total_count    bigint
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
    COUNT(*) OVER () AS total_count
  FROM audit_logs al
  WHERE
    (p_action IS NULL        OR al.action = upper(p_action))
    AND (p_target_table IS NULL OR al.target_table ILIKE '%' || p_target_table || '%')
    AND (p_actor_email IS NULL  OR al.actor_email ILIKE '%' || p_actor_email || '%')
    AND (p_correlation_id IS NULL OR al.correlation_id = p_correlation_id)
    AND (p_date_from IS NULL    OR al.created_at >= p_date_from)
    AND (p_date_to IS NULL      OR al.created_at <= p_date_to)
  ORDER BY al.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_logs_sensitive TO authenticated;
