-- ============================================================================
-- Cancelacion parcial: cada medio en su moneda, y la total ya no devuelve lo
-- que la parcial ya devolvio.
--
-- QUE ESTABA PASANDO (encontrado el 25-sep-2026, reserva de prueba c33f7538)
--
--   1. `process-partial-cancellation` acreditaba en Cash toda la parte del
--      anticipo de los viajeros cancelados, incluida la que se pago con
--      puntos, y los puntos nunca volvian. En c33f7538 (tarjeta + 7,883
--      puntos) la parcial al 100% devolvio $5,544.50 en Cash; ~6,569 de esos
--      puntos se convirtieron en dinero.
--
--   2. La parcial no reduce `deposit_amount`, y ninguna cancelacion total
--      restaba lo que ya habian devuelto las parciales: cancelar despues la
--      reserva completa volvia a devolver la parte de los viajeros ya
--      cancelados. `deposit_amount` no se toca a proposito (lo usan la
--      contabilidad y los reportes): lo consumido se lee de
--      `booking_partial_cancellations`.
--
-- (El tercer defecto, que la parcial usaba dias fijos y no la politica del
-- tour, se arregla en TypeScript: _shared/politicaCancelacion.ts.)
--
-- COMO SE APLICA
--
--   - `reparto_parcial()` es la regla, pura y con ASSERT: la parte de los
--     puntos que corresponde a los viajeros cancelados es
--     floor(points_used x parte / principal), y sobre ella se aplica
--     `reembolso_por_medio()` (migracion 20260925230000).
--   - `procesar_reembolso_parcial()` acredita Cash y puntos en una sola
--     transaccion, idempotente por cancelacion parcial.
--   - `booking_partial_cancellations` guarda `points_share` (puntos que
--     correspondian a esos viajeros, se devuelvan o no) y `points_refunded`.
--   - `process_cancellation_refund` y `refund_points_for_cancellation`
--     descuentan lo ya consumido por parciales: principal (suma de
--     `original_partial_amount`) y puntos (suma de `points_share`), al mismo
--     porcentaje de la politica.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lo que la parcial consume queda registrado
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking_partial_cancellations
  ADD COLUMN IF NOT EXISTS points_share integer NOT NULL DEFAULT 0 CHECK (points_share >= 0),
  ADD COLUMN IF NOT EXISTS points_refunded integer NOT NULL DEFAULT 0 CHECK (points_refunded >= 0);

COMMENT ON COLUMN public.booking_partial_cancellations.points_share IS
  'Puntos de la reserva que correspondian a los viajeros cancelados (se devuelvan o no). La cancelacion total los descuenta de points_used.';
COMMENT ON COLUMN public.booking_partial_cancellations.points_refunded IS
  'Puntos devueltos al viajero en esta cancelacion parcial: floor(points_share x porcentaje).';

