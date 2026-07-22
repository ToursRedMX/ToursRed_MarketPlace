
CREATE OR REPLACE FUNCTION public.expire_supplement_approvals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer;
BEGIN
  UPDATE booking_supplements
  SET
    status       = 'cancelled',
    cancelled_at = now(),
    cancelled_by = 'expiry',
    updated_at   = now()
  WHERE
    status IN ('approved', 'pending_payment')
    AND expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
