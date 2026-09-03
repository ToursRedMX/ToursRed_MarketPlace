-- ============================================================
-- AUDIT SECURITY LOCKDOWN
-- Revoke direct table/view access, enable RLS, secure RPCs
-- ============================================================

-- 1. REVOKE all direct privileges from anon and authenticated
--    on audit_logs parent and all partitions
REVOKE ALL ON audit_logs FROM anon, authenticated;
REVOKE ALL ON audit_logs_2025 FROM anon, authenticated;
REVOKE ALL ON audit_logs_2026 FROM anon, authenticated;
REVOKE ALL ON audit_logs_2027 FROM anon, authenticated;
REVOKE ALL ON audit_logs_2028 FROM anon, authenticated;
REVOKE ALL ON audit_logs_2029 FROM anon, authenticated;

-- Revoke on audit views
REVOKE ALL ON audit_logs_view FROM anon, authenticated;
REVOKE ALL ON audit_logs_sensitive_view FROM anon, authenticated;
REVOKE ALL ON user_sessions_view FROM anon, authenticated;

-- Revoke on user_sessions base table (service_role only)
REVOKE ALL ON user_sessions FROM anon, authenticated;

-- Revoke on failed_login_attempts
REVOKE ALL ON failed_login_attempts FROM anon, authenticated;

-- 2. Revoke EXECUTE on insert_audit_log from authenticated/anon
--    (only service_role and internal triggers should call it)
REVOKE EXECUTE ON FUNCTION insert_audit_log FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION insert_audit_log TO service_role;

-- 3. Enable RLS on audit_logs and all partitions
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_2025 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_2028 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_2029 ENABLE ROW LEVEL SECURITY;

-- Enable RLS on user_sessions and failed_login_attempts
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_login_attempts ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies — only service_role bypass (authenticated has no direct access)
--    service_role bypasses RLS by default in Supabase, so no policy needed for it.
--    We add a deny-all policy for authenticated as safety net.
CREATE POLICY "deny_authenticated_audit_logs" ON audit_logs
  FOR ALL TO authenticated USING (false);

CREATE POLICY "deny_authenticated_audit_logs_2025" ON audit_logs_2025
  FOR ALL TO authenticated USING (false);

CREATE POLICY "deny_authenticated_audit_logs_2026" ON audit_logs_2026
  FOR ALL TO authenticated USING (false);

CREATE POLICY "deny_authenticated_audit_logs_2027" ON audit_logs_2027
  FOR ALL TO authenticated USING (false);

CREATE POLICY "deny_authenticated_audit_logs_2028" ON audit_logs_2028
  FOR ALL TO authenticated USING (false);

CREATE POLICY "deny_authenticated_audit_logs_2029" ON audit_logs_2029
  FOR ALL TO authenticated USING (false);

-- user_sessions: users can only see their own sessions (via RPC below)
CREATE POLICY "deny_authenticated_user_sessions" ON user_sessions
  FOR ALL TO authenticated USING (false);

-- failed_login_attempts: no direct access
CREATE POLICY "deny_authenticated_failed_logins" ON failed_login_attempts
  FOR ALL TO authenticated USING (false);

-- 5. Secure RPC: get_audit_logs — validates admin permission internally
CREATE OR REPLACE FUNCTION get_audit_logs(
  p_action        text      DEFAULT NULL,
  p_target_table  text      DEFAULT NULL,
  p_actor_email   text      DEFAULT NULL,
  p_correlation_id uuid     DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_limit         int       DEFAULT 25,
  p_offset        int       DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  tenant_type     text,
  actor_id        uuid,
  actor_email     text,
  actor_role      text,
  target_id       text,
  target_table    text,
  action          text,
  old_values      jsonb,
  new_values      jsonb,
  diff            jsonb,
  ip_masked       text,
  session_id      uuid,
  correlation_id  uuid,
  metadata        jsonb,
  error_message   text,
  created_at      timestamptz,
  total_count     bigint
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
  -- Validate permission
  SELECT
    (u.raw_user_meta_data->>'is_super_admin')::boolean,
    COALESCE(ap.can_view_audit_log, false)
  INTO v_is_super, v_can_view
  FROM auth.users u
  LEFT JOIN admin_permissions ap ON ap.user_id = u.id
  WHERE u.id = v_caller_id;

  IF NOT (v_is_super OR v_can_view) THEN
    RAISE EXCEPTION 'permission_denied: audit log access requires can_view_audit_log';
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

-- 6. Secure RPC: get_audit_logs_sensitive — requires can_view_audit_sensitive_data
CREATE OR REPLACE FUNCTION get_audit_logs_sensitive(
  p_action        text      DEFAULT NULL,
  p_target_table  text      DEFAULT NULL,
  p_actor_email   text      DEFAULT NULL,
  p_correlation_id uuid     DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_limit         int       DEFAULT 25,
  p_offset        int       DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  tenant_type     text,
  actor_id        uuid,
  actor_email     text,
  actor_role      text,
  target_id       text,
  target_table    text,
  action          text,
  old_values      jsonb,
  new_values      jsonb,
  diff            jsonb,
  ip_masked       text,
  ip_address      text,
  user_agent      text,
  session_id      uuid,
  correlation_id  uuid,
  metadata        jsonb,
  error_message   text,
  created_at      timestamptz,
  total_count     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       uuid := auth.uid();
  v_can_sensitive   boolean;
  v_is_super        boolean;
BEGIN
  SELECT
    (u.raw_user_meta_data->>'is_super_admin')::boolean,
    COALESCE(ap.can_view_audit_sensitive_data, false)
  INTO v_is_super, v_can_sensitive
  FROM auth.users u
  LEFT JOIN admin_permissions ap ON ap.user_id = u.id
  WHERE u.id = v_caller_id;

  IF NOT (v_is_super OR v_can_sensitive) THEN
    RAISE EXCEPTION 'permission_denied: sensitive audit access requires can_view_audit_sensitive_data';
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
    al.ip_address,
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

-- 7. Secure RPC: get_my_sessions — caller sees only their own sessions
CREATE OR REPLACE FUNCTION get_my_sessions(
  p_limit  int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  session_id      uuid,
  login_at        timestamptz,
  logout_at       timestamptz,
  ip_masked       text,
  browser         text,
  browser_version text,
  os              text,
  os_version      text,
  device_type     text,
  device_name     text,
  country         text,
  city            text,
  login_method    text,
  success         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'permission_denied: must be authenticated';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.session_id,
    s.login_at,
    s.logout_at,
    s.ip_masked,
    s.browser,
    s.browser_version,
    s.os,
    s.os_version,
    s.device_type,
    s.device_name,
    s.country,
    s.city,
    s.login_method,
    s.success
  FROM user_sessions s
  WHERE s.user_id = v_caller_id
  ORDER BY s.login_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Grant EXECUTE only to authenticated (they go through permission checks inside)
GRANT EXECUTE ON FUNCTION get_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_logs_sensitive TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_sessions TO authenticated;

-- Revoke from anon explicitly
REVOKE EXECUTE ON FUNCTION get_audit_logs FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_audit_logs_sensitive FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_my_sessions FROM anon, public;
