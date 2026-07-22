/*
# Fix audit trigger functions to resolve actor identity (BUG-003)

## Problem
audit_logs records NULL for actor_id, actor_email, actor_role on events from
agencies, users, admin_permissions, tours, bookings, agency_payouts, and
payment_transactions.  Root cause: the 7 trigger functions never resolve
auth.uid() nor look up the actor's email/role in public.users.

## Fix
Replicate the pattern already used by audit_platform_settings_change() (the
only trigger that does it correctly) in all 7 affected functions:

  1. Resolve v_actor_id from auth.uid() (PostgREST JWT).
  2. If found, SELECT email, role FROM public.users WHERE id = v_actor_id.
  3. If no session (service-role / cron), set v_actor_role := 'system'.
  4. Pass p_actor_id / p_actor_email / p_actor_role to every insert_audit_log call.

## Functions rewritten
  - audit_table_change()        — generic, used by tours
  - audit_agencies_change()     — 7 insert_audit_log calls
  - audit_users_change()        — 8 insert_audit_log calls
  - audit_admin_permissions_change() — 3 insert_audit_log calls
  - audit_bookings_change()     — 3 insert_audit_log calls
  - audit_payouts_change()      — 3 insert_audit_log calls
  - audit_payment_transactions_change() — 3 insert_audit_log calls

## What does NOT change
  - insert_audit_log() — already accepts actor params, no changes needed.
  - audit_platform_settings_change() — already correct, untouched.
  - All business-event detection logic (AGENCY_APPROVED, ROLE_CHANGED, etc.).
  - All severities, tenant_types, old_values/new_values, EXCEPTION handlers.

## Triggers re-engaged (idempotent)
  trg_audit_tours, trg_audit_agencies, trg_audit_users,
  trg_audit_admin_permissions, trg_audit_bookings,
  trg_audit_agency_payouts, trg_audit_payment_transactions
*/

-- ============================================================
-- 1. audit_table_change() — generic, used by tours
-- ============================================================
CREATE OR REPLACE FUNCTION audit_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_old_values   jsonb;
  v_new_values   jsonb;
  v_target_id    text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
  v_sqlerrm      text;
  v_sqlstate     text;
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

  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
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

-- ============================================================
-- 2. audit_agencies_change() — 7 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_agencies_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => 'AGENCY_APPROVED',
      p_severity     => 'info',
      p_old_values   => jsonb_build_object('is_approved', OLD.is_approved),
      p_new_values   => jsonb_build_object('is_approved', NEW.is_approved)
    );
    RETURN NEW;
  END IF;

  -- Agency rejected
  IF OLD.is_approved IS DISTINCT FROM NEW.is_approved AND NEW.is_approved = false
     AND NEW.rejection_reason IS NOT NULL THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'agencies',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('is_active', OLD.is_active),
      p_new_values   => jsonb_build_object('is_active', NEW.is_active)
    );
    RETURN NEW;
  END IF;

  -- Bank account updated
  IF OLD.cuenta_clabe IS DISTINCT FROM NEW.cuenta_clabe
     OR OLD.titular_cuenta IS DISTINCT FROM NEW.titular_cuenta THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
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

-- ============================================================
-- 3. audit_users_change() — 8 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_users_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
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

-- ============================================================
-- 4. audit_admin_permissions_change() — 3 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_admin_permissions_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
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
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
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

-- ============================================================
-- 5. audit_bookings_change() — 3 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_bookings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => OLD.id::text,
      p_target_table => 'bookings',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'bookings',
      p_action       => 'BOOKING_CREATED',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE — detect status transitions
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status
      WHEN 'confirmed' THEN
        v_action   := 'BOOKING_CONFIRMED';
        v_severity := 'info';
      WHEN 'cancelled' THEN
        v_action   := 'BOOKING_CANCELLED';
        v_severity := 'warning';
      WHEN 'completed' THEN
        v_action   := 'BOOKING_COMPLETED';
        v_severity := 'info';
      ELSE
        v_action   := 'BOOKING_STATUS_CHANGED';
        v_severity := 'info';
    END CASE;

    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'bookings',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('status', OLD.status),
      p_new_values   => jsonb_build_object('status', NEW.status)
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
    p_target_id    => NEW.id::text,
    p_target_table => 'bookings',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_bookings_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ============================================================
