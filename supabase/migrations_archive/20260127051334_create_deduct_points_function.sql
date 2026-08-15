
CREATE OR REPLACE FUNCTION deduct_points_for_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_points_to_deduct integer
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_new_balance integer;
  v_current_balance integer;
BEGIN
  -- Validate points amount
  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  -- Get wallet ID
  v_wallet_id := get_or_create_points_wallet(p_user_id);

  -- Check if deduction already exists to prevent duplicates
  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'redeemed'
  ) THEN
    RAISE NOTICE 'Points already deducted for booking %', p_booking_id;
    RETURN true;
  END IF;

  -- Get current balance
  SELECT balance INTO v_current_balance
  FROM toursred_points_wallets
  WHERE id = v_wallet_id;

  -- Check if user has enough points
  IF v_current_balance < p_points_to_deduct THEN
    RAISE EXCEPTION 'Insufficient points. Current balance: %, Required: %', v_current_balance, p_points_to_deduct;
  END IF;

  -- Update wallet balance (subtract points)
  UPDATE toursred_points_wallets
  SET balance = balance - p_points_to_deduct,
      total_redeemed = total_redeemed + p_points_to_deduct,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  -- Create redeemed transaction (amount is negative to show deduction)
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
    -p_points_to_deduct,
    v_new_balance,
    'redeemed',
    'Puntos canjeados en reserva',
    p_booking_id,
    'booking'
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_points_for_booking TO service_role;
GRANT EXECUTE ON FUNCTION deduct_points_for_booking TO authenticated;
