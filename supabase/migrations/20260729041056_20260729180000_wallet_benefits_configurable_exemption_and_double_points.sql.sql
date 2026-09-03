-- ============================================================
-- 1. Add configurable monthly exemption limit to platform_settings
-- ============================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS membership_service_fee_exemption_monthly_limit numeric DEFAULT 500;

-- ============================================================
-- 2. Make apply_membership_service_fee_exemption read the limit from platform_settings
--    instead of hardcoded 500
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_membership_service_fee_exemption(
  p_user_id uuid,
  p_gross_service_charge numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_membership_id   uuid;
  v_exemption_used  numeric;
  v_reset_date      timestamptz;
  v_exemption_available numeric;
  v_exemption_applied   numeric;
  v_net_service_charge  numeric;
  v_monthly_limit numeric;
BEGIN
  -- Read configurable monthly limit from platform_settings (default 500)
  SELECT COALESCE(membership_service_fee_exemption_monthly_limit, 500)
  INTO v_monthly_limit
  FROM public.platform_settings
  LIMIT 1;

  IF v_monthly_limit IS NULL THEN
    v_monthly_limit := 500;
  END IF;

  -- Lock the membership row to prevent concurrent reads from racing
  SELECT id, service_fee_exemption_used, service_fee_exemption_reset_date
  INTO v_membership_id, v_exemption_used, v_reset_date
  FROM public.memberships
  WHERE user_id = p_user_id
    AND status <> 'expired'
    AND current_period_end > now()
  ORDER BY current_period_end DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'exemption_applied', 0,
      'net_service_charge', p_gross_service_charge,
      'gross_service_charge', p_gross_service_charge
    );
  END IF;

  -- Reset monthly pool if the period has elapsed
  IF now() >= v_reset_date THEN
    UPDATE public.memberships
    SET service_fee_exemption_used = 0,
        service_fee_exemption_reset_date = date_trunc('month', now() + interval '1 month')
    WHERE id = v_membership_id;

    v_exemption_used := 0;
  END IF;

  v_exemption_available := GREATEST(0, v_monthly_limit - COALESCE(v_exemption_used, 0));
  v_exemption_applied := LEAST(v_exemption_available, p_gross_service_charge);
  v_net_service_charge := p_gross_service_charge - v_exemption_applied;

  -- Atomically consume from the pool in the same locked transaction
  IF v_exemption_applied > 0 THEN
    UPDATE public.memberships
    SET service_fee_exemption_used = COALESCE(service_fee_exemption_used, 0) + v_exemption_applied
    WHERE id = v_membership_id;
  END IF;

  RETURN json_build_object(
    'exemption_applied', v_exemption_applied,
    'net_service_charge', v_net_service_charge,
    'gross_service_charge', p_gross_service_charge
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_membership_service_fee_exemption(uuid, numeric) TO authenticated, anon;

-- ============================================================
-- 3. Modify award_points_for_booking: double points for 100% wallet payments
--    A booking is "100% wallet" when toursred_cash_used + (points_used / 100) >= user_payment
-- ============================================================

DROP FUNCTION IF EXISTS public.award_points_for_booking(uuid, numeric) CASCADE;

CREATE OR REPLACE FUNCTION public.award_points_for_booking(
  p_booking_id uuid,
  p_amount_to_pay numeric
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_wallet_id uuid;
  v_points_to_award integer;
  v_new_balance integer;
  v_expires_at timestamptz;
  v_has_active_membership boolean;
  v_toursred_cash_used numeric;
  v_points_used integer;
  v_user_payment numeric;
  v_total_covered numeric;
  v_is_full_wallet boolean;
BEGIN
  IF p_amount_to_pay < 0 THEN
    RETURN 0;
  END IF;

  -- Derive user_id and wallet payment info from booking
  SELECT user_id, COALESCE(toursred_cash_used, 0), COALESCE(points_used, 0), COALESCE(user_payment, 0)
  INTO v_user_id, v_toursred_cash_used, v_points_used, v_user_payment
  FROM bookings WHERE id = p_booking_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- Authenticated callers may only operate on their own booking
  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = v_user_id
    AND status = 'active'
    AND current_period_end > now()
  ) INTO v_has_active_membership;

  IF NOT v_has_active_membership THEN
    RETURN 0;
  END IF;

  -- Check if the booking was paid 100% with wallet (cash + points, no card)
  v_total_covered := v_toursred_cash_used + (v_points_used::numeric / 100.0);
  v_is_full_wallet := v_user_payment > 0 AND v_total_covered >= v_user_payment;

  v_wallet_id := get_or_create_points_wallet(v_user_id);

  -- Double points for 100% wallet payments, normal otherwise
  IF v_is_full_wallet THEN
    v_points_to_award := FLOOR(p_amount_to_pay * 2)::integer;
  ELSE
    v_points_to_award := FLOOR(p_amount_to_pay)::integer;
  END IF;

  IF v_points_to_award <= 0 THEN
    RETURN 0;
  END IF;

  v_expires_at := now() + interval '12 months';

  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_award,
      total_earned = total_earned + v_points_to_award,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type, expires_at
  ) VALUES (
    v_wallet_id, v_user_id, v_points_to_award, v_new_balance,
    'earned', 'Puntos ganados por reserva completada',
    p_booking_id, 'booking', v_expires_at
  );

  RETURN v_points_to_award;
END;
$$;

-- Recreate the trigger that depends on award_points_for_booking
CREATE OR REPLACE FUNCTION public.auto_award_points_on_booking_completion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_points_awarded integer;
BEGIN
  IF NEW.status = 'confirmed'
  AND NEW.payment_status = 'succeeded'
  AND (NEW.points_earned IS NULL OR NEW.points_earned = 0) THEN

    v_points_awarded := award_points_for_booking(
      NEW.id,
      NEW.user_payment::numeric
    );

    NEW.points_earned := v_points_awarded;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Create get_earned_points_for_reference function for clawback lookup
--    Returns the total earned points for a given reference_id/reference_type
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_earned_points_for_reference(
  p_reference_id uuid,
  p_reference_type text DEFAULT 'booking'
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_total_earned integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_earned
  FROM public.toursred_points_transactions
  WHERE reference_id = p_reference_id
    AND reference_type = p_reference_type
    AND type = 'earned'
    AND amount > 0;

  RETURN v_total_earned;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_earned_points_for_reference(uuid, text) TO authenticated;
