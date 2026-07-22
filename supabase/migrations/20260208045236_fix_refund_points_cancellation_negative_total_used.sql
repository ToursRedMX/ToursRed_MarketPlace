
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
  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'refund'
    AND reference_type = 'booking'
  ) THEN
    RETURN 0;
  END IF;

  SELECT points_used INTO v_points_to_refund
  FROM bookings
  WHERE id = p_booking_id AND user_id = p_user_id;

  IF v_points_to_refund IS NULL OR v_points_to_refund = 0 THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro la billetera de puntos';
  END IF;

  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_refund,
      total_used = GREATEST(0, total_used - v_points_to_refund),
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

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
    'Reembolso de puntos por cancelacion de reserva',
    p_booking_id,
    'booking'
  );

  RETURN v_points_to_refund;
END;
$$;

GRANT EXECUTE ON FUNCTION refund_points_for_cancellation TO service_role;
