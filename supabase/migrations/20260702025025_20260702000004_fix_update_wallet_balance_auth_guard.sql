-- Fix: update_wallet_balance now requires the caller to either be the wallet owner
-- or have an agency/admin role (needed for agency-initiated cancellation refunds to travelers)

CREATE OR REPLACE FUNCTION public.update_wallet_balance(
  p_user_id uuid,
  p_amount numeric,
  p_type toursred_cash_transaction_type,
  p_description text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_type text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_wallet_id uuid;
  v_current_balance decimal;
  v_new_balance decimal;
  v_transaction_id uuid;
BEGIN
  v_caller_id := auth.uid();

  SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

  -- Allow: self-service OR agency/admin acting on behalf of a user
  IF v_caller_id <> p_user_id AND v_caller_role NOT IN ('agency', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify wallet of another user';
  END IF;

  SELECT id, balance INTO v_wallet_id, v_current_balance
  FROM public.toursred_cash_wallets
  WHERE user_id = p_user_id AND is_active = true
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
  END IF;

  v_new_balance := v_current_balance + p_amount;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Attempting: %', v_current_balance, p_amount;
  END IF;

  UPDATE public.toursred_cash_wallets
  SET balance = v_new_balance
  WHERE id = v_wallet_id;

  INSERT INTO public.toursred_cash_transactions (
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
    p_amount,
    v_new_balance,
    p_type,
    p_description,
    p_reference_id,
    p_reference_type
  ) RETURNING id INTO v_transaction_id;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'amount', p_amount,
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text) TO authenticated;
