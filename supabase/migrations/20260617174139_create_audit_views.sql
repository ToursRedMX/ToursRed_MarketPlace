
-- ============================================================
-- AUDIT, SECURITY & TRACEABILITY — MIGRATION 4
-- Two SECURITY DEFINER views for audit_logs
-- audit_logs_view            — no sensitive columns (IP, user_agent)
-- audit_logs_sensitive_view  — all columns
-- ============================================================

-- -------------------------------------------------------
-- 1. Non-sensitive view (masks IP, omits user_agent)
-- -------------------------------------------------------
CREATE OR REPLACE VIEW audit_logs_view
WITH (security_invoker = false)
AS
SELECT
  id,
  tenant_type,
  actor_id,
  actor_email,
  actor_role,
  target_id,
  target_table,
  action,
  old_values,
  new_values,
  diff,
  ip_masked,          -- pre-computed masked form (e.g. "201.55.xxx.xxx")
  session_id,
  correlation_id,
  metadata,
  error_message,
  created_at
FROM audit_logs;

-- -------------------------------------------------------
-- 2. Sensitive view (full data including raw IP + user_agent)
-- -------------------------------------------------------
CREATE OR REPLACE VIEW audit_logs_sensitive_view
WITH (security_invoker = false)
AS
SELECT
  id,
  tenant_type,
  actor_id,
  actor_email,
  actor_role,
  target_id,
  target_table,
  action,
  old_values,
  new_values,
  diff,
  ip_address,
  ip_masked,
  user_agent,
  session_id,
  correlation_id,
  metadata,
  error_message,
  created_at
FROM audit_logs;

-- -------------------------------------------------------
-- 3. Grant SELECT on views to authenticated
--    RLS is applied at the application layer via the
--    admin_permissions columns (can_view_audit_log,
--    can_view_audit_sensitive_data); edge functions must
--    verify permissions before returning data.
-- -------------------------------------------------------
GRANT SELECT ON audit_logs_view           TO authenticated;
GRANT SELECT ON audit_logs_sensitive_view TO authenticated;

-- service_role needs full access (for edge functions)
GRANT ALL ON audit_logs_view           TO service_role;
GRANT ALL ON audit_logs_sensitive_view TO service_role;

-- -------------------------------------------------------
-- 4. user_sessions non-sensitive view (masks IP)
-- -------------------------------------------------------
CREATE OR REPLACE VIEW user_sessions_view
WITH (security_invoker = false)
AS
SELECT
  id,
  user_id,
  session_id,
  login_at,
  logout_at,
  ip_masked,
  country,
  country_code,
  city,
  region,
  is_proxy,
  is_hosting,
  geo_provider,
  browser,
  browser_version,
  os,
  os_version,
  device_type,
  device_name,
  device_fingerprint,
  login_method,
  success,
  failure_reason,
  created_at
FROM user_sessions;

GRANT SELECT ON user_sessions_view TO authenticated;
GRANT ALL    ON user_sessions_view TO service_role;
