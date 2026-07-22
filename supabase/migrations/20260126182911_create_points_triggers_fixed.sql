
-- Trigger function to auto-award points when booking is completed
CREATE OR REPLACE FUNCTION auto_award_points_on_booking_completion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_awarded integer;
BEGIN
  -- Check if status changed to 'completed' and points haven't been awarded yet
  IF NEW.booking_status = 'completed' 
     AND (OLD.booking_status IS NULL OR OLD.booking_status != 'completed')
     AND (NEW.points_earned IS NULL OR NEW.points_earned = 0) THEN
    
    -- Award points
    v_points_awarded := award_points_for_booking(
      NEW.id,
      NEW.user_id,
      NEW.total_price,
      COALESCE(NEW.points_used, 0),
      COALESCE(NEW.toursred_cash_used, 0)
    );
    
    -- Update the NEW record with points earned (will be saved automatically)
    NEW.points_earned := v_points_awarded;
    
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on bookings table
DROP TRIGGER IF EXISTS trigger_auto_award_points_on_completion ON bookings;
CREATE TRIGGER trigger_auto_award_points_on_completion
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_award_points_on_booking_completion();

-- Trigger function to sync membership status with points wallet
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
  -- Determine if wallet should be active
  -- Active if membership is active and not expired
  v_should_be_active := (NEW.status = 'active' AND NEW.current_period_end > now());

  -- Get or create wallet for this user
  v_wallet_id := get_or_create_points_wallet(NEW.user_id);

  -- Update wallet active status
  UPDATE toursred_points_wallets
  SET is_active = v_should_be_active,
      updated_at = now()
  WHERE id = v_wallet_id;

  RETURN NEW;
END;
$$;

-- Create trigger on memberships table
DROP TRIGGER IF EXISTS trigger_sync_membership_with_wallet ON memberships;
CREATE TRIGGER trigger_sync_membership_with_wallet
  AFTER INSERT OR UPDATE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION sync_membership_with_points_wallet();

-- Trigger function to auto-create wallet when user gets first membership
CREATE OR REPLACE FUNCTION auto_create_wallet_on_membership()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  -- Create wallet if it doesn't exist
  v_wallet_id := get_or_create_points_wallet(NEW.user_id);
  
  RETURN NEW;
END;
$$;

-- Create trigger on memberships for wallet creation
DROP TRIGGER IF EXISTS trigger_auto_create_wallet ON memberships;
CREATE TRIGGER trigger_auto_create_wallet
  BEFORE INSERT ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_wallet_on_membership();

-- Trigger function to refund points when booking is cancelled
CREATE OR REPLACE FUNCTION auto_refund_points_on_cancellation()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_refunded integer;
BEGIN
  -- Check if status changed to 'cancelled' and points were used
  IF NEW.booking_status = 'cancelled'
     AND (OLD.booking_status IS NULL OR OLD.booking_status != 'cancelled')
     AND NEW.points_used > 0 THEN
    
    -- Refund points
    v_points_refunded := refund_points_for_cancellation(
      NEW.id,
      NEW.user_id
    );
    
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for automatic refund on cancellation
DROP TRIGGER IF EXISTS trigger_auto_refund_points_on_cancellation ON bookings;
CREATE TRIGGER trigger_auto_refund_points_on_cancellation
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_refund_points_on_cancellation();
