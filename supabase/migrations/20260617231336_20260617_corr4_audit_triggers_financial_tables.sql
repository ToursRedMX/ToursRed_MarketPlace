-- Correction 4: Add audit triggers to bookings, agency_payouts, payment_transactions

-- -------------------------------------------------------
-- Smart trigger for bookings table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_bookings_change()
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

-- -------------------------------------------------------
-- Smart trigger for agency_payouts table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_payouts_change()
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

-- -------------------------------------------------------
-- Smart trigger for payment_transactions table
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_payment_transactions_change()
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

-- -------------------------------------------------------
-- Register triggers
-- -------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_bookings ON bookings;
CREATE TRIGGER trg_audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION audit_bookings_change();

DROP TRIGGER IF EXISTS trg_audit_agency_payouts ON agency_payouts;
CREATE TRIGGER trg_audit_agency_payouts
  AFTER INSERT OR UPDATE OR DELETE ON agency_payouts
  FOR EACH ROW EXECUTE FUNCTION audit_payouts_change();

DROP TRIGGER IF EXISTS trg_audit_payment_transactions ON payment_transactions;
CREATE TRIGGER trg_audit_payment_transactions
  AFTER INSERT OR UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION audit_payment_transactions_change();
