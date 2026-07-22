-- Fix: deduct_points_for_partial_cancellation now validates the caller is the booking
-- owner OR has agency/admin role. The p_user_id is still accepted but must match the
-- booking's user_id, preventing a caller from deducting points from an arbitrary user.

DROP FUNCTION IF EXISTS public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.deduct_points_for_partial_cancellation(
  p_booking_id uuid,
  p_partial_cancellation_id uuid,
  p_user_id uuid,
  p_points_to_deduct integer
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
  v_current_balance integer;
BEGIN
  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

  -- Verify p_user_id matches the actual booking owner — never trust caller alone
  SELECT user_id INTO v_booking_user_id
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_booking_user_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  IF p_user_id <> v_booking_user_id THEN
    RAISE EXCEPTION 'p_user_id does not match booking owner';
  END IF;

  -- Allow: booking owner OR agency/admin (agency initiates partial cancellations)
  IF v_caller_id <> v_booking_user_id AND v_caller_role NOT IN ('agency', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: cannot deduct points for booking owned by another user';
  END IF;

  v_wallet_id := get_or_create_points_wallet(p_user_id);

  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_partial_cancellation_id
    AND type = 'partial_cancellation'
  ) THEN
    RAISE NOTICE 'Points already deducted for partial cancellation %', p_partial_cancellation_id;
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance
  FROM toursred_points_wallets
  WHERE id = v_wallet_id;

  p_points_to_deduct := LEAST(p_points_to_deduct, v_current_balance);

  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  UPDATE toursred_points_wallets
  SET balance = balance - p_points_to_deduct,
      total_used = total_used + p_points_to_deduct,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, p_user_id, -p_points_to_deduct, v_new_balance,
    'partial_cancellation',
    'Ajuste de puntos por cancelación parcial de viajero(s)',
    p_partial_cancellation_id,
    'booking_partial_cancellation'
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) TO authenticated;
