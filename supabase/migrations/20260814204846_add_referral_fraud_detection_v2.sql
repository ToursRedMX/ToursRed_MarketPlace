-- Part 7: Referral fraud detection system
-- Implements basic fraud signal checks and an admin query function

CREATE OR REPLACE FUNCTION public.check_referral_fraud_signals(
  p_referral_relationship_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rel RECORD;
  v_referrer_ip text;
  v_referee_ip text;
  v_recent_completions int;
BEGIN
  SELECT * INTO v_rel
  FROM public.referral_relationships
  WHERE id = p_referral_relationship_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- Signal 1: Same IP address used by referrer and referee
  SELECT us.ip_address INTO v_referrer_ip
  FROM public.user_sessions us
  WHERE us.user_id = v_rel.referrer_user_id
    AND us.ip_address IS NOT NULL
  ORDER BY us.login_at DESC
  LIMIT 1;

  SELECT us.ip_address INTO v_referee_ip
  FROM public.user_sessions us
  WHERE us.user_id = v_rel.referred_user_id
    AND us.ip_address IS NOT NULL
  ORDER BY us.login_at DESC
  LIMIT 1;

  IF v_referrer_ip IS NOT NULL AND v_referrer_ip = v_referee_ip THEN
    INSERT INTO public.referral_fraud_logs (referral_relationship_id, fraud_type, details)
    VALUES (
      p_referral_relationship_id,
      'same_ip',
      jsonb_build_object('ip', v_referrer_ip, 'referrer_user_id', v_rel.referrer_user_id, 'referred_user_id', v_rel.referred_user_id)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Signal 2: Multiple referrals completed in a very short time window (< 1 hour)
  SELECT COUNT(*) INTO v_recent_completions
  FROM public.referral_relationships
  WHERE referrer_user_id = v_rel.referrer_user_id
    AND status = 'completed'
    AND completed_at >= now() - INTERVAL '1 hour';

  IF v_recent_completions >= 5 THEN
    INSERT INTO public.referral_fraud_logs (referral_relationship_id, fraud_type, details)
    VALUES (
      p_referral_relationship_id,
      'rapid_completions',
      jsonb_build_object('count_in_last_hour', v_recent_completions, 'referrer_user_id', v_rel.referrer_user_id)
    )
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_referral_fraud_signals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_referral_fraud_signals(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_referral_fraud_signals(
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  referral_relationship_id uuid,
  fraud_type text,
  details jsonb,
  created_at timestamptz,
  referrer_user_id uuid,
  referred_user_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rfl.id, rfl.referral_relationship_id, rfl.fraud_type, rfl.details, rfl.created_at,
         rr.referrer_user_id, rr.referred_user_id
  FROM public.referral_fraud_logs rfl
  JOIN public.referral_relationships rr ON rr.id = rfl.referral_relationship_id
  ORDER BY rfl.created_at DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_referral_fraud_signals(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_fraud_signals(int) TO authenticated;

DROP POLICY IF EXISTS "referral_fraud_logs_service_insert" ON public.referral_fraud_logs;
CREATE POLICY "referral_fraud_logs_service_insert"
  ON public.referral_fraud_logs FOR INSERT
  TO service_role
  WITH CHECK (true);