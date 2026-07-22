-- Auto-expire featured tour slots whose expires_at has passed

CREATE OR REPLACE FUNCTION public.expire_featured_tour_slots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE featured_tour_slots
  SET status = 'expired', updated_at = now()
  WHERE status = 'active'
    AND expires_at < now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_featured_tour_slots() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'expire-featured-tour-slots',
  '0 * * * *',
  $$SELECT public.expire_featured_tour_slots()$$
);
