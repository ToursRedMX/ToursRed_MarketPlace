-- Replaces the existing audit_platform_settings_change() trigger function with a version that:
--   1. Resolves the actor from auth.uid() (PostgREST JWT) with fallback to NEW.updated_by,
--      then NULL with role 'system' for service-role writes.
--   2. Looks up actor email + role from public.users.
--   3. Redacts 6 sensitive credential columns in both old_values and new_values so that
--      secrets never appear in audit_logs.
--   4. Skips the log entry entirely when OLD and NEW are identical (no real change).
--   5. Uses p_tenant_type 'admin' and p_severity 'warning'.
--   6. Never blocks the UPDATE — all errors are caught and re-raised as WARNING.

CREATE OR REPLACE FUNCTION audit_platform_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    uuid;
  v_actor_email text;
  v_actor_role  text;
  v_old_json    jsonb;
  v_new_json    jsonb;
  v_sqlerrm     text;
  v_sqlstate    text;
  k_secret_cols text[] := ARRAY[
    'paypal_client_secret',
    'mercadopago_access_token',
    'pac_api_key_encrypted',
    'zoho_client_secret',
    'odoo_api_key_encrypted',
    'geo_api_key'
  ];
  v_col text;
BEGIN

  -- DELETE (rare — platform_settings is a singleton, but handle defensively)
  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'admin',
      p_target_id    => OLD.id::text,
      p_target_table => 'platform_settings',
      p_action       => 'PLATFORM_SETTINGS_DELETED',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  -- INSERT
  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'admin',
      p_target_id    => NEW.id::text,
      p_target_table => 'platform_settings',
      p_action       => 'PLATFORM_SETTINGS_CREATED',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE -----------------------------------------------------------

  -- Skip when nothing actually changed (some code paths do no-op UPDATEs)
  IF to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  -- Resolve actor: JWT uid → updated_by column → NULL (system)
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL AND NEW.updated_by IS NOT NULL THEN
    v_actor_id := NEW.updated_by;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT email, role
      INTO v_actor_email, v_actor_role
      FROM public.users
     WHERE id = v_actor_id;
    -- rows not found leave both variables NULL — acceptable
  ELSE
    v_actor_role := 'system';
  END IF;

  -- Build JSON snapshots with secrets redacted
  v_old_json := to_jsonb(OLD);
  v_new_json := to_jsonb(NEW);

  FOREACH v_col IN ARRAY k_secret_cols LOOP
    IF v_old_json ? v_col THEN
      v_old_json := jsonb_set(v_old_json, ARRAY[v_col], '"[REDACTED]"'::jsonb);
    END IF;
    IF v_new_json ? v_col THEN
      v_new_json := jsonb_set(v_new_json, ARRAY[v_col], '"[REDACTED]"'::jsonb);
    END IF;
  END LOOP;

  PERFORM insert_audit_log(
    p_tenant_type  => 'admin',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
    p_target_id    => NEW.id::text,
    p_target_table => 'platform_settings',
    p_action       => 'PLATFORM_SETTINGS_UPDATED',
    p_old_values   => v_old_json,
    p_new_values   => v_new_json,
    p_severity     => 'warning'
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_platform_settings_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Re-wire trigger (idempotent — ensures correct state regardless of migration history)
DROP TRIGGER IF EXISTS trg_audit_platform_settings ON platform_settings;
CREATE TRIGGER trg_audit_platform_settings
  AFTER INSERT OR UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION audit_platform_settings_change();

-- Lock down execute permissions to match project security standards
REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM authenticated;
