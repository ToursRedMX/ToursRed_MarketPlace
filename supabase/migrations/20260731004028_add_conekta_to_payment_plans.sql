/*
# Add Conekta to Payment Plan Installments + Centralized Allocation Function

## Purpose
This migration enables Conekta as a payment provider for payment plan installments
and creates a shared SQL function that centralizes the chronological allocation logic
so both the synchronous payment edge function and the async webhook use the same code path.

## Changes

### 1. Constraint update — booking_payment_plan_transactions
- Drops the existing `payment_provider_check` CHECK constraint
- Re-creates it with `'conekta'` added to the allowed values

### 2. New SQL function — allocate_payment_plan_installment
- SECURITY DEFINER function that atomically allocates a payment across installments
- Returns JSON with `{ transaction_id, points_earned, allocations, idempotent_skip }`
- Uses idempotency: if a transaction with the same `provider_transaction_id` already exists, returns it without duplicating
- Called by both `process-payment-plan-installment` (sync providers) and `conekta-webhook` (async confirmation)

### Security
- Function is SECURITY DEFINER, schema-qualified to prevent search_path attacks
- No new tables or RLS policies needed
*/

-- ─── 1. Update payment_provider constraint ───────────────────────────
ALTER TABLE booking_payment_plan_transactions DROP CONSTRAINT IF EXISTS booking_payment_plan_transactions_payment_provider_check;

ALTER TABLE booking_payment_plan_transactions ADD CONSTRAINT booking_payment_plan_transactions_payment_provider_check
  CHECK (payment_provider = ANY (ARRAY['stripe', 'paypal', 'mercadopago', 'toursred_cash', 'points', 'bank_transfer', 'cash', 'conekta']));

-- ─── 2. Create allocate_payment_plan_installment function ────────────
DROP FUNCTION IF EXISTS public.allocate_payment_plan_installment(
  p_plan_id uuid,
  p_amount numeric,
  p_provider text,
  p_service_charge numeric,
  p_gross_service_charge numeric,
  p_provider_transaction_id text,
  p_user_id uuid,
  p_membership_exemption_used boolean,
  p_is_wallet_payment boolean
);

