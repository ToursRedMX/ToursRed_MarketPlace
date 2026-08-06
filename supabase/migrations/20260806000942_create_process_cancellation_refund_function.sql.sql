/*
# Create process_cancellation_refund RPC function

## Purpose
Atomically locks a booking row, verifies it is not already cancelled,
processes a ToursRed Cash wallet refund (if any), and updates the booking
status — all within a single database transaction. This eliminates race
conditions where two concurrent cancellation requests could both pass the
"already cancelled?" check and double-refund the traveler.

## Function: process_cancellation_refund

Parameters:
- p_booking_id uuid — the booking to cancel
- p_refund_amount numeric DEFAULT 0 — amount to refund to ToursRed Cash wallet
- p_reference_type text DEFAULT NULL — e.g. 'traveler_cancellation' or 'admin_cancellation'
- p_description text DEFAULT NULL — human-readable description for the wallet transaction
- p_new_status text DEFAULT 'cancelled' — target status ('cancelled' or 'cancellation_processing')
- p_set_cancelled_at boolean DEFAULT true — whether to set cancelled_at to now()
- p_cancellation_type text DEFAULT NULL — stored in bookings.cancellation_type
- p_cancellation_refund_amount numeric DEFAULT NULL — stored in bookings.cancellation_refund_amount

Logic (all within one transaction):
1. SELECT ... FOR UPDATE on the bookings row — acquires row lock
2. Reject if status = 'cancelled' OR cancelled_at IS NOT NULL (terminal states only)
   — allows transitioning from 'cancellation_processing' to 'cancelled'
3. If p_refund_amount > 0: get or create the user's wallet, then call
   update_wallet_balance with an idempotency key derived from booking_id + reference_type
4. UPDATE bookings with new status, cancelled_at, cancellation_type, cancellation_refund_amount
5. Return JSON with success, transaction_id, and previous_status

## Security
- SECURITY DEFINER, search_path = 'public'
- GRANT EXECUTE to authenticated
- Relies on update_wallet_balance's existing auth guard for the wallet operation
*/

CREATE OR REPLACE FUNCTION public.process_cancellation_refund(
  p_booking_id uuid,
  p_refund_amount numeric DEFAULT 0,
  p_reference_type text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_new_status text DEFAULT 'cancelled',
  p_set_cancelled_at boolean DEFAULT true,
  p_cancellation_type text DEFAULT NULL,
  p_cancellation_refund_amount numeric DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking_id uuid;
  v_current_status text;
  v_cancelled_at timestamptz;
  v_user_id uuid;
  v_wallet_id uuid;
  v_wallet_result json;
  v_transaction_id uuid;
BEGIN
  -- Step 1: Lock the booking row FOR UPDATE (held for the entire transaction)
  SELECT id, status, cancelled_at, user_id
    INTO v_booking_id, v_current_status, v_cancelled_at, v_user_id
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- Step 2: Reject only terminal states — allow 'cancellation_processing' to advance
  IF v_current_status = 'cancelled' OR v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La reserva ya fue cancelada';
  END IF;

  -- Step 3: Process wallet refund if amount > 0
  IF p_refund_amount > 0 AND v_user_id IS NOT NULL THEN
    -- Ensure wallet exists (create if missing, same as edge function logic)
    SELECT id INTO v_wallet_id
    FROM public.toursred_cash_wallets
    WHERE user_id = v_user_id AND is_active = true
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.toursred_cash_wallets (user_id, balance, currency, is_active)
      VALUES (v_user_id, 0, 'MXN', true)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING id INTO v_wallet_id;

      IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id
        FROM public.toursred_cash_wallets
        WHERE user_id = v_user_id AND is_active = true
        LIMIT 1;
      END IF;
    END IF;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'No se pudo obtener ni crear el wallet del usuario';
    END IF;

    -- Nested call to update_wallet_balance (same transaction, same row lock scope)
    -- Idempotency key prevents double-refund if the edge function is retried
    v_wallet_result := public.update_wallet_balance(
      p_user_id := v_user_id,
      p_amount := p_refund_amount,
      p_type := 'refund'::toursred_cash_transaction_type,
      p_description := p_description,
      p_reference_id := p_booking_id,
      p_reference_type := p_reference_type,
      p_idempotency_key := p_booking_id || '_refund_' || COALESCE(p_reference_type, 'cancellation')
    );

    v_transaction_id := (v_wallet_result ->> 'transaction_id')::uuid;
  END IF;

  -- Step 4: Update booking status
  UPDATE public.bookings
  SET
    status = p_new_status,
    cancelled_at = CASE WHEN p_set_cancelled_at THEN now() ELSE NULL END,
    cancellation_type = p_cancellation_type,
    cancellation_refund_amount = p_cancellation_refund_amount
  WHERE id = p_booking_id;

  -- Step 5: Return result
  RETURN json_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_status', v_current_status
  );
END;
$$;

-- Grant execute to authenticated (edge functions use service role which bypasses RLS)
GRANT EXECUTE ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric) TO authenticated;
