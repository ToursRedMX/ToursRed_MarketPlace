
-- ============================================================
-- AUDIT, SECURITY & TRACEABILITY — MIGRATION 3
-- insert_audit_log RPC (SECURITY DEFINER, never throws)
-- DB triggers on: users, agencies, tours, admin_permissions, platform_settings
-- ============================================================

-- -------------------------------------------------------
-- 1. insert_audit_log — SECURITY DEFINER RPC
--    Called from edge functions; never raises exceptions.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION insert_audit_log(
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
  p_created_at      timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid := gen_random_uuid();
  v_diff    jsonb;
  v_tenant  tenant_type;
BEGIN
  -- Cast tenant_type safely
  BEGIN
    v_tenant := p_tenant_type::tenant_type;
  EXCEPTION WHEN invalid_text_representation THEN
    v_tenant := 'system'::tenant_type;
  END;

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
    correlation_id, metadata, error_message, created_at
  ) VALUES (
    v_id, v_tenant, p_actor_id, p_actor_email, p_actor_role,
    p_target_id, p_target_table, p_action,
    p_old_values, p_new_values, v_diff,
    p_ip_address, p_ip_masked, p_user_agent, p_session_id,
    p_correlation_id, p_metadata, p_error_message, p_created_at
  );

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Never propagate — best-effort audit
  RETURN NULL;
END;
$$;

-- Grant execute to service_role and authenticated (edge functions use service_role)
GRANT EXECUTE ON FUNCTION insert_audit_log TO service_role;
GRANT EXECUTE ON FUNCTION insert_audit_log TO authenticated;

-- -------------------------------------------------------
-- 2. Generic trigger function for table changes
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action      text;
  v_old_values  jsonb;
  v_new_values  jsonb;
  v_target_id   text;
BEGIN
  v_action := TG_OP;

  IF TG_OP = 'INSERT' THEN
    v_new_values := to_jsonb(NEW);
    v_target_id  := NEW.id::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);
    v_target_id  := NEW.id::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_values := to_jsonb(OLD);
    v_target_id  := OLD.id::text;
  END IF;

  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_target_id    => v_target_id,
    p_target_table => TG_TABLE_NAME,
    p_action       => v_action,
    p_old_values   => v_old_values,
    p_new_values   => v_new_values
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- -------------------------------------------------------
-- 3. Triggers (AFTER, FOR EACH ROW)
-- -------------------------------------------------------

-- users
DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();

-- agencies
DROP TRIGGER IF EXISTS trg_audit_agencies ON agencies;
CREATE TRIGGER trg_audit_agencies
  AFTER INSERT OR UPDATE OR DELETE ON agencies
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();

-- tours
DROP TRIGGER IF EXISTS trg_audit_tours ON tours;
CREATE TRIGGER trg_audit_tours
  AFTER INSERT OR UPDATE OR DELETE ON tours
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();

-- admin_permissions
DROP TRIGGER IF EXISTS trg_audit_admin_permissions ON admin_permissions;
CREATE TRIGGER trg_audit_admin_permissions
  AFTER INSERT OR UPDATE OR DELETE ON admin_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();

-- platform_settings (single-row, still important to audit)
DROP TRIGGER IF EXISTS trg_audit_platform_settings ON platform_settings;
CREATE TRIGGER trg_audit_platform_settings
  AFTER INSERT OR UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();
