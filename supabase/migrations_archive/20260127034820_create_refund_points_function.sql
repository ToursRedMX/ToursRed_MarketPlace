
CREATE OR REPLACE FUNCTION refund_points_for_cancelled_booking(
  p_booking_id uuid,
  p_user_id uuid,
  p_points_to_refund integer
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id uuid;
  v_new_balance integer;
BEGIN
  -- Validate points amount
  IF p_points_to_refund <= 0 THEN
    RETURN false;
  END IF;

  -- Get wallet ID
  v_wallet_id := get_or_create_points_wallet(p_user_id);

  -- Check if refund already exists to prevent duplicates
  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'refunded'
  ) THEN
    RAISE NOTICE 'Points already refunded for booking %', p_booking_id;
    RETURN true;
  END IF;

  -- Update wallet balance
  UPDATE toursred_points_wallets
  SET balance = balance + p_points_to_refund,
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
    p_points_to_refund,
    v_new_balance,
    'refunded',
    'Reembolso por cancelación de reserva',
    p_booking_id,
    'booking'
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION refund_points_for_cancelled_booking TO service_role;
GRANT EXECUTE ON FUNCTION refund_points_for_cancelled_booking TO authenticated;
