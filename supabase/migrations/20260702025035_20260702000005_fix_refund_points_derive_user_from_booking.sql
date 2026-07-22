-- Fix: refund_points_for_cancelled_booking derives p_user_id from the booking record
-- instead of trusting the client-supplied value. Removes p_user_id from signature.
-- Caller must own the booking (auth.uid() = user_id) or be agency/admin.

DROP FUNCTION IF EXISTS public.refund_points_for_cancelled_booking(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.refund_points_for_cancelled_booking(
  p_booking_id uuid,
  p_points_to_refund integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_booking_user_id uuid;
  v_wallet_id uuid;
  v_new_balance integer;
  v_current_total_used integer;
BEGIN
  IF p_points_to_refund <= 0 THEN
    RETURN false;
  END IF;

  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

  -- Derive the actual booking owner from the DB — never trust the caller
  SELECT user_id INTO v_booking_user_id
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_booking_user_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  -- Allow: booking owner (self-cancellation via Stripe redirect) OR agency/admin
  IF v_caller_id <> v_booking_user_id AND v_caller_role NOT IN ('agency', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: cannot refund points for booking owned by another user';
  END IF;

  v_wallet_id := get_or_create_points_wallet(v_booking_user_id);

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
    v_booking_user_id,
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

GRANT EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid, integer) TO authenticated;
