/*
# Create claw_back_points_for_refund function

## Overview
This function reverts loyalty points that were awarded for a specific charge when that
charge is refunded. It is designed to be called by refund webhooks (Stripe, PayPal,
MercadoPago) and by the admin cancel-booking flow. It supports both the NEW granular
format (reference_id = specific transaction record id, 1:1 match) and the LEGACY format
(reference_id = plan_id, where multiple installments share the same reference_id).

## 1. New Function: claw_back_points_for_refund
- SECURITY DEFINER, schema-qualified as public.claw_back_points_for_refund
- Parameters:
  - p_user_id (uuid): the user whose points should be clawed back
  - p_reference_id (uuid): the charge_reference_id from payment_transactions
  - p_reference_type (text): 'payment_plan' | 'supplement' | 'supplement_payment' |
    'optional_service_payment' | 'insurance_payment' | 'booking'
  - p_refund_id (uuid): the payment_refunds.id that triggered this clawback (idempotency key)
  - p_amount (integer, optional): if provided, claw back exactly this many points;
    if NULL, claw back ALL points associated with the reference

## 2. Behavior
1. Idempotency: if a 'clawback' transaction already exists with the same
   p_refund_id in reference_id or description, return 0 (already processed).
2. Find the original 'earned' points transaction(s) matching p_reference_id +
   p_reference_type. Sum their amounts.
3. If p_amount is NULL, claw back the full sum. If p_amount is provided, claw back
   min(p_amount, sum) — never more than what was originally awarded.
4. LEGACY HANDLING: if p_reference_type = 'payment_plan' and no match found by
   reference_id = p_reference_id, try matching booking_payment_plan_transactions.plan_id
   = p_reference_id. If multiple installments exist, claw back proportionally based
   on the refund amount vs total plan amount. The caller passes the refund amount via
   p_amount in this case.
5. Get or create the user's points wallet. Decrement the balance (can go negative).
   Decrement total_earned by the clawback amount (but never below 0).
6. Insert a toursred_points_transactions row with type='clawback', negative amount,
   balance_after = new balance, and reference_id = p_refund_id (the payment_refunds id).

## 3. Grants
- EXECUTE granted to authenticated (edge functions call via service role which bypasses)
- EXECUTE granted to service_role (explicit, for clarity)

## 4. Security
- SECURITY DEFINER: runs with the function owner's privileges so it can update wallets
  and insert transactions regardless of the caller's RLS context.
- No RLS changes needed — the function manages its own access control.
*/

CREATE OR REPLACE FUNCTION public.claw_back_points_for_refund(
  p_user_id uuid,
  p_reference_id uuid,
  p_reference_type text,
  p_refund_id uuid,
  p_amount integer DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
  v_current_balance integer;
  v_total_earned integer;
  v_clawback_amount integer;
  v_new_balance integer;
  v_new_total_earned integer;
  v_existing_clawback integer;
  v_earned_total integer;
  v_legacy_plan_total numeric;
  v_legacy_refund_amount numeric;
  v_legacy_ratio numeric;
BEGIN
  -- Validate reference_type
  IF p_reference_type NOT IN ('payment_plan','supplement','supplement_payment','optional_service_payment','insurance_payment','booking') THEN
    RAISE EXCEPTION 'Invalid reference_type: %', p_reference_type;
  END IF;

  -- Idempotency: check if clawback already processed for this refund
  SELECT COUNT(*) INTO v_existing_clawback
  FROM toursred_points_transactions
  WHERE type = 'clawback'
    AND reference_id = p_refund_id
    AND user_id = p_user_id;

  IF v_existing_clawback > 0 THEN
    RETURN 0;
  END IF;

  -- Find original earned points for this reference
  SELECT COALESCE(SUM(amount), 0) INTO v_earned_total
  FROM toursred_points_transactions
  WHERE type = 'earned'
    AND user_id = p_user_id
    AND reference_id = p_reference_id
    AND reference_type = p_reference_type;

  -- LEGACY HANDLING: if no match and it's a payment_plan, try matching by plan_id
  IF v_earned_total = 0 AND p_reference_type = 'payment_plan' THEN
    -- Check if p_reference_id is actually a plan_id (not a transaction id)
    SELECT COALESCE(SUM(amount), 0) INTO v_earned_total
    FROM toursred_points_transactions tpt
    WHERE tpt.type = 'earned'
      AND tpt.user_id = p_user_id
      AND tpt.reference_type = 'payment_plan'
      AND tpt.reference_id IN (
        SELECT bppt.id FROM booking_payment_plan_transactions bppt WHERE bppt.plan_id = p_reference_id
      );

    IF v_earned_total > 0 AND p_amount IS NOT NULL THEN
      -- Proportional clawback: refund_amount / total_plan_amount * total_points
      SELECT COALESCE(SUM(amount), 0) INTO v_legacy_plan_total
      FROM booking_payment_plan_transactions
      WHERE plan_id = p_reference_id AND status = 'completed';

      IF v_legacy_plan_total > 0 THEN
        -- p_amount here represents the refund amount in pesos; points are 1:1
        v_legacy_ratio := p_amount::numeric / v_legacy_plan_total;
        v_clawback_amount := LEAST(ROUND(v_earned_total * v_legacy_ratio)::integer, v_earned_total);
      ELSE
        v_clawback_amount := v_earned_total;
      END IF;
    ELSE
      v_clawback_amount := v_earned_total;
    END IF;
  ELSE
    -- Standard 1:1 case
    IF p_amount IS NOT NULL THEN
      v_clawback_amount := LEAST(p_amount, v_earned_total);
    ELSE
      v_clawback_amount := v_earned_total;
    END IF;
  END IF;

  -- Nothing to claw back
  IF v_clawback_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Get or create wallet
  SELECT id, balance, total_earned INTO v_wallet_id, v_current_balance, v_total_earned
  FROM toursred_points_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO toursred_points_wallets (user_id, balance, total_earned, total_used, total_expired)
    VALUES (p_user_id, 0, 0, 0, 0)
    RETURNING id, balance, total_earned INTO v_wallet_id, v_current_balance, v_total_earned;
  END IF;

  -- Calculate new balances
  v_new_balance := v_current_balance - v_clawback_amount;
  v_new_total_earned := GREATEST(v_total_earned - v_clawback_amount, 0);

  -- Update wallet
  UPDATE toursred_points_wallets
  SET balance = v_new_balance,
      total_earned = v_new_total_earned,
      updated_at = now()
  WHERE id = v_wallet_id;

  -- Insert clawback transaction
  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, p_user_id, -v_clawback_amount, v_new_balance, 'clawback',
    'Reverso de puntos por reembolso', p_refund_id, p_reference_type
  );

  RETURN v_clawback_amount;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.claw_back_points_for_refund(uuid, uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claw_back_points_for_refund(uuid, uuid, text, uuid, integer) TO service_role;
