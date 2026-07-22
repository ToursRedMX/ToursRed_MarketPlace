
CREATE OR REPLACE FUNCTION public.award_referral_bonus(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_relationship record;
  v_bonus_points integer;
  v_program_enabled boolean;
  v_referrer record;
  v_referred record;
  v_supabase_url text;
BEGIN
  -- Get booking details
  SELECT b.*, u.id as traveler_user_id, u.referred_by_user_id
  INTO v_booking
  FROM public.bookings b
  JOIN public.users u ON b.user_id = u.id
  WHERE b.id = p_booking_id;
  
  -- Check if booking exists
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check if referral program is enabled
  SELECT referral_program_enabled, referral_bonus_points
  INTO v_program_enabled, v_bonus_points
  FROM public.platform_settings
  LIMIT 1;
  
  IF NOT v_program_enabled THEN
    RETURN;
  END IF;
  
  -- Check if booking is confirmed and payment succeeded
  IF v_booking.status != 'confirmado' OR v_booking.payment_status != 'succeeded' THEN
    RETURN;
  END IF;
  
  -- Check if bonus already awarded
  IF v_booking.referral_bonus_awarded THEN
    RETURN;
  END IF;
  
  -- Check if user was referred
  IF v_booking.referred_by_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get referral relationship
  SELECT *
  INTO v_relationship
  FROM public.referral_relationships
  WHERE referred_user_id = v_booking.traveler_user_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check if this is the first booking for the referred user
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE user_id = v_booking.traveler_user_id
      AND status = 'confirmado'
      AND payment_status = 'succeeded'
      AND id != p_booking_id
  ) THEN
    RETURN;
  END IF;
  
  -- Get referrer and referred user details for email
  SELECT email, first_name, last_name INTO v_referrer
  FROM public.users
  WHERE id = v_relationship.referrer_user_id;
  
  SELECT email, first_name, last_name INTO v_referred
  FROM public.users
  WHERE id = v_relationship.referred_user_id;
  
  -- Award points to referrer
  INSERT INTO public.toursred_points_transactions (
    user_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    v_relationship.referrer_user_id,
    'earned',
    v_bonus_points,
    'Bono por referido completado',
    'referral',
    v_relationship.id
  );
  
  -- Update referrer wallet
  UPDATE public.toursred_points_wallets
  SET 
    balance = balance + v_bonus_points,
    total_earned = total_earned + v_bonus_points,
    updated_at = now()
  WHERE user_id = v_relationship.referrer_user_id;
  
  -- Award points to referred user
  INSERT INTO public.toursred_points_transactions (
    user_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    v_relationship.referred_user_id,
    'earned',
    v_bonus_points,
    'Bono de bienvenida por registro con código de referido',
    'referral',
    v_relationship.id
  );
  
  -- Update referred user wallet
  UPDATE public.toursred_points_wallets
  SET 
    balance = balance + v_bonus_points,
    total_earned = total_earned + v_bonus_points,
    updated_at = now()
  WHERE user_id = v_relationship.referred_user_id;
  
  -- Update referral relationship
  UPDATE public.referral_relationships
  SET 
    status = 'completed',
    referrer_bonus_awarded = true,
    referred_bonus_awarded = true,
    first_booking_id = p_booking_id,
    completed_at = now()
  WHERE id = v_relationship.id;
  
  -- Update successful referrals count
  UPDATE public.referral_codes
  SET 
    successful_referrals_count = successful_referrals_count + 1,
    updated_at = now()
  WHERE user_id = v_relationship.referrer_user_id;
  
  -- Create bonus records
  INSERT INTO public.referral_bonuses (
    referral_relationship_id, user_id, points_amount, status, awarded_at, reason
  ) VALUES 
    (v_relationship.id, v_relationship.referrer_user_id, v_bonus_points, 'awarded', now(), 'Referido completó primera reserva'),
    (v_relationship.id, v_relationship.referred_user_id, v_bonus_points, 'awarded', now(), 'Bono de bienvenida');
  
  -- Mark booking as bonus awarded
  UPDATE public.bookings
  SET referral_bonus_awarded = true
  WHERE id = p_booking_id;
  
  -- Create notifications
  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES 
    (
      v_relationship.referrer_user_id,
      'referral_completed',
      '¡Referido completado!',
      format('Has ganado %s puntos ToursRed porque tu referido completó su primera reserva', v_bonus_points),
      jsonb_build_object('referral_relationship_id', v_relationship.id)
    ),
    (
      v_relationship.referred_user_id,
      'referral_bonus_earned',
      '¡Bono de bienvenida!',
      format('Has recibido %s puntos ToursRed por registrarte con un código de referido', v_bonus_points),
      jsonb_build_object('referral_relationship_id', v_relationship.id)
    );
  
  -- Send email to referrer
  BEGIN
    v_supabase_url := current_setting('request.headers')::json->>'x-forwarded-host';
    IF v_supabase_url IS NULL THEN
      v_supabase_url := 'https://your-project.supabase.co';
    END IF;
    
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-referral-completed-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.jwt.claims')::json->>'sub'
      ),
      body := jsonb_build_object(
        'referrerEmail', v_referrer.email,
        'referrerName', COALESCE(v_referrer.first_name || ' ' || v_referrer.last_name, v_referrer.email),
        'referredName', COALESCE(v_referred.first_name || ' ' || v_referred.last_name, v_referred.email),
        'pointsAwarded', v_bonus_points,
        'bookingCode', v_booking.booking_code
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to send referral completed email: %', SQLERRM;
  END;
END;
$$;
