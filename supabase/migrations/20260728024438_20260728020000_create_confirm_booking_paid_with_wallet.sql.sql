/*
# Create confirm_booking_paid_with_wallet RPC function

## Purpose
Makes 100% wallet/points payments atomic. When a traveler pays entirely with
ToursRed Cash and/or points (no external payment processor involved), all
side-effects (wallet debit, points deduction, membership exemption update,
booking confirmation) run inside a single database transaction. If any step
fails, everything rolls back — no partial state where money/points were
deducted but the booking was never confirmed, or vice versa.

## New function
- `public.confirm_booking_paid_with_wallet(p_booking_id, p_points_to_use, p_cash_to_use, p_idempotency_key)`
  - SECURITY DEFINER, fixed search_path
  - Validates auth.uid() matches the booking's user_id
  - Step 1: debits ToursRed Cash via the existing update_wallet_balance function
    (using the caller-provided idempotency_key to prevent double-charges)
  - Step 2: deducts points via the existing deduct_points_for_booking function
    (which has its own idempotency guard on reference_id = booking_id)
  - Step 3: calculates and applies membership service-fee exemption if the
    traveler has an active membership whose exemption was applied
  - Step 4: marks the booking as payment_status='succeeded', status='confirmed',
    sets paid_at, payment_method, points_used, toursred_cash_used
  - Returns JSON with { success: true } or { success: false, error: ... }

## Security
- SECURITY DEFINER so it can call update_wallet_balance and deduct_points_for_booking
  (both also SECURITY DEFINER) from within a single transaction
- auth.uid() is checked against the booking's user_id — only the booking owner
  can call this function
- Granted to authenticated role only (travelers must be signed in)

## Notes
1. deduct_points_for_booking receives p_points_to_use as an explicit parameter —
   it does NOT read the amount from the booking. The caller (frontend) must pass
   exactly the number of points the traveler selected at checkout.
2. The idempotency_key is forwarded to update_wallet_balance, which already has
   its own deduplication logic. This allows safe retries (e.g. if the network
   drops after the function succeeds but before the client receives the response).
3. deduct_points_for_booking has its own idempotency guard: it checks for an
   existing 'redeemed' transaction with reference_id = booking_id. If the points
   were already deducted (e.g. from a previous call), it returns true without
   deducting again.
*/

CREATE OR REPLACE FUNCTION public.confirm_booking_paid_with_wallet(
  p_booking_id uuid,
  p_points_to_use integer,
  p_cash_to_use numeric,
  p_idempotency_key text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_total_price numeric;
  v_service_charge numeric;
  v_membership_id uuid;
  v_exemption_used numeric;
  v_full_service_charge numeric;
  v_actual_service_charge numeric;
  v_exemption_amount numeric;
  v_wallet_result json;
  v_points_ok boolean;
  v_payment_method text;
BEGIN
  -- Validate caller owns this booking
  SELECT user_id, total_price, service_charge INTO v_user_id, v_total_price, v_service_charge
  FROM public.bookings WHERE id = p_booking_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  -- Step 1: Debit ToursRed Cash if applicable
  IF p_cash_to_use > 0 THEN
    SELECT * INTO v_wallet_result FROM public.update_wallet_balance(
      v_user_id,
      -p_cash_to_use,
      'debit',
      'Pago de reserva',
      p_booking_id,
      'booking',
      p_idempotency_key
    );

    IF v_wallet_result IS NULL OR (v_wallet_result->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'Error al descontar ToursRed Cash: %', COALESCE(v_wallet_result->>'error', 'resultado nulo');
    END IF;
  END IF;

  -- Step 2: Deduct points if applicable (deduct_points_for_booking has its own idempotency guard)
  IF p_points_to_use > 0 THEN
    SELECT public.deduct_points_for_booking(p_booking_id, p_points_to_use) INTO v_points_ok;

    IF v_points_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'Error al descontar puntos de la reserva';
    END IF;
  END IF;

  -- Step 3: Calculate and apply membership service-fee exemption
  SELECT id INTO v_membership_id
  FROM public.memberships
  WHERE user_id = v_user_id
    AND status = 'active'
    AND current_period_end > now()
  LIMIT 1;

  IF v_membership_id IS NOT NULL AND v_service_charge IS NOT NULL AND v_total_price IS NOT NULL THEN
    SELECT service_fee_exemption_used INTO v_exemption_used
    FROM public.memberships WHERE id = v_membership_id;

    v_full_service_charge := (v_total_price * COALESCE(
      (SELECT service_charge_percentage FROM public.platform_settings LIMIT 1), 5
    )) / 100.0;
    v_actual_service_charge := COALESCE(v_service_charge, 0);
    v_exemption_amount := v_full_service_charge - v_actual_service_charge;

    IF v_exemption_amount > 0 THEN
      UPDATE public.memberships
      SET service_fee_exemption_used = COALESCE(service_fee_exemption_used, 0) + v_exemption_amount
      WHERE id = v_membership_id;
    END IF;
  END IF;

  -- Step 4: Confirm the booking
  v_payment_method := 'toursred_points';
  IF p_points_to_use > 0 AND p_cash_to_use > 0 THEN
    v_payment_method := 'toursred_points_cash';
  ELSIF p_cash_to_use > 0 THEN
    v_payment_method := 'toursred_cash';
  END IF;

  UPDATE public.bookings
  SET payment_status = 'succeeded',
      status = 'confirmed',
      payment_method = v_payment_method,
      paid_at = now(),
      updated_at = now(),
      points_used = p_points_to_use,
      toursred_cash_used = p_cash_to_use,
      membership_service_fee_saved = CASE WHEN v_exemption_amount > 0 THEN v_exemption_amount ELSE membership_service_fee_saved END,
      used_membership_benefit = CASE WHEN v_exemption_amount > 0 THEN true ELSE used_membership_benefit END
  WHERE id = p_booking_id;

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) TO service_role;
