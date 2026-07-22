
-- Migration 2: Remove p_user_id from award/refund/redeem points functions.
-- Derive user_id from bookings table instead, validated against auth.uid() ownership.
-- Must DROP ... CASCADE because we are changing function signatures.

-- ============================================================
-- 1. award_points_for_booking
-- ============================================================
DROP FUNCTION IF EXISTS public.award_points_for_booking(uuid, uuid, numeric) CASCADE;

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
BEGIN
  IF p_amount_to_pay < 0 THEN
    RETURN 0;
  END IF;

  -- Derive user_id from booking (service-role calls from triggers are trusted)
  SELECT user_id INTO v_user_id FROM bookings WHERE id = p_booking_id;
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

  v_wallet_id := get_or_create_points_wallet(v_user_id);

  v_points_to_award := FLOOR(p_amount_to_pay)::integer;

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

-- ============================================================
-- 2. refund_points_for_cancellation
-- ============================================================
DROP FUNCTION IF EXISTS public.refund_points_for_cancellation(uuid, uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.refund_points_for_cancellation(p_booking_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_wallet_id uuid;
  v_points_to_refund integer;
  v_new_balance integer;
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM toursred_points_transactions
    WHERE reference_id = p_booking_id
    AND type = 'refund'
    AND reference_type = 'booking'
  ) THEN
    RETURN 0;
  END IF;

  -- Derive user_id and points_used from booking
  SELECT user_id, points_used
  INTO v_user_id, v_points_to_refund
  FROM bookings
  WHERE id = p_booking_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- Authenticated callers may only operate on their own booking
  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  IF v_points_to_refund IS NULL OR v_points_to_refund = 0 THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = v_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la billetera de puntos';
  END IF;

  UPDATE toursred_points_wallets
  SET balance = balance + v_points_to_refund,
      total_used = GREATEST(0, total_used - v_points_to_refund),
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, v_user_id, v_points_to_refund, v_new_balance,
    'refund', 'Reembolso de puntos por cancelacion de reserva',
    p_booking_id, 'booking'
  );

  RETURN v_points_to_refund;
END;
$$;

-- ============================================================
-- 3. redeem_points_for_booking
-- ============================================================
DROP FUNCTION IF EXISTS public.redeem_points_for_booking(uuid, uuid, integer, numeric) CASCADE;

CREATE OR REPLACE FUNCTION public.redeem_points_for_booking(
  p_booking_id uuid,
  p_points_to_use integer,
  p_total_price numeric
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_wallet_id uuid;
  v_available_points integer;
  v_max_points_allowed integer;
  v_new_balance integer;
  v_can_use_points boolean;
BEGIN
  -- Derive user_id from booking
  SELECT user_id INTO v_user_id FROM bookings WHERE id = p_booking_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- Authenticated callers may only operate on their own booking
  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  v_can_use_points := check_can_use_points(v_user_id);
  IF NOT v_can_use_points THEN
    RAISE EXCEPTION 'No puedes usar puntos. Necesitas una membresía activa.';
  END IF;

  SELECT id INTO v_wallet_id
  FROM toursred_points_wallets
  WHERE user_id = v_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la billetera de puntos';
  END IF;

  v_available_points := calculate_available_points(v_user_id);

  IF p_points_to_use > v_available_points THEN
    RAISE EXCEPTION 'Puntos insuficientes. Disponibles: %, Solicitados: %', v_available_points, p_points_to_use;
  END IF;

  v_max_points_allowed := FLOOR(p_total_price * 50)::integer;
  IF p_points_to_use > v_max_points_allowed THEN
    RAISE EXCEPTION 'No puedes usar más del 50%% del total con puntos. Máximo: % puntos', v_max_points_allowed;
  END IF;

  UPDATE toursred_points_wallets
  SET balance = balance - p_points_to_use,
      total_used = total_used + p_points_to_use,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type,
    description, reference_id, reference_type
  ) VALUES (
    v_wallet_id, v_user_id, -p_points_to_use, v_new_balance,
    'redeemed', 'Puntos canjeados en reserva',
    p_booking_id, 'booking'
  );

  UPDATE bookings SET points_used = p_points_to_use WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ============================================================
-- 4. Recreate trigger functions to match new signatures
-- ============================================================
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

CREATE OR REPLACE FUNCTION public.auto_refund_points_on_cancellation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_points_refunded integer;
BEGIN
  IF NEW.status = 'cancelled'
  AND (OLD.status IS NULL OR OLD.status != 'cancelled')
  AND NEW.points_used > 0 THEN

    v_points_refunded := refund_points_for_cancellation(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate triggers (CASCADE dropped them above)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_auto_award_points_on_booking_completion'
  ) THEN
    CREATE TRIGGER trg_auto_award_points_on_booking_completion
      BEFORE UPDATE ON public.bookings
      FOR EACH ROW
      EXECUTE FUNCTION public.auto_award_points_on_booking_completion();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_auto_refund_points_on_cancellation'
  ) THEN
    CREATE TRIGGER trg_auto_refund_points_on_cancellation
      AFTER UPDATE ON public.bookings
      FOR EACH ROW
      EXECUTE FUNCTION public.auto_refund_points_on_cancellation();
  END IF;
END;
$$;
