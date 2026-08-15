
DROP FUNCTION IF EXISTS award_points_for_booking(uuid, uuid, numeric, integer, numeric);

CREATE OR REPLACE FUNCTION award_points_for_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_user_payment numeric,
  p_points_used integer DEFAULT 0,
  p_toursred_cash_used numeric DEFAULT 0
)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_points_to_award integer;
  v_amount_paid_with_money numeric;
  v_points_value_in_pesos numeric;
  v_new_balance integer;
  v_expires_at timestamptz;
  v_has_active_membership boolean;
BEGIN
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

  -- Calculate peso value of points used (100 points = 1 peso)
  v_points_value_in_pesos := p_points_used::numeric / 100;

  -- Calculate amount paid with real money (Stripe)
  -- user_payment - toursred_cash_used - points_value_in_pesos
  v_amount_paid_with_money := p_user_payment - p_toursred_cash_used - v_points_value_in_pesos;
  
  -- Ensure non-negative
  IF v_amount_paid_with_money < 0 THEN
    v_amount_paid_with_money := 0;
  END IF;

  -- Award 1 point per peso paid with real money
  v_points_to_award := FLOOR(v_amount_paid_with_money)::integer;

  -- If no points to award, return 0
  IF v_points_to_award <= 0 THEN
    RETURN 0;
  END IF;

  -- Set expiration date to 12 months from now
  v_expires_at := now() + interval '12 months';

  -- Update wallet balance and totals
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

  -- Update booking record
  UPDATE bookings
  SET points_earned = v_points_to_award
  WHERE id = p_booking_id;

  RETURN v_points_to_award;
END;
$$;

GRANT EXECUTE ON FUNCTION award_points_for_booking TO service_role;
