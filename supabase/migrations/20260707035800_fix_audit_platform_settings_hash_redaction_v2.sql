-- Fix: use schema-qualified extensions.digest() so it resolves correctly
-- when search_path = public (pgcrypto is installed in 'extensions' schema on Supabase).
CREATE OR REPLACE FUNCTION audit_platform_settings_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
  v_col     text;
  v_raw_val text;
  v_hash    text;
BEGIN
  -- DELETE
  IF TG_OP = 'DELETE' THEN
    BEGIN
      v_actor_id := auth.uid();
      IF v_actor_id IS NOT NULL THEN
        SELECT email, role INTO v_actor_email, v_actor_role
          FROM public.users WHERE id = v_actor_id;
      ELSE
        v_actor_role := 'system';
      END IF;
      PERFORM insert_audit_log(
        p_tenant_type  => 'admin',
        p_actor_id     => v_actor_id,
        p_actor_email  => v_actor_email,
        p_actor_role   => v_actor_role,
        p_target_id    => OLD.id::text,
        p_target_table => 'platform_settings',
        p_action       => 'PLATFORM_SETTINGS_DELETED',
        p_old_values   => to_jsonb(OLD),
        p_new_values   => NULL,
        p_severity     => 'warning'
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
      RAISE WARNING 'audit_platform_settings_change (DELETE) failed [%]: %', v_sqlstate, v_sqlerrm;
    END;
    RETURN OLD;
  END IF;

  -- INSERT
  IF TG_OP = 'INSERT' THEN
    BEGIN
      v_actor_id := auth.uid();
      IF v_actor_id IS NOT NULL THEN
        SELECT email, role INTO v_actor_email, v_actor_role
          FROM public.users WHERE id = v_actor_id;
      ELSE
        v_actor_role := 'system';
      END IF;
      PERFORM insert_audit_log(
        p_tenant_type  => 'admin',
        p_actor_id     => v_actor_id,
        p_actor_email  => v_actor_email,
        p_actor_role   => v_actor_role,
        p_target_id    => NEW.id::text,
        p_target_table => 'platform_settings',
        p_action       => 'PLATFORM_SETTINGS_CREATED',
        p_old_values   => NULL,
        p_new_values   => to_jsonb(NEW),
        p_severity     => 'warning'
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
      RAISE WARNING 'audit_platform_settings_change (INSERT) failed [%]: %', v_sqlstate, v_sqlerrm;
    END;
    RETURN NEW;
  END IF;

  -- UPDATE: skip if nothing actually changed
  IF to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Resolve actor
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL AND NEW.updated_by IS NOT NULL THEN
      v_actor_id := NEW.updated_by;
    END IF;
    IF v_actor_id IS NOT NULL THEN
      SELECT email, role INTO v_actor_email, v_actor_role
        FROM public.users WHERE id = v_actor_id;
    ELSE
      v_actor_role := 'system';
    END IF;

    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);

    -- Hash-based redaction: '[REDACTED:XXXXXXXX]' where XXXXXXXX = first 8 hex
    -- chars of SHA-256(value). Same value → same hash; different value → different hash.
    FOREACH v_col IN ARRAY k_secret_cols LOOP
      IF v_old_json ? v_col THEN
        v_raw_val := v_old_json ->> v_col;
        IF v_raw_val IS NULL THEN
          v_hash := '[REDACTED:empty]';
        ELSE
          v_hash := '[REDACTED:' || substring(encode(extensions.digest(v_raw_val, 'sha256'), 'hex') FROM 1 FOR 8) || ']';
        END IF;
        v_old_json := jsonb_set(v_old_json, ARRAY[v_col], to_jsonb(v_hash));
      END IF;

      IF v_new_json ? v_col THEN
        v_raw_val := v_new_json ->> v_col;
        IF v_raw_val IS NULL THEN
          v_hash := '[REDACTED:empty]';
        ELSE
          v_hash := '[REDACTED:' || substring(encode(extensions.digest(v_raw_val, 'sha256'), 'hex') FROM 1 FOR 8) || ']';
        END IF;
        v_new_json := jsonb_set(v_new_json, ARRAY[v_col], to_jsonb(v_hash));
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
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
    RAISE WARNING 'audit_platform_settings_change (UPDATE) failed [%]: %', v_sqlstate, v_sqlerrm;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM PUBLIC, anon, authenticated;
