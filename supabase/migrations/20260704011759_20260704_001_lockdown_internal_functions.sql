
-- Migration 1: Lock down internal-only functions + harden get_executive_id_for_user
-- create_notification: callable only by service role (internal use via triggers/edge functions)
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz)
  FROM PUBLIC, authenticated;

-- create_points_wallet_for_traveler: internal helper, only called by get_or_create_points_wallet
REVOKE EXECUTE ON FUNCTION public.create_points_wallet_for_traveler(uuid)
  FROM PUBLIC, authenticated;

-- get_executive_id_for_user: used in RLS policies via auth.uid(), add guard for direct calls
-- Must recreate as plpgsql to support IF logic (was SQL STABLE)
CREATE OR REPLACE FUNCTION public.get_executive_id_for_user(p_user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- When called from RLS policies, auth.uid() may be NULL (service role); allow that.
  -- When called by an authenticated user, they may only query their own executive id.
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado: no puedes consultar el ejecutivo de otro usuario';
  END IF;

  RETURN (
    SELECT id FROM account_executives
    WHERE user_id = p_user_id AND is_active = true
    LIMIT 1
  );
END;
$$;
