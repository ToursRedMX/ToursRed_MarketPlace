-- Correction 3: eliminate silent failure in insert_audit_log
-- Create audit_errors table to capture failed audit write attempts

CREATE TABLE IF NOT EXISTS audit_errors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  error_message text        NOT NULL,
  sqlstate      text,
  raw_payload   jsonb,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_errors ENABLE ROW LEVEL SECURITY;

-- Only super admins and service_role can read audit_errors
CREATE POLICY "audit_errors_select_superadmin" ON audit_errors FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_super_admin = true)
  );

-- Service role can insert (used by SECURITY DEFINER function via EXCEPTION handler)
-- No INSERT policy needed — the function runs as SECURITY DEFINER (bypasses RLS for inserts via function)

GRANT SELECT ON audit_errors TO authenticated;
GRANT INSERT, SELECT ON audit_errors TO service_role;

-- -------------------------------------------------------
-- Rewrite insert_audit_log to capture failures instead of swallowing them
-- -------------------------------------------------------
DROP FUNCTION IF EXISTS insert_audit_log(text,uuid,text,text,text,text,text,jsonb,jsonb,inet,text,text,text,uuid,jsonb,text,timestamptz,text,text,text,text);
DROP FUNCTION IF EXISTS insert_audit_log(text,uuid,text,text,text,text,text,jsonb,jsonb,inet,text,text,text,uuid,jsonb,text,timestamptz);

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
  p_region          text        DEFAULT NULL
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
  v_sqlerrm text;
  v_sqlstate text;
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
    correlation_id, metadata, error_message, created_at,
    country, country_code, city, region
  ) VALUES (
    v_id, v_tenant, p_actor_id, p_actor_email, p_actor_role,
    p_target_id, p_target_table, p_action,
    p_old_values, p_new_values, v_diff,
    p_ip_address, p_ip_masked, p_user_agent, p_session_id,
    p_correlation_id, p_metadata, p_error_message, p_created_at,
    p_country, p_country_code, p_city, p_region
  );

  RETURN v_id;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;

  -- Surface the error so it appears in Supabase logs
  RAISE WARNING 'insert_audit_log failed [%]: % | action=% table=% actor=%',
    v_sqlstate, v_sqlerrm, p_action, p_target_table, p_actor_id;

  -- Best-effort: record failure in audit_errors for later review
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
    NULL; -- audit_errors insert also failed — nothing more we can do
  END;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_audit_log TO service_role;
GRANT EXECUTE ON FUNCTION insert_audit_log TO authenticated;

-- -------------------------------------------------------
-- Rewrite audit_table_change to also surface errors via RAISE WARNING
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
  v_sqlerrm     text;
  v_sqlstate    text;
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

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_table_change failed on % [%]: % [%]',
    TG_TABLE_NAME, TG_OP, v_sqlerrm, v_sqlstate;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;
