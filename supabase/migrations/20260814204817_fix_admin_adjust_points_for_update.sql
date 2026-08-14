-- Part 15: Fix admin_adjust_points to use SELECT ... FOR UPDATE
-- Prevents lost-update race between concurrent admin adjustments
-- IMPORTANT: negative balances ARE allowed (legitimate from cancellation reversals)
-- The negative-balance guard is REMOVED per requirements
CREATE OR REPLACE FUNCTION public.admin_adjust_points(
  target_user_id uuid,
  points_amount integer,
  adjustment_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_wallet_id UUID;
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_admin_id UUID;
  v_admin_role TEXT;
  v_transaction_id UUID;
BEGIN
  v_admin_id := auth.uid();

  SELECT role INTO v_admin_role
  FROM users
  WHERE id = v_admin_id;

  IF v_admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only administrators can manually adjust points';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = target_user_id AND role = 'traveler'
  ) THEN
    RAISE EXCEPTION 'Target user not found or is not a traveler';
  END IF;

  -- Get or create wallet with FOR UPDATE to prevent concurrent lost updates
  SELECT id, balance INTO v_wallet_id, v_current_balance
  FROM toursred_points_wallets
  WHERE user_id = target_user_id
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    -- Create wallet if it doesn't exist
    INSERT INTO toursred_points_wallets (user_id, balance, is_active)
    VALUES (target_user_id, 0, true)
    RETURNING id, balance INTO v_wallet_id, v_current_balance;

    -- Lock the newly created row
    SELECT id, balance INTO v_wallet_id, v_current_balance
    FROM toursred_points_wallets
    WHERE id = v_wallet_id
    FOR UPDATE;
  END IF;

  -- Calculate new balance (negative is allowed - do NOT reject)
  v_new_balance := v_current_balance + points_amount;

  -- Create transaction record
  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type, description, reference_type, reference_id
  ) VALUES (
    v_wallet_id, target_user_id, points_amount, v_new_balance,
    'adjustment', adjustment_reason, 'adjustment', v_admin_id
  ) RETURNING id INTO v_transaction_id;

  -- Update wallet balance
  IF points_amount > 0 THEN
    UPDATE toursred_points_wallets
    SET balance = balance + points_amount,
        total_earned = total_earned + points_amount,
        updated_at = now()
    WHERE id = v_wallet_id;
  ELSE
    UPDATE toursred_points_wallets
    SET balance = balance + points_amount,
        total_used = total_used + abs(points_amount),
        updated_at = now()
    WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'adjustment', points_amount,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) TO authenticated;