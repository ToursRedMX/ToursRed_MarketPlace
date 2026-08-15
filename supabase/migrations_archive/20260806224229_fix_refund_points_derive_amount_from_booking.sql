/*
# Fix refund_points_for_cancelled_booking: derive refund amount from DB

## Problem
The function accepted p_points_to_refund as a parameter, trusting the caller's
stated amount without verifying it matches the actual points_used stored in the
booking. Any authenticated user could request an arbitrary refund amount.

## Fix
1. Remove p_points_to_refund from the function signature entirely.
2. Derive the refund amount from bookings.points_used (the authoritative value
   stored when the booking was created/paid).
3. Revoke EXECUTE from authenticated and anon — only service_role (edge functions)
   should call this function after verifying the caller's identity.
4. Keep the existing auth guard (booking owner or agency/admin) as defense-in-depth.

## Security
- SECURITY DEFINER, search_path = 'public'
- EXECUTE revoked from authenticated and anon
- EXECUTE retained on service_role only
- Amount derived from DB, never from caller input
*/

DROP FUNCTION IF EXISTS public.refund_points_for_cancelled_booking(uuid, integer);
DROP FUNCTION IF EXISTS public.refund_points_for_cancelled_booking(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.refund_points_for_cancelled_booking(
  p_booking_id uuid
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
  v_points_used integer;
  v_wallet_id uuid;
  v_new_balance integer;
  v_current_total_used integer;
BEGIN
  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

  -- Derive the actual booking owner and points_used from the DB
  SELECT user_id, COALESCE(points_used, 0)
    INTO v_booking_user_id, v_points_used
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_booking_user_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  -- Defense-in-depth: allow owner or agency/admin (edge function already verified)
  IF v_caller_id <> v_booking_user_id AND v_caller_role NOT IN ('agency', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: cannot refund points for booking owned by another user';
  END IF;

  -- No points to refund
  IF v_points_used <= 0 THEN
    RETURN true;
  END IF;

  v_wallet_id := get_or_create_points_wallet(v_booking_user_id);

  -- Prevent duplicate refunds
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
  SET balance = balance + v_points_used,
      total_used = GREATEST(0, total_used - v_points_used),
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
    v_points_used,
    v_new_balance,
    'refunded',
    'Reembolso por cancelación de reserva',
    p_booking_id,
    'booking'
  );

  RETURN true;
END;
$$;

-- Revoke direct access from authenticated and anon — only service_role (edge functions) may call
REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_points_for_cancelled_booking(uuid) TO service_role;
