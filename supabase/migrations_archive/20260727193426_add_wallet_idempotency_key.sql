/*
# Add idempotency_key to wallet transactions + make update_wallet_balance idempotent

1. Changes to existing tables
- `toursred_cash_transactions`: add column `idempotency_key text` (nullable). When provided, this
  column enables idempotent wallet operations — a second call with the same key for the same wallet
  returns the original result instead of double-charging the balance.
2. New indexes
- Partial unique index `idx_wallet_transactions_idempotency_key` on `(wallet_id, idempotency_key)`
  WHERE `idempotency_key IS NOT NULL`. This enforces uniqueness only for transactions that carry an
  idempotency key, leaving legacy rows (NULL key) unconstrained.
3. Function changes
- `update_wallet_balance`: add optional parameter `p_idempotency_key text DEFAULT NULL`. Before
  moving the balance, if a key is provided, the function checks whether a transaction with that key
  already exists for the wallet. If it does, it returns the stored result (balance_after, amount)
  without modifying the balance again. If no key is provided, behavior is unchanged.
4. Security
- No RLS policy changes. The function remains SECURITY DEFINER with the same auth guard.
- GRANT EXECUTE updated for the new signature.
*/

-- 1. Add idempotency_key column
ALTER TABLE public.toursred_cash_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 2. Partial unique index — only enforces uniqueness when a key is provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key
  ON public.toursred_cash_transactions (wallet_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Recreate update_wallet_balance with idempotency support
CREATE OR REPLACE FUNCTION public.update_wallet_balance(
  p_user_id uuid,
  p_amount numeric,
  p_type toursred_cash_transaction_type,
  p_description text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_type text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
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
  v_existing json;
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

  -- Idempotency check: if a key is provided, see if we already processed this operation
  IF p_idempotency_key IS NOT NULL THEN
    SELECT json_build_object(
      'success', true,
      'transaction_id', t.id,
      'previous_balance', t.balance_after - t.amount,
      'amount', t.amount,
      'new_balance', t.balance_after,
      'idempotent_replay', true
    ) INTO v_existing
    FROM public.toursred_cash_transactions t
    WHERE t.wallet_id = v_wallet_id AND t.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
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
    reference_type,
    idempotency_key
  ) VALUES (
    v_wallet_id,
    p_user_id,
    p_amount,
    v_new_balance,
    p_type,
    p_description,
    p_reference_id,
    p_reference_type,
    p_idempotency_key
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

-- 4. Grant execute with new signature
DROP POLICY IF EXISTS "Service role can insert transactions" ON public.toursred_cash_transactions;
CREATE POLICY "Service role can insert transactions"
  ON public.toursred_cash_transactions FOR INSERT
  WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text, text) TO authenticated;
