
-- Drop old broken triggers first
DROP TRIGGER IF EXISTS trigger_auto_award_points_on_completion ON bookings;
DROP TRIGGER IF EXISTS trigger_sync_membership_with_wallet ON memberships;
DROP TRIGGER IF EXISTS trigger_auto_create_wallet ON memberships;
DROP TRIGGER IF EXISTS trigger_auto_refund_points_on_cancellation ON bookings;

-- Drop old functions
DROP FUNCTION IF EXISTS auto_award_points_on_booking_completion();
DROP FUNCTION IF EXISTS sync_membership_with_points_wallet();
DROP FUNCTION IF EXISTS auto_create_wallet_on_membership();
DROP FUNCTION IF EXISTS auto_refund_points_on_cancellation();
DROP FUNCTION IF EXISTS check_can_use_points(uuid);

-- Drop and recreate with correct table reference
DROP FUNCTION IF EXISTS award_points_for_booking(uuid, uuid, numeric, integer, numeric);

-- CREATE NEW FUNCTION: Award points for completed booking
-- Awards points based on final amount user had to pay (after all discounts)
CREATE OR REPLACE FUNCTION award_points_for_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_amount_to_pay numeric
)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_points_to_award integer;
  v_new_balance integer;
  v_expires_at timestamptz;
  v_has_active_membership boolean;
BEGIN
  -- Validate inputs
  IF p_amount_to_pay < 0 THEN
    RETURN 0;
  END IF;

  -- Check if user has active membership
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = p_user_id
      AND status = 'active'
      AND current_period_end > now()
  ) INTO v_has_active_membership;

  -- Only award points if membership is active
  IF NOT v_has_active_membership THEN
    RETURN 0;
  END IF;

  -- Get or create wallet
  v_wallet_id := get_or_create_points_wallet(p_user_id);

  -- Calculate points: 1 peso = 1 point = 100 centavos representation
  -- So amount * 100 = total points
  v_points_to_award := FLOOR(p_amount_to_pay * 100)::integer;

  IF v_points_to_award <= 0 THEN
    RETURN 0;
  END IF;

  -- Set expiration to 12 months from now
  v_expires_at := now() + interval '12 months';

  -- Update wallet
  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_award,
      total_earned = total_earned + v_points_to_award,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  -- Create transaction record
  INSERT INTO toursred_points_transactions (
    wallet_id,
    user_id,
    amount,
    balance_after,
    type,
    description,
    reference_id,
    reference_type,
    expires_at
  ) VALUES (
    v_wallet_id,
    p_user_id,
    v_points_to_award,
    v_new_balance,
    'earned',
    'Puntos ganados por reserva completada',
    p_booking_id,
    'booking',
    v_expires_at
  );

  RETURN v_points_to_award;
END;
$$;

GRANT EXECUTE ON FUNCTION award_points_for_booking TO service_role;

-- FUNCTION: Check if user can use points (updated with correct table name)
CREATE OR REPLACE FUNCTION check_can_use_points(p_user_id uuid)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_active boolean;
  v_membership_active boolean;
BEGIN
  -- Check if wallet is active
  SELECT is_active INTO v_is_active
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_is_active IS NULL OR NOT v_is_active THEN
    RETURN false;
  END IF;

  -- Check if user has active membership (CORRECT TABLE NAME)
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = p_user_id
      AND status = 'active'
      AND current_period_end > now()
  ) INTO v_membership_active;

  RETURN v_membership_active;
END;
$$;

GRANT EXECUTE ON FUNCTION check_can_use_points TO service_role;

-- NEW TRIGGER FUNCTION: Auto award points on confirmation with succeeded payment
CREATE OR REPLACE FUNCTION auto_award_points_on_booking_completion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_awarded integer;
BEGIN
  -- Award points when status changed to 'confirmed' (CORRECT COLUMN) 
  -- AND payment_status is 'succeeded' AND points haven't been awarded yet
  IF NEW.status = 'confirmed' 
     AND NEW.payment_status = 'succeeded'
     AND (NEW.points_earned IS NULL OR NEW.points_earned = 0) THEN
    
    -- Award points based on amount user actually paid
    -- (after points/cash discounts were already applied)
    v_points_awarded := award_points_for_booking(
      NEW.id,
      NEW.user_id,
      NEW.user_payment::numeric
    );
    
    NEW.points_earned := v_points_awarded;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger with CORRECT COLUMN NAMES
DROP TRIGGER IF EXISTS trigger_auto_award_points_on_completion ON bookings;
CREATE TRIGGER trigger_auto_award_points_on_completion
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_award_points_on_booking_completion();

-- TRIGGER FUNCTION: Sync membership status with points wallet (CORRECT TABLE NAME)
CREATE OR REPLACE FUNCTION sync_membership_with_points_wallet()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_should_be_active boolean;
BEGIN
  v_should_be_active := (NEW.status = 'active' AND NEW.current_period_end > now());
  v_wallet_id := get_or_create_points_wallet(NEW.user_id);

  UPDATE toursred_points_wallets
  SET is_active = v_should_be_active,
      updated_at = now()
  WHERE id = v_wallet_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_membership_with_wallet ON memberships;
CREATE TRIGGER trigger_sync_membership_with_wallet
  AFTER INSERT OR UPDATE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION sync_membership_with_points_wallet();

-- TRIGGER FUNCTION: Auto-create wallet on membership (CORRECT TABLE NAME)
CREATE OR REPLACE FUNCTION auto_create_wallet_on_membership()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  v_wallet_id := get_or_create_points_wallet(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_create_wallet ON memberships;
CREATE TRIGGER trigger_auto_create_wallet
  BEFORE INSERT ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_wallet_on_membership();

-- TRIGGER FUNCTION: Refund points on cancellation (CORRECT COLUMN NAME)
CREATE OR REPLACE FUNCTION auto_refund_points_on_cancellation()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_refunded integer;
BEGIN
  -- Check if status changed to 'cancelled' (CORRECT COLUMN) and points were used
  IF NEW.status = 'cancelled'
     AND (OLD.status IS NULL OR OLD.status != 'cancelled')
     AND NEW.points_used > 0 THEN
    
    v_points_refunded := refund_points_for_cancellation(
      NEW.id,
      NEW.user_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_refund_points_on_cancellation ON bookings;
CREATE TRIGGER trigger_auto_refund_points_on_cancellation
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_refund_points_on_cancellation();
