-- Part 12: Add advisory lock to confirm-booking-checkin via atomic RPC
-- Creates redeem_checkin_token_atomic to prevent TOCTOU race on QR token redemption
CREATE OR REPLACE FUNCTION public.redeem_checkin_token_atomic(
  p_token text,
  p_checkin_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_rec RECORD;
BEGIN
  -- Advisory lock on the token hash serializes concurrent redemptions
  PERFORM pg_advisory_xact_lock(hashtext(p_token));

  SELECT id, booking_id, expires_at, redeemed_at
  INTO v_token_rec
  FROM public.booking_checkin_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token no encontrado');
  END IF;

  IF v_token_rec.redeemed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este codigo QR ya fue utilizado para hacer check-in', 'already_redeemed', true);
  END IF;

  IF v_token_rec.expires_at < p_checkin_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este codigo QR ha expirado');
  END IF;

  -- Atomically mark as redeemed
  UPDATE public.booking_checkin_tokens
  SET redeemed_at = p_checkin_at,
      updated_at = now()
  WHERE id = v_token_rec.id;

  RETURN jsonb_build_object('success', true, 'booking_id', v_token_rec.booking_id, 'token_id', v_token_rec.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_checkin_token_atomic(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_checkin_token_atomic(text, timestamptz) TO authenticated, service_role;