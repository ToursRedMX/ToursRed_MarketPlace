-- Correction 2: Replace generic INSERT/UPDATE/DELETE triggers with smart business event detection

-- -------------------------------------------------------
-- Smart trigger for agencies table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_agencies_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action    text;
  v_severity  text := 'info';
  v_sqlerrm   text;
  v_sqlstate  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => OLD.id::text,
      p_target_table => 'agencies',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => 'INSERT',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE — detect specific business events
  -- Agency approved
  IF OLD.is_approved IS DISTINCT FROM NEW.is_approved AND NEW.is_approved = true THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => 'AGENCY_APPROVED',
      p_severity     => 'info',
      p_old_values   => jsonb_build_object('is_approved', OLD.is_approved),
      p_new_values   => jsonb_build_object('is_approved', NEW.is_approved)
    );
    RETURN NEW;
  END IF;

  -- Agency rejected (is_approved set to false with rejection_reason)
  IF OLD.is_approved IS DISTINCT FROM NEW.is_approved AND NEW.is_approved = false
     AND NEW.rejection_reason IS NOT NULL THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => 'AGENCY_REJECTED',
      p_severity     => 'warning',
      p_old_values   => jsonb_build_object('is_approved', OLD.is_approved, 'rejection_reason', OLD.rejection_reason),
      p_new_values   => jsonb_build_object('is_approved', NEW.is_approved, 'rejection_reason', NEW.rejection_reason)
    );
    RETURN NEW;
  END IF;

  -- Agency suspended / reactivated
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    IF NEW.is_active = false THEN
      v_action   := 'AGENCY_SUSPENDED';
      v_severity := 'warning';
    ELSE
      v_action   := 'AGENCY_REACTIVATED';
      v_severity := 'info';
    END IF;
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('is_active', OLD.is_active),
      p_new_values   => jsonb_build_object('is_active', NEW.is_active)
    );
    RETURN NEW;
  END IF;

  -- Bank account updated (cuenta_clabe or titular_cuenta)
  IF OLD.cuenta_clabe IS DISTINCT FROM NEW.cuenta_clabe
     OR OLD.titular_cuenta IS DISTINCT FROM NEW.titular_cuenta THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => 'AGENCY_BANK_ACCOUNT_UPDATED',
      p_severity     => 'critical',
      p_old_values   => jsonb_build_object('cuenta_clabe', OLD.cuenta_clabe, 'titular_cuenta', OLD.titular_cuenta),
      p_new_values   => jsonb_build_object('cuenta_clabe', NEW.cuenta_clabe, 'titular_cuenta', NEW.titular_cuenta)
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_target_id    => NEW.id::text,
    p_target_table => 'agencies',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_agencies_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- -------------------------------------------------------
-- Smart trigger for users table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_users_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action   text;
  v_severity text := 'info';
  v_sqlerrm  text;
  v_sqlstate text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => OLD.id::text,
      p_target_table => 'users',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => 'INSERT',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- Role changed
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => 'ROLE_CHANGED',
      p_severity     => 'warning',
      p_old_values   => jsonb_build_object('role', OLD.role),
      p_new_values   => jsonb_build_object('role', NEW.role)
    );
    RETURN NEW;
  END IF;

  -- Email changed
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => 'EMAIL_CHANGED',
      p_severity     => 'warning',
      p_old_values   => jsonb_build_object('email', OLD.email),
      p_new_values   => jsonb_build_object('email', NEW.email)
    );
    RETURN NEW;
  END IF;

  -- User approved
  IF OLD.is_approved IS DISTINCT FROM NEW.is_approved AND NEW.is_approved = true THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => 'USER_APPROVED',
      p_severity     => 'info',
      p_old_values   => jsonb_build_object('is_approved', OLD.is_approved),
      p_new_values   => jsonb_build_object('is_approved', NEW.is_approved)
    );
    RETURN NEW;
  END IF;

  -- User deactivated / reactivated
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    IF NEW.is_active = false THEN
      v_action   := 'USER_DEACTIVATED';
      v_severity := 'warning';
    ELSE
      v_action   := 'USER_REACTIVATED';
      v_severity := 'info';
    END IF;
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('is_active', OLD.is_active),
      p_new_values   => jsonb_build_object('is_active', NEW.is_active)
    );
    RETURN NEW;
  END IF;

  -- Super admin flag toggled
  IF OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'users',
      p_action       => 'SUPER_ADMIN_CHANGED',
      p_severity     => 'critical',
      p_old_values   => jsonb_build_object('is_super_admin', OLD.is_super_admin),
      p_new_values   => jsonb_build_object('is_super_admin', NEW.is_super_admin)
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_target_id    => NEW.id::text,
    p_target_table => 'users',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_users_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- -------------------------------------------------------
-- Smart trigger for admin_permissions table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_admin_permissions_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sqlerrm  text;
  v_sqlstate text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => OLD.user_id::text,
      p_target_table => 'admin_permissions',
      p_action       => 'ADMIN_PERMISSIONS_REVOKED',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.user_id::text,
      p_target_table => 'admin_permissions',
      p_action       => 'ADMIN_PERMISSIONS_GRANTED',
      p_severity     => 'critical',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_target_id    => NEW.user_id::text,
    p_target_table => 'admin_permissions',
    p_action       => 'ADMIN_PERMISSIONS_CHANGED',
    p_severity     => 'critical',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_admin_permissions_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- -------------------------------------------------------
-- Smart trigger for platform_settings table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_platform_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action   text;
  v_sqlerrm  text;
  v_sqlstate text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => OLD.id::text,
      p_target_table => 'platform_settings',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_target_id    => NEW.id::text,
      p_target_table => 'platform_settings',
      p_action       => 'INSERT',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE — detect commission_rate change specifically
  v_action := 'PLATFORM_SETTINGS_UPDATED';
  IF OLD.commission_rate IS DISTINCT FROM NEW.commission_rate THEN
    v_action := 'COMMISSION_RATE_UPDATED';
  END IF;

  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_target_id    => NEW.id::text,
    p_target_table => 'platform_settings',
    p_action       => v_action,
    p_severity     => 'warning',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_platform_settings_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- -------------------------------------------------------
-- Rewire triggers to use new smart functions
-- -------------------------------------------------------

-- agencies
DROP TRIGGER IF EXISTS trg_audit_agencies ON agencies;
CREATE TRIGGER trg_audit_agencies
  AFTER INSERT OR UPDATE OR DELETE ON agencies
  FOR EACH ROW EXECUTE FUNCTION audit_agencies_change();

-- users
DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_users_change();

-- admin_permissions
DROP TRIGGER IF EXISTS trg_audit_admin_permissions ON admin_permissions;
CREATE TRIGGER trg_audit_admin_permissions
  AFTER INSERT OR UPDATE OR DELETE ON admin_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_admin_permissions_change();

-- platform_settings
DROP TRIGGER IF EXISTS trg_audit_platform_settings ON platform_settings;
CREATE TRIGGER trg_audit_platform_settings
  AFTER INSERT OR UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION audit_platform_settings_change();

-- tours — keep generic trigger (no special business events identified)
DROP TRIGGER IF EXISTS trg_audit_tours ON tours;
CREATE TRIGGER trg_audit_tours
  AFTER INSERT OR UPDATE OR DELETE ON tours
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();