-- 6. audit_payouts_change() — 3 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_payouts_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => OLD.id::text,
      p_target_table => 'agency_payouts',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'agency_payouts',
      p_action       => 'PAYOUT_CREATED',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- Payout status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' THEN
      v_action   := 'PAYOUT_PAID';
      v_severity := 'critical';
    ELSE
      v_action   := 'PAYOUT_STATUS_CHANGED';
      v_severity := 'warning';
    END IF;

    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'agency_payouts',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('status', OLD.status, 'amount', OLD.amount),
      p_new_values   => jsonb_build_object('status', NEW.status, 'amount', NEW.amount, 'bank_reference', NEW.bank_reference)
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
    p_target_id    => NEW.id::text,
    p_target_table => 'agency_payouts',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_payouts_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ============================================================
-- 7. audit_payment_transactions_change() — 3 insert_audit_log calls
-- ============================================================
CREATE OR REPLACE FUNCTION audit_payment_transactions_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => OLD.id::text,
      p_target_table => 'payment_transactions',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'payment_transactions',
      p_action       => 'PAYMENT_RECEIVED',
      p_severity     => 'info',
      p_new_values   => jsonb_build_object(
        'booking_id', NEW.booking_id,
        'amount',     NEW.amount,
        'currency',   NEW.currency,
        'status',     NEW.status
      )
    );
    RETURN NEW;
  END IF;

  -- Status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_action   := 'PAYMENT_STATUS_CHANGED';
    v_severity := 'info';
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'payment_transactions',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('status', OLD.status),
      p_new_values   => jsonb_build_object('status', NEW.status, 'amount', NEW.amount)
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
    p_target_id    => NEW.id::text,
    p_target_table => 'payment_transactions',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_payment_transactions_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ============================================================
-- Re-engage triggers (idempotent)
-- ============================================================

-- tours → generic audit_table_change
DROP TRIGGER IF EXISTS trg_audit_tours ON tours;
CREATE TRIGGER trg_audit_tours
  AFTER INSERT OR UPDATE OR DELETE ON tours
  FOR EACH ROW EXECUTE FUNCTION audit_table_change();

-- agencies → smart audit_agencies_change
DROP TRIGGER IF EXISTS trg_audit_agencies ON agencies;
CREATE TRIGGER trg_audit_agencies
  AFTER INSERT OR UPDATE OR DELETE ON agencies
  FOR EACH ROW EXECUTE FUNCTION audit_agencies_change();

-- users → smart audit_users_change
DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_users_change();

-- admin_permissions → smart audit_admin_permissions_change
DROP TRIGGER IF EXISTS trg_audit_admin_permissions ON admin_permissions;
CREATE TRIGGER trg_audit_admin_permissions
  AFTER INSERT OR UPDATE OR DELETE ON admin_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_admin_permissions_change();

-- bookings → smart audit_bookings_change
DROP TRIGGER IF EXISTS trg_audit_bookings ON bookings;
CREATE TRIGGER trg_audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION audit_bookings_change();

-- agency_payouts → smart audit_payouts_change
DROP TRIGGER IF EXISTS trg_audit_agency_payouts ON agency_payouts;
CREATE TRIGGER trg_audit_agency_payouts
  AFTER INSERT OR UPDATE OR DELETE ON agency_payouts
  FOR EACH ROW EXECUTE FUNCTION audit_payouts_change();

-- payment_transactions → smart audit_payment_transactions_change
DROP TRIGGER IF EXISTS trg_audit_payment_transactions ON payment_transactions;
CREATE TRIGGER trg_audit_payment_transactions
  AFTER INSERT OR UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION audit_payment_transactions_change();