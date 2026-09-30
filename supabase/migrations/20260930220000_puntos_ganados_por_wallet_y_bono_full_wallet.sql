-- Puntos ganados en 0 cuando la reserva se paga (total o parcialmente) con
-- ToursRed Cash via confirm_booking_paid_with_wallet, y el bono de puntos
-- dobles por pagar 100% con wallet nunca se dispara.
--
-- ============================================================================
-- EL AGUJERO
-- ============================================================================
--
-- create_booking_atomic calcula bookings.user_payment como lo que falta
-- cobrar por PASARELA, ya restando wallet y puntos:
--
--   user_payment = GREATEST(0, due_now - points_discount - wallet_discount)
--
-- Si wallet + puntos cubren el 100% de due_now, user_payment queda en 0 desde
-- que se crea la reserva. confirm_booking_paid_with_wallet nunca toca esa
-- columna al confirmar. El trigger que otorga puntos usa exactamente esa
-- columna como base:
--
--   auto_award_points_on_booking_completion():
--     award_points_for_booking(NEW.id, NEW.user_payment)
--
-- Con user_payment en 0, award_points_for_booking recibe 0 y otorga 0 puntos
-- sin importar cuanto wallet (toursred_cash_used) haya entrado de verdad.
--
-- Ademas, adentro de award_points_for_booking, el bono de puntos dobles por
-- pagar 100% con wallet compara mal:
--
--   v_is_full_wallet := v_user_payment > 0 AND v_total_covered >= v_user_payment;
--
-- Si v_user_payment es 0 (que es justo el caso de una reserva 100% wallet
-- bajo el create_booking_atomic actual), "v_user_payment > 0" es falso y el
-- bono NUNCA se aplica: la promo de puntos dobles esta muerta hoy para
-- cualquier reserva creada con el create_booking_atomic vigente.
--
-- ============================================================================
-- EVIDENCIA (11-sep..30-sep-2026, no es una lectura de codigo)
-- ============================================================================
--
-- De las 6 reservas confirmadas y pagadas con wallet que existen hoy, 4
-- tienen points_earned = 0 pese a pagos reales de wallet de $500, $500, $500
-- y $5,500 (las 2 que si tienen puntos son de una version anterior de
-- create_booking_atomic, de antes de que restara wallet_discount de
-- user_payment). La reserva de prueba TRG-ODURIADXQ2D (30-sep-2026, $250 via
-- wallet + 25,000 puntos) lo reprodujo en vivo: user_payment=0,
-- toursred_cash_used=250, points_earned=0.
--
-- Por separado, la unica reserva confirmada por OpenPay tambien tiene
-- points_earned=0: openpay-webhook decrementa user_payment a ~0 en el MISMO
-- UPDATE que confirma la reserva (linea "user_payment: newUserPayment" junto
-- a "status: confirmed"), asi que el trigger ve un user_payment ya vaciado.
-- Stripe, MercadoPago, PayPal y Conekta NUNCA tocan user_payment al confirmar
-- -por eso a ellos si les funciona (16/16 reservas de gateway con puntos
-- ganados correctos)-. Ese fix va en el codigo de la Edge Function, no aqui.
--
-- ============================================================================
-- EL FIX
-- ============================================================================
--
-- 1. auto_award_points_on_booking_completion: la base para otorgar puntos
--    pasa a ser user_payment + toursred_cash_used, no solo user_payment. Para
--    reservas de pasarela (toursred_cash_used=0) el numero no cambia. Para
--    reservas de wallet (user_payment=0 por diseno de create_booking_atomic)
--    ahora se usa el monto real de wallet.
--
-- 2. award_points_for_booking: v_is_full_wallet pasa a usar la MISMA regla
--    que ya usa confirm_booking_paid_with_wallet (Step 3, exencion de cargo
--    por servicio) para detectar "pago 100% wallet":
--
--      COALESCE(user_payment, 0) = 0 AND (cash_usado > 0 OR puntos_usados > 0)
--
--    en vez de comparar contra un user_payment que el propio diseno actual
--    deja en 0 para este caso. Es la regla que el repo ya usa en otro lado
--    para el mismo concepto, no una nueva.
--
-- Reservas de pasarela (Stripe/MercadoPago/PayPal/Conekta) no cambian de
-- comportamiento: ahi toursred_cash_used=0 y user_payment>0, asi que la suma
-- no varia y v_is_full_wallet sigue dando falso.

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

  -- Pago 100% wallet: nada quedo pendiente de pasarela (user_payment=0) y
  -- entro cash o puntos. Misma regla que confirm_booking_paid_with_wallet
  -- usa para la exencion de cargo por servicio.
  v_is_full_wallet := v_user_payment = 0 AND (v_toursred_cash_used > 0 OR v_points_used > 0);

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
      (COALESCE(NEW.user_payment, 0) + COALESCE(NEW.toursred_cash_used, 0))::numeric
    );

    NEW.points_earned := v_points_awarded;
  END IF;

  RETURN NEW;
END;
$$;