CREATE OR REPLACE FUNCTION public.allocate_payment_plan_installment(
  p_plan_id uuid,
  p_amount numeric,
  p_provider text,
  p_service_charge numeric DEFAULT 0,
  p_gross_service_charge numeric DEFAULT 0,
  p_provider_transaction_id text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_membership_exemption_used boolean DEFAULT false,
  p_is_wallet_payment boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan RECORD;
  v_booking RECORD;
  v_allocations jsonb := '[]'::jsonb;
  v_remaining numeric := p_amount;
  v_amount_owed numeric;
  v_allocated numeric;
  v_tx_id uuid;
  v_points_earned integer := 0;
  v_active_membership_id uuid;
  v_wallet_id uuid;
  v_wallet_balance integer;
  v_wallet_total_earned integer;
  v_new_balance integer;
  v_total_paid numeric;
  v_total_due numeric;
  v_new_status text;
  v_new_total_paid numeric;
  v_plan_complete boolean;
  v_existing_tx RECORD;
  v_installment RECORD;
  v_plan_total_amount numeric;
  v_plan_current_paid numeric;
BEGIN
  -- Load plan
  SELECT * INTO v_plan FROM booking_payment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan de pago no encontrado';
  END IF;

  -- Load booking
  SELECT * INTO v_booking FROM bookings WHERE id = v_plan.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada';
  END IF;

  -- Idempotency: if provider_transaction_id already has a transaction, return it
  IF p_provider_transaction_id IS NOT NULL THEN
    SELECT id, points_earned INTO v_existing_tx
    FROM booking_payment_plan_transactions
    WHERE provider_transaction_id = p_provider_transaction_id
      AND payment_provider = p_provider
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'transaction_id', v_existing_tx.id,
        'points_earned', COALESCE(v_existing_tx.points_earned, 0),
        'allocations', '[]'::jsonb,
        'idempotent_skip', true
      );
    END IF;
  END IF;

  -- Calculate points earned (1 peso = 1 punto, or 2x for wallet payments with membership)
  v_points_earned := 0;
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_active_membership_id
    FROM memberships
    WHERE user_id = p_user_id
      AND status = 'active'
      AND current_period_end > now()
    LIMIT 1;

    IF v_active_membership_id IS NOT NULL THEN
      IF p_is_wallet_payment THEN
        v_points_earned := floor(p_amount)::integer * 2;
      ELSE
        v_points_earned := floor(p_amount + p_service_charge)::integer;
      END IF;
    END IF;
  END IF;

  -- Create the transaction record
  INSERT INTO booking_payment_plan_transactions (
    plan_id, booking_id, user_id, amount, service_charge, gross_service_charge,
    payment_provider, provider_transaction_id,
    membership_exemption_used, points_earned, status
  ) VALUES (
    p_plan_id, v_plan.booking_id, p_user_id, p_amount, p_service_charge, p_gross_service_charge,
    p_provider, p_provider_transaction_id,
    p_membership_exemption_used, v_points_earned, 'completed'
  )
  RETURNING id INTO v_tx_id;

  -- Allocate payment chronologically (oldest first) using FOR loop over query
  FOR v_installment IN
    SELECT * FROM booking_payment_plan_installments
    WHERE plan_id = p_plan_id
      AND status IN ('overdue', 'overdue_grace', 'pending', 'partially_paid')
    ORDER BY due_date ASC
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;

    v_amount_owed := COALESCE(v_installment.amount_due, 0) + COALESCE(v_installment.penalty_applied, 0) - COALESCE(v_installment.amount_paid, 0);
    IF v_amount_owed <= 0 THEN CONTINUE; END IF;

    v_allocated := LEAST(v_remaining, v_amount_owed);
    v_allocated := round(v_allocated::numeric, 2);

    -- Insert allocation record
    INSERT INTO booking_payment_plan_transaction_allocations (
      transaction_id, installment_id, amount_allocated
    ) VALUES (v_tx_id, v_installment.id, v_allocated);

    -- Build allocation for return value
    v_allocations := v_allocations || jsonb_build_object(
      'installment_id', v_installment.id,
      'amount_allocated', v_allocated
    );

    -- Update installment
    v_total_paid := round((COALESCE(v_installment.amount_paid, 0) + v_allocated)::numeric, 2);
    v_total_due := round((COALESCE(v_installment.amount_due, 0) + COALESCE(v_installment.penalty_applied, 0))::numeric, 2);

    IF v_total_paid >= v_total_due THEN
      v_new_status := 'paid';
      UPDATE booking_payment_plan_installments
      SET amount_paid = v_total_paid, status = v_new_status, paid_at = now(), updated_at = now()
      WHERE id = v_installment.id;
    ELSE
      v_new_status := 'partially_paid';
      UPDATE booking_payment_plan_installments
      SET amount_paid = v_total_paid, status = v_new_status, updated_at = now()
      WHERE id = v_installment.id;
    END IF;

    v_remaining := round((v_remaining - v_allocated)::numeric, 2);
  END LOOP;

  -- Update plan totals
  v_new_total_paid := round((COALESCE(v_plan.total_amount_paid, 0) + p_amount)::numeric, 2);
  v_plan_total_amount := COALESCE(v_plan.total_plan_amount, 0);
  v_plan_complete := v_new_total_paid >= v_plan_total_amount;

  UPDATE booking_payment_plans
  SET total_amount_paid = v_new_total_paid,
      pending_balance = round((v_plan_total_amount - v_new_total_paid)::numeric, 2),
      status = CASE WHEN v_plan_complete THEN 'completed' ELSE 'active' END,
      updated_at = now()
  WHERE id = p_plan_id;

  -- Update booking
  UPDATE bookings
  SET payment_plan_paid = v_new_total_paid,
      payment_plan_status = CASE WHEN v_plan_complete THEN 'completed' ELSE 'active' END,
      updated_at = now()
  WHERE id = v_plan.booking_id;

  -- Award points if applicable
  IF v_points_earned > 0 AND p_user_id IS NOT NULL THEN
    SELECT get_or_create_points_wallet(p_user_id) INTO v_wallet_id;

    IF v_wallet_id IS NOT NULL THEN
      SELECT balance, total_earned INTO v_wallet_balance, v_wallet_total_earned
      FROM toursred_points_wallets WHERE id = v_wallet_id;

      v_new_balance := v_wallet_balance + v_points_earned;

      INSERT INTO toursred_points_transactions (
        wallet_id, user_id, amount, balance_after, type, description, reference_id, reference_type, expires_at
      ) VALUES (
        v_wallet_id, p_user_id, v_points_earned, v_new_balance, 'earned',
        'Puntos por abono a plan de pago',
        v_tx_id::text, 'payment_plan',
        (now() + interval '365 days')
      );

      UPDATE toursred_points_wallets
      SET balance = v_new_balance, total_earned = v_wallet_total_earned + v_points_earned
      WHERE id = v_wallet_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'points_earned', v_points_earned,
    'allocations', v_allocations,
    'idempotent_skip', false
  );
END;
$$;

-- Grant execute to authenticated (service role bypasses anyway)
GRANT EXECUTE ON FUNCTION public.allocate_payment_plan_installment(
  uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean
) TO authenticated, anon;
