
CREATE OR REPLACE FUNCTION deduct_points_for_partial_cancellation(
  p_booking_id uuid,
  p_partial_cancellation_id uuid,
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
  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  v_wallet_id := get_or_create_points_wallet(p_user_id);

  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_partial_cancellation_id
    AND type = 'partial_cancellation'
  ) THEN
    RAISE NOTICE 'Points already deducted for partial cancellation %', p_partial_cancellation_id;
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance
  FROM toursred_points_wallets
  WHERE id = v_wallet_id;

  p_points_to_deduct := LEAST(p_points_to_deduct, v_current_balance);

  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  UPDATE toursred_points_wallets
  SET balance = balance - p_points_to_deduct,
      total_used = total_used + p_points_to_deduct,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, p_user_id, -p_points_to_deduct, v_new_balance,
    'partial_cancellation',
    'Ajuste de puntos por cancelación parcial de viajero(s)',
    p_partial_cancellation_id,
    'booking_partial_cancellation'
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_points_for_partial_cancellation TO service_role;
GRANT EXECUTE ON FUNCTION deduct_points_for_partial_cancellation TO authenticated;
