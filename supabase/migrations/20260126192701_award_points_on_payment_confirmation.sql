
-- Update trigger function to award points when payment is confirmed
CREATE OR REPLACE FUNCTION auto_award_points_on_booking_completion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_awarded integer;
BEGIN
  -- Check if status changed to 'confirmed' (payment successful) and points haven't been awarded yet
  IF NEW.status = 'confirmed' 
     AND (OLD.status IS NULL OR OLD.status != 'confirmed')
     AND (NEW.points_earned IS NULL OR NEW.points_earned = 0)
     AND NEW.payment_status = 'succeeded' THEN
    
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
