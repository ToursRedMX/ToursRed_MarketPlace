
-- Migration 4: Remove p_user_id from deduct_points_for_booking.
-- Derive user_id from bookings table; caller (stripe-webhook service role) is trusted.
-- Signature change requires DROP first.

DROP FUNCTION IF EXISTS public.deduct_points_for_booking(uuid, uuid, integer) CASCADE;

CREATE OR REPLACE FUNCTION public.deduct_points_for_booking(
  p_booking_id uuid,
  p_points_to_deduct integer
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_wallet_id uuid;
  v_new_balance integer;
  v_current_balance integer;
BEGIN
  IF p_points_to_deduct <= 0 THEN
    RETURN false;
  END IF;

  -- Derive and validate user_id from booking
  SELECT user_id INTO v_user_id FROM public.bookings WHERE id = p_booking_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- Authenticated callers may only operate on their own booking
  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  v_wallet_id := get_or_create_points_wallet(v_user_id);

  IF EXISTS (
    SELECT 1 FROM public.toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'redeemed'
  ) THEN
    RAISE NOTICE 'Points already deducted for booking %', p_booking_id;
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance
  FROM public.toursred_points_wallets
  WHERE id = v_wallet_id;

  IF v_current_balance < p_points_to_deduct THEN
    RAISE EXCEPTION 'Insufficient points. Current balance: %, Required: %', v_current_balance, p_points_to_deduct;
  END IF;

  UPDATE public.toursred_points_wallets
  SET balance = balance - p_points_to_deduct,
      total_used = total_used + p_points_to_deduct,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, v_user_id, -p_points_to_deduct, v_new_balance,
    'redeemed', 'Puntos canjeados en reserva',
    p_booking_id, 'booking'
  );

  RETURN true;
END;
$$;
