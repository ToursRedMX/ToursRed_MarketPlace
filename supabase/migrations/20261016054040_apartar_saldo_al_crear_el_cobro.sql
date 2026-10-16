-- Apartar los puntos y el ToursRed Cash de una reserva al crear el cobro con
-- pasarela, y devolverlos si la reserva muere sin pagarse.
--
-- ============================================================================
-- LOS HUECOS (medidos el 16-oct-2026)
-- ============================================================================
--
-- Una reserva mixta (puntos o Cash + pasarela) cobra en la pasarela el monto YA
-- DESCONTADO, pero el saldo no se tocaba al crear el cobro:
--
-- 1. Stripe, PayPal y MercadoPago descuentan el saldo en el webhook, cuando la
--    pasarela confirma. Si en esa ventana el viajero gasto su saldo en otra
--    pestana, deduct_points_for_booking / update_wallet_balance lanzan, el
--    webhook solo lo loguea y la reserva se confirma con el descuento sin
--    pagar. TRG-E5BGCYW29XY (Stripe, 26-ago): 56,261 puntos aplicados, cobro
--    de 4,706.84 con el descuento, ningun 'redeemed'.
--
-- 2. Conekta y OpenPay NO descuentan el saldo en ningun momento: su webhook
--    confirma la reserva contando la billetera como pagada (cubreElAnticipo) y
--    nunca la cobra. TRG-ODURIADXQ2D (Conekta, 30-sep): 25,000 puntos + $300,
--    sin 'redeemed'; al cancelarse, el trigger le DEVOLVIO 25,000 puntos que
--    nunca se le quitaron. TRG-OQ13VAWCIKL (OpenPay): igual, sin 'redeemed'.
--
-- 3. Ese ultimo efecto es general: refund_points_for_cancellation devuelve
--    floor(points_used x pct) al cancelar, sin mirar si esos puntos se
--    descontaron alguna vez. Cancelar una reserva pendiente con puntos los
--    creaba de la nada.
--
-- 4. stripe-webhook, en checkout.session.expired y payment_intent.payment_failed,
--    acreditaba el Cash comprometido (`p_type: 'credit'`) aunque nunca se hubiera
--    debitado: creaba Cash de la nada. (Hoy no hay filas 'booking_refund'; el
--    codigo lo permitia.) Se quita en la Edge Function, en este mismo PR.
--
-- ============================================================================
-- EL ARREGLO
-- ============================================================================
--
-- apartar_saldo_de_reserva: al crear el cobro, ANTES de abrir la pasarela, se
-- descuentan los puntos y el Cash con las MISMAS llaves que usan los webhooks
-- (deduct_points_for_booking no repite un canje de la misma reserva;
-- update_wallet_balance repite la llave `<id>_charge_booking`). Asi el descuento
-- del webhook, donde existe, se vuelve un no-op, y donde no existe (Conekta,
-- OpenPay) ya no hace falta. Si el saldo no alcanza, el cobro no se crea. Los
-- montos apartados se guardan en la reserva: Stripe aplica los que manda la
-- peticion, que no siempre coinciden con points_used / toursred_cash_used.
--
-- liberar_saldo_apartado (trigger): si la reserva muere SIN pagarse (pasa a
-- 'cancelled' o se borra, como hace auto_cleanup_garbage_bookings con las
-- pendientes de mas de 3 dias), devuelve exactamente lo apartado, puntos como
-- puntos y Cash como Cash. Cubre de una vez todos los caminos que matan una
-- reserva pendiente: el expired de Stripe, expire_unpaid_approved_bookings, el
-- retiro sin pago del viajero y la limpieza diaria.
--
-- El movimiento de puntos de la liberacion es un 'refund' con reference_type
-- 'booking': es justo la guardia de refund_points_for_cancellation, asi que el
-- trigger viejo ya no devuelve otra vez lo mismo.
--
-- refund_points_for_cancellation: nunca devuelve mas puntos de los que se
-- descontaron ('redeemed') para la reserva. Cierra el hueco 3 para las reservas
-- que nunca pasaron por el apartado.

