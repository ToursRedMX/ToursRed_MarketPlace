
CREATE OR REPLACE FUNCTION public.award_referral_bonus(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_referred_by_user_id uuid;
  v_booking_status text;
  v_booking_payment_status text;
  v_booking_referral_awarded boolean;
  v_relationship record;
  v_bonus_points integer;
  v_program_enabled boolean;
  v_referrer_wallet_id uuid;
  v_referred_wallet_id uuid;
  v_referrer_balance integer;
  v_referred_balance integer;
BEGIN
  SELECT b.user_id, b.status, b.payment_status, b.referral_bonus_awarded, u.referred_by_user_id
  INTO v_user_id, v_booking_status, v_booking_payment_status, v_booking_referral_awarded, v_referred_by_user_id
  FROM public.bookings b
  JOIN public.users u ON b.user_id = u.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT referral_program_enabled, referral_bonus_points
  INTO v_program_enabled, v_bonus_points
  FROM public.platform_settings
  LIMIT 1;

  IF NOT v_program_enabled THEN RETURN; END IF;
  IF v_bonus_points IS NULL THEN v_bonus_points := 5000; END IF;

  IF v_booking_status != 'confirmed' OR v_booking_payment_status != 'succeeded' THEN RETURN; END IF;
  IF v_booking_referral_awarded THEN RETURN; END IF;
  IF v_referred_by_user_id IS NULL THEN RETURN; END IF;

  SELECT *
  INTO v_relationship
  FROM public.referral_relationships
  WHERE referred_user_id = v_user_id
    AND status = 'pending';

  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE user_id = v_user_id
      AND status = 'confirmed'
      AND payment_status = 'succeeded'
      AND id != p_booking_id
  ) THEN RETURN; END IF;

  SELECT id, balance INTO v_referrer_wallet_id, v_referrer_balance
  FROM public.toursred_points_wallets WHERE user_id = v_relationship.referrer_user_id;

  SELECT id, balance INTO v_referred_wallet_id, v_referred_balance
  FROM public.toursred_points_wallets WHERE user_id = v_relationship.referred_user_id;

  IF v_referrer_wallet_id IS NULL THEN
    INSERT INTO public.toursred_points_wallets (user_id, balance, total_earned)
    VALUES (v_relationship.referrer_user_id, 0, 0)
    RETURNING id, balance INTO v_referrer_wallet_id, v_referrer_balance;
  END IF;

  IF v_referred_wallet_id IS NULL THEN
    INSERT INTO public.toursred_points_wallets (user_id, balance, total_earned)
    VALUES (v_relationship.referred_user_id, 0, 0)
    RETURNING id, balance INTO v_referred_wallet_id, v_referred_balance;
  END IF;

  INSERT INTO public.toursred_points_transactions (
    wallet_id, user_id, type, amount, balance_after, description, reference_type, reference_id
  ) VALUES (
    v_referrer_wallet_id, v_relationship.referrer_user_id, 'earned',
    v_bonus_points, v_referrer_balance + v_bonus_points,
    'Bono por referido completado', 'referral', v_relationship.id
  );

  UPDATE public.toursred_points_wallets
  SET balance = balance + v_bonus_points, total_earned = total_earned + v_bonus_points, updated_at = now()
  WHERE id = v_referrer_wallet_id;

  INSERT INTO public.toursred_points_transactions (
    wallet_id, user_id, type, amount, balance_after, description, reference_type, reference_id
  ) VALUES (
    v_referred_wallet_id, v_relationship.referred_user_id, 'earned',
    v_bonus_points, v_referred_balance + v_bonus_points,
    'Bono de bienvenida por registro con código de referido', 'referral', v_relationship.id
  );

  UPDATE public.toursred_points_wallets
  SET balance = balance + v_bonus_points, total_earned = total_earned + v_bonus_points, updated_at = now()
  WHERE id = v_referred_wallet_id;

  UPDATE public.referral_relationships
  SET status = 'completed', referrer_bonus_awarded = true, referred_bonus_awarded = true,
      first_booking_id = p_booking_id, completed_at = now()
  WHERE id = v_relationship.id;

  UPDATE public.referral_codes
  SET successful_referrals_count = successful_referrals_count + 1, updated_at = now()
  WHERE user_id = v_relationship.referrer_user_id;

  INSERT INTO public.referral_bonuses (
    referral_relationship_id, user_id, points_amount, status, awarded_at, reason
  ) VALUES
    (v_relationship.id, v_relationship.referrer_user_id, v_bonus_points, 'awarded', now(), 'Referido completó primera reserva'),
    (v_relationship.id, v_relationship.referred_user_id, v_bonus_points, 'awarded', now(), 'Bono de bienvenida');

  UPDATE public.bookings SET referral_bonus_awarded = true WHERE id = p_booking_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES
    (
      v_relationship.referrer_user_id, 'referral_completed', '¡Referido completado!',
      format('Has ganado %s puntos ToursRed porque tu referido completó su primera reserva', v_bonus_points),
      jsonb_build_object('referral_id', v_relationship.id)
    ),
    (
      v_relationship.referred_user_id, 'referral_bonus_earned', '¡Bono de bienvenida!',
      format('Has recibido %s puntos ToursRed por registrarte con un código de referido', v_bonus_points),
      jsonb_build_object('referral_id', v_relationship.id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_referral_bonus_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'confirmed' AND NEW.payment_status = 'succeeded') AND
     (OLD.status != 'confirmed' OR OLD.payment_status != 'succeeded') THEN
    PERFORM public.award_referral_bonus(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
