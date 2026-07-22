-- Drop old signature and recreate with geo fields
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
BEGIN
  BEGIN
    v_tenant := p_tenant_type::tenant_type;
  EXCEPTION WHEN invalid_text_representation THEN
    v_tenant := 'system'::tenant_type;
  END;

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
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_audit_log TO service_role;
GRANT EXECUTE ON FUNCTION insert_audit_log TO authenticated;
