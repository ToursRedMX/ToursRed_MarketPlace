
-- Fix deduct_points_for_booking to use correct column name
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
  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  v_wallet_id := get_or_create_points_wallet(p_user_id);

  IF EXISTS (
    SELECT 1 FROM public.toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'redeemed'
  ) THEN
    RAISE NOTICE 'Points already deducted for booking %', p_booking_id;
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance
  FROM public.toursred_points_wallets
  WHERE id = v_wallet_id;

  IF v_current_balance < p_points_to_deduct THEN
    RAISE EXCEPTION 'Insufficient points. Current balance: %, Required: %', v_current_balance, p_points_to_deduct;
  END IF;

  UPDATE public.toursred_points_wallets
  SET balance = balance - p_points_to_deduct,
      total_used = total_used + p_points_to_deduct,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.toursred_points_transactions (
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

-- Fix refund_points_for_cancelled_booking to decrement total_used
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
  v_current_total_used integer;
BEGIN
  IF p_points_to_refund <= 0 THEN
    RETURN false;
  END IF;

  v_wallet_id := get_or_create_points_wallet(p_user_id);

  IF EXISTS (
    SELECT 1 FROM public.toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'refunded'
  ) THEN
    RAISE NOTICE 'Points already refunded for booking %', p_booking_id;
    RETURN true;
  END IF;

  SELECT total_used INTO v_current_total_used
  FROM public.toursred_points_wallets
  WHERE id = v_wallet_id;

  UPDATE public.toursred_points_wallets
  SET balance = balance + p_points_to_refund,
      total_used = GREATEST(0, total_used - p_points_to_refund),
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.toursred_points_transactions (
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

GRANT EXECUTE ON FUNCTION deduct_points_for_booking TO service_role;
GRANT EXECUTE ON FUNCTION deduct_points_for_booking TO authenticated;
GRANT EXECUTE ON FUNCTION refund_points_for_cancelled_booking TO service_role;
GRANT EXECUTE ON FUNCTION refund_points_for_cancelled_booking TO authenticated;
