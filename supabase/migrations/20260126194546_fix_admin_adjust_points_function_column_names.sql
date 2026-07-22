
-- Drop and recreate the function with correct column names
DROP FUNCTION IF EXISTS admin_adjust_points(UUID, INTEGER, TEXT);

-- Function to manually adjust points (admin only)
CREATE OR REPLACE FUNCTION admin_adjust_points(
  target_user_id UUID,
  points_amount INTEGER,
  adjustment_reason TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_admin_id UUID;
  v_admin_role TEXT;
  v_transaction_id UUID;
BEGIN
  -- Get current user and verify admin role
  v_admin_id := auth.uid();
  
  SELECT role INTO v_admin_role
  FROM users
  WHERE id = v_admin_id;
  
  IF v_admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only administrators can manually adjust points';
  END IF;
  
  -- Verify target user exists and is a traveler
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = target_user_id AND role = 'traveler'
  ) THEN
    RAISE EXCEPTION 'Target user not found or is not a traveler';
  END IF;
  
  -- Get or create wallet
  SELECT id, balance INTO v_wallet_id, v_current_balance
  FROM toursred_points_wallets
  WHERE user_id = target_user_id;
  
  IF v_wallet_id IS NULL THEN
    -- Create wallet if it doesn't exist
    INSERT INTO toursred_points_wallets (user_id, balance, is_active)
    VALUES (target_user_id, 0, true)
    RETURNING id, balance INTO v_wallet_id, v_current_balance;
  END IF;
  
  -- Calculate new balance
  v_new_balance := v_current_balance + points_amount;
  
  -- Prevent negative balance
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient points. Current balance: %, Adjustment: %', 
      v_current_balance, points_amount;
  END IF;
  
  -- Create transaction record with correct column names
  INSERT INTO toursred_points_transactions (
    wallet_id,
    user_id,
    amount,
    balance_after,
    type,
    description,
    reference_type,
    reference_id
  ) VALUES (
    v_wallet_id,
    target_user_id,
    points_amount,
    v_new_balance,
    'adjustment',
    adjustment_reason,
    'adjustment',
    v_admin_id
  ) RETURNING id INTO v_transaction_id;
  
  -- Update wallet balance and totals
  IF points_amount > 0 THEN
    -- Adding points
    UPDATE toursred_points_wallets
    SET 
      balance = balance + points_amount,
      total_earned = total_earned + points_amount,
      updated_at = now()
    WHERE id = v_wallet_id;
  ELSE
    -- Subtracting points
    UPDATE toursred_points_wallets
    SET 
      balance = balance + points_amount,
      total_used = total_used + abs(points_amount),
      updated_at = now()
    WHERE id = v_wallet_id;
  END IF;
  
  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'adjustment', points_amount,
    'new_balance', v_new_balance
  );
END;
$$;

-- Grant execute permission to authenticated users (function will check role internally)
GRANT EXECUTE ON FUNCTION admin_adjust_points TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION admin_adjust_points IS 'Allows administrators to manually adjust points in a user wallet. Positive amounts add points, negative amounts subtract points.';