-- ----------------------------------------------------------------------------
-- 2. La regla de la parcial
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparto_parcial(
  p_points_used integer,
  p_parte numeric,
  p_principal numeric,
  p_porcentaje numeric,
  p_extra_cash numeric DEFAULT 0,
  OUT points_share integer,
  OUT cash numeric,
  OUT puntos integer
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_pct numeric := least(1, greatest(0, coalesce(p_porcentaje, 1)));
  v_parte numeric := greatest(0, coalesce(p_parte, 0));
  v_reparto record;
BEGIN
  IF coalesce(p_principal, 0) > 0 THEN
    points_share := floor(greatest(0, coalesce(p_points_used, 0)) * least(1, v_parte / p_principal))::integer;
  ELSE
    points_share := 0;
  END IF;

  -- El bruto es la parte del principal al porcentaje, mas lo que no se pago
  -- con puntos (seguro). reembolso_por_medio le resta el valor de los puntos.
  v_reparto := public.reembolso_por_medio(v_parte * v_pct + coalesce(p_extra_cash, 0), points_share, v_pct, true);
  cash := v_reparto.cash;
  puntos := v_reparto.puntos;
END;
$function$;

COMMENT ON FUNCTION public.reparto_parcial(integer, numeric, numeric, numeric, numeric) IS
  'Reparto de una cancelacion parcial: points_share = floor(points_used x parte/principal); cash y puntos segun reembolso_por_medio sobre parte x % + extra.';

REVOKE ALL ON FUNCTION public.reparto_parcial(integer, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparto_parcial(integer, numeric, numeric, numeric, numeric) TO service_role;

DO $$
DECLARE r record;
BEGIN
  -- Mitad de los viajeros, reserva pagada mitad Cash ($250) y mitad puntos (25,000).
  r := public.reparto_parcial(25000, 250, 500, 1, 0);
  ASSERT r.points_share = 12500 AND r.cash = 125 AND r.puntos = 12500,
    format('mitad al 100%%: %s / %s / %s', r.points_share, r.cash, r.puntos);

  -- La misma parte al 50%.
  r := public.reparto_parcial(25000, 250, 500, 0.5, 0);
  ASSERT r.points_share = 12500 AND r.cash = 62.5 AND r.puntos = 6250,
    format('mitad al 50%%: %s / %s / %s', r.points_share, r.cash, r.puntos);

  -- Sin reembolso: los puntos de esos viajeros se consumen igual.
  r := public.reparto_parcial(25000, 250, 500, 0, 0);
  ASSERT r.points_share = 12500 AND r.cash = 0 AND r.puntos = 0,
    format('no_refund: %s / %s / %s', r.points_share, r.cash, r.puntos);

  -- El seguro va en Cash y no pierde nada por los puntos.
  r := public.reparto_parcial(25000, 250, 500, 1, 79);
  ASSERT r.cash = 204 AND r.puntos = 12500, format('con seguro: %s / %s', r.cash, r.puntos);

  -- Sin puntos: todo en Cash, como antes.
  r := public.reparto_parcial(0, 5149.5, 6179.4, 1, 395);
  ASSERT r.points_share = 0 AND r.cash = 5544.5 AND r.puntos = 0, format('sin puntos: %s / %s', r.cash, r.puntos);

  -- El caso de c33f7538: 7,883 puntos, parte 5,149.50 de 6,179.40.
  r := public.reparto_parcial(7883, 5149.5, 6179.4, 1, 395);
  ASSERT r.points_share = 6569 AND r.puntos = 6569 AND r.cash = 5478.81,
    format('c33f7538: %s / %s / %s', r.points_share, r.cash, r.puntos);

  -- Y la cancelacion TOTAL posterior de c33f7538 solo devuelve lo que queda:
  -- principal 6,179.40 - 5,149.50 = 1,029.90 y puntos 7,883 - 6,569 = 1,314.
  -- Es el calculo de process_cancellation_refund (seccion 6) con esos datos.
  r := public.reembolso_por_medio(greatest(0, 6179.4 - 1 * 5149.5), 7883 - 6569, 1, true);
  ASSERT r.cash = 1016.76 AND r.puntos = 1314,
    format('total tras parcial: %s / %s (antes devolvia 6,179.40 otra vez)', r.cash, r.puntos);

  -- Principal cero o parte mayor que el principal: no revienta ni excede.
  r := public.reparto_parcial(25000, 250, 0, 1, 0);
  ASSERT r.points_share = 0, 'principal cero';
  r := public.reparto_parcial(25000, 900, 500, 1, 0);
  ASSERT r.points_share = 25000, 'parte > principal se acota';
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. La parcial acredita Cash y puntos juntos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procesar_reembolso_parcial(
  p_booking_id uuid,
  p_partial_cancellation_id uuid,
  p_parte numeric,
  p_principal numeric,
  p_porcentaje numeric,
  p_extra_cash numeric DEFAULT 0,
  p_description text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_points_used integer;
  v_reparto record;
  v_wallet_result json;
  v_transaction_id uuid;
  v_points_wallet uuid;
  v_new_balance integer;
BEGIN
  SELECT user_id, points_used INTO v_user_id, v_points_used
  FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  v_reparto := public.reparto_parcial(v_points_used, p_parte, p_principal, p_porcentaje, p_extra_cash);

  IF v_reparto.cash > 0 THEN
    -- Misma llave de idempotencia que usaba la funcion: el id de la parcial.
    v_wallet_result := public.update_wallet_balance(
      p_user_id := v_user_id,
      p_amount := v_reparto.cash,
      p_type := 'refund'::toursred_cash_transaction_type,
      p_description := p_description,
      p_reference_id := p_booking_id,
      p_reference_type := 'booking_partial_cancellation',
      p_idempotency_key := p_partial_cancellation_id::text
    );
    v_transaction_id := (v_wallet_result ->> 'transaction_id')::uuid;
  END IF;

  -- Puntos: idempotente por cancelacion parcial. reference_type distinto de
  -- 'booking' para no disparar el guard de refund_points_for_cancellation.
  IF v_reparto.puntos > 0 AND NOT EXISTS (
    SELECT 1 FROM public.toursred_points_transactions
    WHERE reference_id = p_partial_cancellation_id AND type = 'refund'
      AND reference_type = 'booking_partial_cancellation'
  ) THEN
    SELECT id INTO v_points_wallet FROM public.toursred_points_wallets WHERE user_id = v_user_id;
    IF v_points_wallet IS NULL THEN
      RAISE EXCEPTION 'No se encontró la billetera de puntos';
    END IF;

    UPDATE public.toursred_points_wallets
    SET balance = balance + v_reparto.puntos,
        total_used = GREATEST(0, total_used - v_reparto.puntos),
        updated_at = now()
    WHERE id = v_points_wallet
    RETURNING balance INTO v_new_balance;

    INSERT INTO public.toursred_points_transactions (
      wallet_id, user_id, amount, balance_after, type,
      description, reference_id, reference_type
    ) VALUES (
      v_points_wallet, v_user_id, v_reparto.puntos, v_new_balance, 'refund',
      'Reembolso de puntos por cancelacion parcial', p_partial_cancellation_id, 'booking_partial_cancellation'
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'cash_refunded', v_reparto.cash,
    'points_refunded', v_reparto.puntos,
    'points_share', v_reparto.points_share
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.procesar_reembolso_parcial(uuid, uuid, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.procesar_reembolso_parcial(uuid, uuid, numeric, numeric, numeric, numeric, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Lo que las parciales ya consumieron, en un solo lugar
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consumido_por_parciales(
  p_booking_id uuid,
  OUT principal numeric,
  OUT puntos integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(sum(original_partial_amount), 0), coalesce(sum(points_share), 0)::integer
  FROM public.booking_partial_cancellations
  WHERE booking_id = p_booking_id;
$function$;

REVOKE ALL ON FUNCTION public.consumido_por_parciales(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumido_por_parciales(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. refund_points_for_cancellation: solo los puntos que no consumieron parciales
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 6. process_cancellation_refund: descuenta lo consumido por parciales
-- ----------------------------------------------------------------------------
-- Misma firma que 20260925230000: CREATE OR REPLACE conserva los permisos.
CREATE OR REPLACE FUNCTION public.process_cancellation_refund(
  p_booking_id uuid,
  p_refund_amount numeric DEFAULT 0,
  p_reference_type text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_new_status text DEFAULT 'cancelled'::text,
  p_set_cancelled_at boolean DEFAULT true,
  p_cancellation_type text DEFAULT NULL::text,
  p_cancellation_refund_amount numeric DEFAULT NULL::numeric,
  p_porcentaje_puntos numeric DEFAULT 1,
  p_monto_incluye_puntos boolean DEFAULT true
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking_id uuid;
v_current_status text;
v_cancelled_at timestamptz;
v_user_id uuid;
v_points_used integer;
v_pct numeric := least(1, greatest(0, coalesce(p_porcentaje_puntos, 1)));
v_reparto record;
v_consumido record;
v_bruto numeric;
v_cash numeric;
v_wallet_id uuid;
v_wallet_result json;
v_transaction_id uuid;
BEGIN
-- Step 1: Lock the booking row FOR UPDATE (held for the entire transaction)
SELECT id, status, cancelled_at, user_id, points_used
INTO v_booking_id, v_current_status, v_cancelled_at, v_user_id, v_points_used
FROM public.bookings
WHERE id = p_booking_id
FOR UPDATE;

IF v_booking_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;

-- Step 2: Reject only terminal states — allow 'cancellation_processing' to advance
IF v_current_status = 'cancelled' OR v_cancelled_at IS NOT NULL THEN
RAISE EXCEPTION 'La reserva ya fue cancelada';
END IF;

-- Step 2b: cada medio en su moneda. El Cash pierde la parte que se pago con
-- puntos (al mismo porcentaje); esos puntos los devuelve el trigger de
-- bookings leyendo cancellation_points_refund_pct (Step 4).
-- Step 2c: lo que ya consumieron las cancelaciones parciales no se vuelve a
-- devolver. El monto de los llamadores sale de deposit_amount, que la parcial
-- no reduce: se le resta el principal consumido al mismo porcentaje, y los
-- puntos consumidos salen de points_used.
v_consumido := public.consumido_por_parciales(p_booking_id);
v_points_used := greatest(0, coalesce(v_points_used, 0) - v_consumido.puntos);
v_bruto := CASE WHEN p_monto_incluye_puntos
  THEN greatest(0, coalesce(p_refund_amount, 0) - v_pct * v_consumido.principal)
  ELSE p_refund_amount END;

v_reparto := public.reembolso_por_medio(v_bruto, v_points_used, v_pct, p_monto_incluye_puntos);
v_cash := v_reparto.cash;

-- Step 3: Process wallet refund if amount > 0
IF v_cash > 0 AND v_user_id IS NOT NULL THEN
-- Ensure wallet exists (create if missing, same as edge function logic)
SELECT id INTO v_wallet_id
FROM public.toursred_cash_wallets
WHERE user_id = v_user_id AND is_active = true
LIMIT 1;

IF v_wallet_id IS NULL THEN
INSERT INTO public.toursred_cash_wallets (user_id, balance, currency, is_active)
VALUES (v_user_id, 0, 'MXN', true)
ON CONFLICT (user_id) DO NOTHING
RETURNING id INTO v_wallet_id;

IF v_wallet_id IS NULL THEN
SELECT id INTO v_wallet_id
FROM public.toursred_cash_wallets
WHERE user_id = v_user_id AND is_active = true
LIMIT 1;
END IF;
END IF;

IF v_wallet_id IS NULL THEN
RAISE EXCEPTION 'No se pudo obtener ni crear el wallet del usuario';
END IF;

-- Nested call to update_wallet_balance (same transaction, same row lock scope)
-- Idempotency key prevents double-refund if the edge function is retried
v_wallet_result := public.update_wallet_balance(
p_user_id := v_user_id,
p_amount := v_cash,
p_type := 'refund'::toursred_cash_transaction_type,
p_description := p_description,
p_reference_id := p_booking_id,
p_reference_type := p_reference_type,
p_idempotency_key := p_booking_id || '_refund_' || COALESCE(p_reference_type, 'cancellation')
);

v_transaction_id := (v_wallet_result ->> 'transaction_id')::uuid;
END IF;

-- Step 4: Update booking status. El porcentaje va en el MISMO update: el
-- trigger AFTER UPDATE que devuelve los puntos lo lee de NEW.
UPDATE public.bookings
SET
status = p_new_status,
cancelled_at = CASE WHEN p_set_cancelled_at THEN now() ELSE NULL END,
cancellation_type = p_cancellation_type,
cancellation_points_refund_pct = v_pct,
cancellation_refund_amount = CASE
  WHEN p_cancellation_refund_amount IS NULL THEN NULL
  ELSE (public.reembolso_por_medio(
    CASE WHEN p_monto_incluye_puntos
      THEN greatest(0, p_cancellation_refund_amount - v_pct * v_consumido.principal)
      ELSE p_cancellation_refund_amount END,
    v_points_used, v_pct, p_monto_incluye_puntos)).cash
END
WHERE id = p_booking_id;

-- Step 5: Return result
RETURN json_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_status', v_current_status,
'cash_refunded', v_cash,
'points_refunded', v_reparto.puntos,
'principal_consumido_por_parciales', v_consumido.principal
);
END;
$function$;
