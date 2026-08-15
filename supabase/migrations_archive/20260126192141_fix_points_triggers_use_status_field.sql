
-- Fix trigger function to award points - use 'status' instead of 'booking_status'
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
  IF NEW.status = 'completed' 
     AND (OLD.status IS NULL OR OLD.status != 'completed')
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

-- Fix trigger function to refund points - use 'status' instead of 'booking_status'
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
  IF NEW.status = 'cancelled'
     AND (OLD.status IS NULL OR OLD.status != 'cancelled')
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
