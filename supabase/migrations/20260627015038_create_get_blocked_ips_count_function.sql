
CREATE OR REPLACE FUNCTION get_blocked_ips_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT (v_is_super OR v_can_view) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT
    COALESCE(login_max_attempts_ip, 20),
    COALESCE(login_block_duration_min, 30)
  INTO v_max_attempts, v_block_minutes
  FROM platform_settings
  LIMIT 1;

  v_window_start := now() - (v_block_minutes || ' minutes')::interval;

  SELECT COUNT(DISTINCT ip_address) INTO v_count
  FROM failed_login_attempts
  WHERE ip_address IS NOT NULL
    AND attempted_at >= v_window_start
  GROUP BY ip_address
  HAVING COUNT(*) >= v_max_attempts;

  -- COUNT(DISTINCT ...) with HAVING returns rows, not a scalar; fix:
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
$$;

GRANT EXECUTE ON FUNCTION get_blocked_ips_count() TO authenticated;
