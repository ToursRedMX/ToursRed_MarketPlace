
-- Function 1: Create points wallet for a traveler
CREATE OR REPLACE FUNCTION create_points_wallet_for_traveler(p_user_id uuid)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  -- Check if wallet already exists
  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NOT NULL THEN
    RETURN v_wallet_id;
  END IF;

  -- Create new wallet
  INSERT INTO toursred_points_wallets (user_id, balance, total_earned, total_used, total_expired, is_active)
  VALUES (p_user_id, 0, 0, 0, 0, true)
  RETURNING id INTO v_wallet_id;

  RETURN v_wallet_id;
END;
$$;

-- Function 2: Get or create points wallet
CREATE OR REPLACE FUNCTION get_or_create_points_wallet(p_user_id uuid)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    v_wallet_id := create_points_wallet_for_traveler(p_user_id);
  END IF;

  RETURN v_wallet_id;
END;
$$;

-- Function 3: Calculate available points (excluding expired)
CREATE OR REPLACE FUNCTION calculate_available_points(p_user_id uuid)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_available_points integer;
  v_is_active boolean;
BEGIN
  -- Get wallet
  SELECT id, balance, is_active INTO v_wallet_id, v_available_points, v_is_active
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  -- No wallet means no points
  IF v_wallet_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Inactive wallet means points cannot be used
  IF NOT v_is_active THEN
    RETURN 0;
  END IF;

  -- Return current balance (already accounts for expired points via cron job)
  RETURN COALESCE(v_available_points, 0);
END;
$$;

-- Function 4: Check if user can use points
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

  -- Check if user has active membership
  SELECT EXISTS (
    SELECT 1 FROM toursred_plus_memberships
    WHERE user_id = p_user_id
      AND status = 'active'
      AND current_period_end > now()
  ) INTO v_membership_active;

  RETURN v_membership_active;
END;
$$;

-- Function 5: Award points for completed booking
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
    SELECT 1 FROM toursred_plus_memberships
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

-- Function 6: Redeem points for booking with FIFO and 50% limit
CREATE OR REPLACE FUNCTION redeem_points_for_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_points_to_use integer,
  p_total_price numeric
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_available_points integer;
  v_max_points_allowed integer;
  v_new_balance integer;
  v_can_use_points boolean;
BEGIN
  -- Validate user can use points
  v_can_use_points := check_can_use_points(p_user_id);
  
  IF NOT v_can_use_points THEN
    RAISE EXCEPTION 'No puedes usar puntos. Necesitas una membresía activa.';
  END IF;

  -- Get wallet
  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la billetera de puntos';
  END IF;

  -- Calculate available points
  v_available_points := calculate_available_points(p_user_id);

  -- Validate sufficient points
  IF p_points_to_use > v_available_points THEN
    RAISE EXCEPTION 'Puntos insuficientes. Disponibles: %, Solicitados: %', v_available_points, p_points_to_use;
  END IF;

  -- Validate 50% limit: points_to_use must be <= (total_price * 50)
  -- Since 100 points = 1 peso, max points = total_price * 50
  v_max_points_allowed := FLOOR(p_total_price * 50)::integer;

  IF p_points_to_use > v_max_points_allowed THEN
    RAISE EXCEPTION 'No puedes usar más del 50%% del total con puntos. Máximo: % puntos', v_max_points_allowed;
  END IF;

  -- Deduct points from wallet
  UPDATE toursred_points_wallets
  SET balance = balance - p_points_to_use,
      total_used = total_used + p_points_to_use,
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
    reference_type
  ) VALUES (
    v_wallet_id,
    p_user_id,
    -p_points_to_use,
    v_new_balance,
    'redeemed',
    'Puntos canjeados en reserva',
    p_booking_id,
    'booking'
  );

  -- Update booking record
  UPDATE bookings
  SET points_used = p_points_to_use
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- Function 7: Refund points when booking is cancelled
CREATE OR REPLACE FUNCTION refund_points_for_cancellation(
  p_booking_id uuid,
  p_user_id uuid
)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_points_to_refund integer;
  v_new_balance integer;
BEGIN
  -- Get points used from booking
  SELECT points_used INTO v_points_to_refund
  FROM bookings
  WHERE id = p_booking_id AND user_id = p_user_id;

  -- If no points were used, nothing to refund
  IF v_points_to_refund IS NULL OR v_points_to_refund = 0 THEN
    RETURN 0;
  END IF;

  -- Get wallet
  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la billetera de puntos';
  END IF;

  -- Add points back to wallet (without expiration date - they keep original expiration)
  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_refund,
      total_used = total_used - v_points_to_refund,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  -- Create refund transaction
  INSERT INTO toursred_points_transactions (
    wallet_id,
    user_id,
    amount,
    balance_after,
    type,
    description,
    reference_id,
    reference_type
  ) VALUES (
    v_wallet_id,
    p_user_id,
    v_points_to_refund,
    v_new_balance,
    'refund',
    'Reembolso de puntos por cancelación de reserva',
    p_booking_id,
    'booking'
  );

  RETURN v_points_to_refund;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_points_wallet_for_traveler TO service_role;
GRANT EXECUTE ON FUNCTION get_or_create_points_wallet TO service_role;
GRANT EXECUTE ON FUNCTION calculate_available_points TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_can_use_points TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION award_points_for_booking TO service_role;
GRANT EXECUTE ON FUNCTION redeem_points_for_booking TO service_role;
GRANT EXECUTE ON FUNCTION refund_points_for_cancellation TO service_role;
