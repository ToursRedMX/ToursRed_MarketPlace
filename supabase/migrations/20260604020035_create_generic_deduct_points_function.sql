
CREATE OR REPLACE FUNCTION public.deduct_points(
  p_user_id uuid,
  p_amount integer,
  p_description text DEFAULT 'Puntos canjeados',
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT 'general'
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
  IF p_amount <= 0 THEN
    RETURN false;
  END IF;

  v_wallet_id := get_or_create_points_wallet(p_user_id);

  -- Prevent duplicate deductions for the same reference
  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.toursred_points_transactions
    WHERE reference_id = p_reference_id
      AND type = 'redeemed'
      AND (reference_type = p_reference_type OR reference_type IS NULL)
  ) THEN
    RAISE NOTICE 'Points already deducted for reference %', p_reference_id;
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance
  FROM public.toursred_points_wallets
  WHERE id = v_wallet_id;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Puntos insuficientes. Saldo: %, Requerido: %', v_current_balance, p_amount;
  END IF;

  UPDATE public.toursred_points_wallets
  SET balance = balance - p_amount,
      total_used = total_used + p_amount,
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
    -p_amount,
    v_new_balance,
    'redeemed',
    p_description,
    p_reference_id,
    p_reference_type
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_points TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_points TO authenticated;
