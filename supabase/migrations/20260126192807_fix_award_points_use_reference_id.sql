-- Fix award_points_for_booking function to use correct column names
CREATE OR REPLACE FUNCTION award_points_for_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_total_price numeric,
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
  v_amount_eligible numeric;
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

  -- Calculate eligible amount (exclude points and cash used)
  -- Points used are already in points, need to convert to pesos: points_used / 100
  v_amount_eligible := p_total_price - (p_points_used::numeric / 100) - p_toursred_cash_used;
  
  -- Ensure non-negative
  IF v_amount_eligible < 0 THEN
    v_amount_eligible := 0;
  END IF;

  -- Award 1 point per peso (multiply by 100 since total_price is in pesos with decimals)
  v_points_to_award := FLOOR(v_amount_eligible * 100)::integer;

  -- If no points to award, return 0
  IF v_points_to_award <= 0 THEN
    RETURN 0;
  END IF;

  -- Points expire after 12 months
  v_expires_at := now() + interval '12 months';

  -- Get current balance for balance_after calculation
  SELECT balance INTO v_new_balance
  FROM toursred_points_wallets
  WHERE id = v_wallet_id;

  -- Record the points transaction with reference_id and reference_type
  INSERT INTO toursred_points_transactions (
    wallet_id,
    user_id,
    reference_id,
    reference_type,
    type,
    amount,
    balance_after,
    description,
    expires_at
  ) VALUES (
    v_wallet_id,
    p_user_id,
    p_booking_id,
    'booking',
    'earned',
    v_points_to_award,
    v_new_balance + v_points_to_award,
    'Puntos ganados por reserva completada',
    v_expires_at
  );

  -- Update wallet balance and totals
  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_award,
      total_earned = total_earned + v_points_to_award,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  RETURN v_points_to_award;
END;
$$;
