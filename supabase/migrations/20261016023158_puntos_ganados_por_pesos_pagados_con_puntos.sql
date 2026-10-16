-- Los pesos pagados con puntos no generaban puntos en las reservas.
--
-- ============================================================================
-- LA REGLA (Axel, 16-oct-2026)
-- ============================================================================
--
-- Cada peso pagado genera un punto, con cualquier forma de pago:
--
--   pasarela (Stripe, PayPal, ...)   x1
--   puntos (100 pts = $1)            x1  -- nunca dobles: los puntos NO son monedero
--   ToursRed Cash                    x2  -- solo si la reserva no uso pasarela
--                                    x1  -- si hubo pasarela
--
-- Los puntos solo cubren hasta el 50% de una reserva (create_booking_atomic,
-- v_max_points_allowed). Pagar sin pasarela -100% Cash, o puntos + Cash-
-- exenta el cargo por servicio; eso no cambia aqui.
--
-- ============================================================================
-- EL AGUJERO, MEDIDO EL 16-OCT-2026
-- ============================================================================
--
-- auto_award_points_on_booking_completion pasa como base
-- user_payment + toursred_cash_used (migracion 20260930220000), y
-- award_points_for_booking duplicaba esa base entera si no hubo pasarela. Los
-- puntos usados nunca entraban:
--
--   TRG-0E05WC6UZ7P  25,000 pts + $250 Stripe  -> 250 puntos  (debian 500)
--   TRG-IDBZH9ZXZHX  $250 Cash + 25,000 pts    -> 500 puntos  (debian 750)
--
-- Suplementos, extras y mensualidades si contaban lo pagado con puntos, pero
-- lo DUPLICABAN como si fuera monedero; eso se corrige en sus Edge Functions
-- en el mismo PR.
--
-- ============================================================================
-- EL FIX
-- ============================================================================
--
-- Solo award_points_for_booking, y solo el calculo. La unica que la llama es
-- el trigger, que sigue pasando user_payment + toursred_cash_used; la parte
-- de puntos la lee de la reserva, igual que ya leia points_used para decidir
-- si el pago fue sin pasarela. Firma, permisos, membresia y el resto de la
-- funcion quedan como estaban (copiados de pg_get_functiondef el 16-oct).

CREATE OR REPLACE FUNCTION public.award_points_for_booking(p_booking_id uuid, p_amount_to_pay numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_is_full_wallet boolean;
  v_pesos_en_puntos numeric;
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

  -- Pago sin pasarela: nada quedo pendiente de pasarela (user_payment=0) y
  -- entro cash o puntos. Misma regla que confirm_booking_paid_with_wallet
  -- usa para la exencion de cargo por servicio.
  v_is_full_wallet := v_user_payment = 0 AND (v_toursred_cash_used > 0 OR v_points_used > 0);

  -- 100 puntos = $1, la misma conversion que deduct_points_for_booking.
  v_pesos_en_puntos := v_points_used / 100.0;

  v_wallet_id := get_or_create_points_wallet(v_user_id);

  -- p_amount_to_pay es pasarela + Cash. Sin pasarela es solo Cash y va doble;
  -- lo pagado con puntos va siempre sencillo.
  IF v_is_full_wallet THEN
    v_points_to_award := FLOOR(p_amount_to_pay * 2 + v_pesos_en_puntos)::integer;
  ELSE
    v_points_to_award := FLOOR(p_amount_to_pay + v_pesos_en_puntos)::integer;
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
$function$;