-- ============================================================================
-- 1. COLUMNAS
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS saldo_apartado_en timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_apartado_puntos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_apartado_cash numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_liberado_en timestamptz;

COMMENT ON COLUMN public.bookings.saldo_apartado_en IS
  'Cuando se apartaron (descontaron) los puntos y el Cash al crear el cobro con pasarela. NULL = nada apartado.';
COMMENT ON COLUMN public.bookings.saldo_liberado_en IS
  'Cuando se devolvio lo apartado porque la reserva murio sin pagarse.';

-- ============================================================================
-- 2. APARTAR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apartar_saldo_de_reserva(
  p_booking_id uuid,
  p_puntos integer DEFAULT NULL,
  p_cash numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b      record;
  v_puntos integer;
  v_cash   numeric;
BEGIN
  SELECT id, user_id, status, payment_status, booking_code,
         COALESCE(points_used, 0) AS points_used,
         COALESCE(toursred_cash_used, 0) AS toursred_cash_used,
         saldo_apartado_en, saldo_apartado_puntos, saldo_apartado_cash, saldo_liberado_en
    INTO v_b
    FROM bookings WHERE id = p_booking_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  -- NULL = lo comprometido en la reserva (PayPal, MercadoPago, Conekta, OpenPay
  -- cobran amount_due_now, que ya lo descuenta). Stripe manda lo que aplica.
  v_puntos := GREATEST(0, COALESCE(p_puntos, v_b.points_used));
  v_cash   := GREATEST(0, round(COALESCE(p_cash, v_b.toursred_cash_used), 2));

  IF v_b.payment_status = 'succeeded' OR (v_puntos = 0 AND v_cash = 0) THEN
    RETURN jsonb_build_object('apartado', false);
  END IF;
  IF v_b.status = 'cancelled' OR v_b.saldo_liberado_en IS NOT NULL THEN
    RAISE EXCEPTION 'La reserva % ya no esta activa', COALESCE(v_b.booking_code, p_booking_id::text);
  END IF;

  IF v_b.saldo_apartado_en IS NOT NULL THEN
    -- Reintento del mismo cobro: no se vuelve a descontar.
    IF v_b.saldo_apartado_puntos = v_puntos AND v_b.saldo_apartado_cash = v_cash THEN
      RETURN jsonb_build_object('apartado', true, 'ya_estaba', true, 'puntos', v_puntos, 'cash', v_cash);
    END IF;
    RAISE EXCEPTION 'La reserva % ya tiene saldo apartado con otros montos (% pts, $%)',
      COALESCE(v_b.booking_code, p_booking_id::text), v_b.saldo_apartado_puntos, v_b.saldo_apartado_cash;
  END IF;

  -- Las mismas llaves que los webhooks: su descuento posterior es un no-op.
  -- Cualquiera de las dos que no alcance revierte las dos.
  IF v_puntos > 0 THEN
    PERFORM public.deduct_points_for_booking(p_booking_id, v_puntos);
  END IF;
  IF v_cash > 0 THEN
    PERFORM public.update_wallet_balance(
      v_b.user_id, -v_cash, 'debit'::toursred_cash_transaction_type,
      'Saldo aplicado a la reserva ' || COALESCE(v_b.booking_code, p_booking_id::text),
      p_booking_id, 'booking', p_booking_id::text || '_charge_booking'
    );
  END IF;

  UPDATE bookings
     SET saldo_apartado_en = now(),
         saldo_apartado_puntos = v_puntos,
         saldo_apartado_cash = v_cash
   WHERE id = p_booking_id;

  RETURN jsonb_build_object('apartado', true, 'ya_estaba', false, 'puntos', v_puntos, 'cash', v_cash);
END;
$function$;

REVOKE ALL ON FUNCTION public.apartar_saldo_de_reserva(uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartar_saldo_de_reserva(uuid, integer, numeric) TO service_role;

-- ============================================================================
-- 3. LIBERAR (trigger)
-- ============================================================================
--
-- BEFORE: marca saldo_liberado_en en la misma fila sin un UPDATE recursivo, y
-- el 'refund'/'booking' de puntos queda escrito antes de que corra el trigger
-- AFTER de refund_points_for_cancellation (que lo ve y no repite).

CREATE OR REPLACE FUNCTION public.liberar_saldo_apartado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fila record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_fila := OLD;
  ELSE
    v_fila := NEW;
    -- Solo al pasar a 'cancelled', y solo si NUNCA estuvo pagada: stripe-webhook
    -- marca 'cancelled'/'failed' en payment_intent.payment_failed sin mirar si
    -- la reserva ya se habia pagado (eventos en desorden). Con mirar solo NEW
    -- se devolveria el saldo de una reserva pagada.
    IF NOT (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
       OR OLD.payment_status = 'succeeded' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_fila.saldo_apartado_en IS NOT NULL
     AND v_fila.saldo_liberado_en IS NULL
     AND v_fila.payment_status IS DISTINCT FROM 'succeeded'
     AND (v_fila.saldo_apartado_puntos > 0 OR v_fila.saldo_apartado_cash > 0) THEN
    PERFORM public.reembolsar_saldo_y_puntos(
      v_fila.user_id,
      v_fila.saldo_apartado_cash,
      v_fila.saldo_apartado_puntos,
      0,
      v_fila.id,
      'booking',
      'booking_hold_release',
      'Reserva ' || COALESCE(v_fila.booking_code, v_fila.id::text) || ' sin pagar: se devuelve el saldo apartado',
      v_fila.id::text || '_release_hold'
    );
    IF TG_OP = 'UPDATE' THEN
      NEW.saldo_liberado_en := now();
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.liberar_saldo_apartado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_liberar_saldo_apartado ON public.bookings;
CREATE TRIGGER trg_liberar_saldo_apartado
  BEFORE UPDATE OF status OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.liberar_saldo_apartado();

-- ============================================================================
-- 4. refund_points_for_cancellation: nunca mas de lo descontado
-- ============================================================================
--
-- Copiada de pg_get_functiondef el 16-oct-2026. Cambia solo el tope marcado.

CREATE OR REPLACE FUNCTION public.refund_points_for_cancellation(p_booking_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_id uuid;
v_wallet_id uuid;
v_points_used integer;
v_pct numeric;
v_points_to_refund integer;
v_new_balance integer;
v_descontados integer;
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

-- Derive user_id, points_used y el porcentaje que decidio la cancelacion
SELECT user_id, points_used, cancellation_points_refund_pct
INTO v_user_id, v_points_used, v_pct
FROM bookings
WHERE id = p_booking_id;

IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;

-- Authenticated callers may only operate on their own booking
IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

-- Solo los puntos que no consumieron las cancelaciones parciales, al
-- porcentaje de la politica: floor(restantes x porcentaje). NULL = 100%.
v_points_used := greatest(0, coalesce(v_points_used, 0) - (public.consumido_por_parciales(p_booking_id)).puntos);
v_points_to_refund := (public.reembolso_por_medio(0, v_points_used, v_pct, true)).puntos;

-- Tope (16-oct-2026): nunca mas de lo que de verdad se desconto para esta
-- reserva. Sin esto, una reserva cuyos puntos nunca se cobraron (pendiente, o
-- pagada con Conekta/OpenPay antes del apartado) recibia puntos de la nada.
SELECT coalesce(sum(-amount), 0)::integer INTO v_descontados
FROM toursred_points_transactions
WHERE reference_id = p_booking_id
AND type = 'redeemed'
AND reference_type = 'booking';
v_points_to_refund := least(coalesce(v_points_to_refund, 0), greatest(0, v_descontados));

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
$function$;
