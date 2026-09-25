-- ============================================================================
-- El reembolso de una cancelacion se devuelve en la moneda en que se pago.
--
-- QUE ESTABA PASANDO
--
-- Dos defectos que se sumaban, encontrados el 25-sep-2026 por Axel al
-- cancelar una reserva pagada mitad con ToursRed Points y mitad con ToursRed
-- Cash (e9d561b7: $250 en Cash + 25,000 puntos = $250):
--
--   1. El Cash se calculaba sobre TODO lo pagado, puntos incluidos. Las Edge
--      Functions pasan a `process_cancellation_refund` un monto construido
--      desde `deposit_amount`, que incluye el valor de los puntos. Resultado:
--      $500 en Cash por una reserva en la que se pagaron $250 en Cash.
--
--   2. El trigger `trg_auto_refund_points_on_cancellation` devolvia SIEMPRE
--      el 100% de `points_used`, sin importar la politica. En una cancelacion
--      `no_refund` (7d8ff718, 21:48) se devolvieron $0 de Cash y los 25,000
--      puntos completos.
--
-- Juntos: la cancelacion al 100% devolvio $500 de Cash MAS los 25,000 puntos,
-- $250 mas de lo pagado. Datos de prueba; lo que importa es que el codigo no
-- vuelva a hacerlo con dinero real.
--
-- LA REGLA (decidida por Axel el 25-sep-2026)
--
--   - Cada medio se devuelve en su moneda y con el MISMO porcentaje que la
--     politica aplica al principal: puntos -> puntos, dinero -> ToursRed Cash.
--   - Cancelaciones que no son culpa del viajero: 100% en su moneda.
--   - Puntos parciales: se redondea hacia abajo.
--   - 100 puntos = $1 MXN (misma conversion que deduct_points_for_booking).
--
-- COMO SE APLICA
--
-- `reembolso_por_medio()` es la regla, pura y con ASSERT abajo. La usan:
--   - `process_cancellation_refund`, que ahora recibe `p_porcentaje_puntos`
--     (default 1) y `p_monto_incluye_puntos` (default true): resta del Cash
--     el valor de los puntos a ese porcentaje y guarda el porcentaje en la
--     reserva, en el mismo UPDATE que la cancela.
--   - `refund_points_for_cancellation`, que ahora devuelve
--     floor(points_used x porcentaje guardado) en vez del 100% fijo.
--
-- Los defaults son los correctos para todo camino que devuelve el 100% a
-- partir de `deposit_amount` (agencia, tour cancelado, slot receptivo, plan de
-- pagos vencido, admin): esos quedan bien sin tocar su codigo. Las
-- cancelaciones directas que no pasan por la RPC no guardan porcentaje, y el
-- trigger usa 100%, que es lo que corresponde a todas ellas.
--
-- `process_cancellation_refund` cambia de firma, asi que se BORRA la vieja:
-- dejar las dos haria que PostgREST no pudiera elegir entre sobrecargas con
-- defaults. Se conservan los permisos: solo service_role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La regla
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reembolso_por_medio(
  p_monto numeric,
  p_puntos_usados integer,
  p_porcentaje numeric,
  p_monto_incluye_puntos boolean DEFAULT true,
  OUT cash numeric,
  OUT puntos integer
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_pct    numeric := least(1, greatest(0, coalesce(p_porcentaje, 1)));
  v_puntos integer := greatest(0, coalesce(p_puntos_usados, 0));
BEGIN
  puntos := floor(v_puntos * v_pct)::integer;

  IF coalesce(p_monto_incluye_puntos, true) THEN
    -- El monto se calculo sobre un principal que incluye el valor de los
    -- puntos: se resta esa parte, al mismo porcentaje.
    cash := greatest(0, round(coalesce(p_monto, 0) - v_pct * v_puntos / 100.0, 2));
  ELSE
    cash := greatest(0, round(coalesce(p_monto, 0), 2));
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.reembolso_por_medio(numeric, integer, numeric, boolean) IS
  'Reparte un reembolso por medio de pago: puntos = floor(points_used x %), cash = monto - % x points_used/100 (si el monto incluye el valor de los puntos). 100 pts = $1 MXN.';

REVOKE ALL ON FUNCTION public.reembolso_por_medio(numeric, integer, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reembolso_por_medio(numeric, integer, numeric, boolean) TO service_role;

DO $$
DECLARE r record;
BEGIN
  -- El caso de Axel: 100%, mitad puntos mitad Cash.
  r := public.reembolso_por_medio(500, 25000, 1, true);
  ASSERT r.cash = 250 AND r.puntos = 25000, format('100%%: %s / %s', r.cash, r.puntos);

  -- 50%: la mitad de cada cosa.
  r := public.reembolso_por_medio(250, 25000, 0.5, true);
  ASSERT r.cash = 125 AND r.puntos = 12500, format('50%%: %s / %s', r.cash, r.puntos);

  -- no_refund: nada de nada.
  r := public.reembolso_por_medio(0, 25000, 0, true);
  ASSERT r.cash = 0 AND r.puntos = 0, format('no_refund: %s / %s', r.cash, r.puntos);

  -- no_refund con opcionales reembolsables: esos si vuelven, en Cash.
  r := public.reembolso_por_medio(50, 25000, 0, true);
  ASSERT r.cash = 50 AND r.puntos = 0, format('opcionales: %s / %s', r.cash, r.puntos);

  -- Sin puntos: igual que antes.
  r := public.reembolso_por_medio(500, 0, 1, true);
  ASSERT r.cash = 500 AND r.puntos = 0, format('sin puntos: %s / %s', r.cash, r.puntos);

  -- Monto que NO incluye puntos (pago no completado): no se resta nada.
  r := public.reembolso_por_medio(250, 25000, 1, false);
  ASSERT r.cash = 250 AND r.puntos = 25000, format('sin incluir: %s / %s', r.cash, r.puntos);

  -- Nunca negativo.
  r := public.reembolso_por_medio(100, 25000, 1, true);
  ASSERT r.cash = 0 AND r.puntos = 25000, format('tope en cero: %s / %s', r.cash, r.puntos);

  -- Puntos impares al 50%: hacia abajo.
  r := public.reembolso_por_medio(250.01, 25001, 0.5, true);
  ASSERT r.puntos = 12500, format('redondeo puntos: %s', r.puntos);

  -- Porcentaje nulo = 100%; fuera de rango se acota.
  r := public.reembolso_por_medio(500, 25000, NULL, true);
  ASSERT r.cash = 250 AND r.puntos = 25000, 'porcentaje nulo = 100%';
  r := public.reembolso_por_medio(500, 25000, 1.5, true);
  ASSERT r.cash = 250 AND r.puntos = 25000, 'porcentaje > 1 se acota';
  r := public.reembolso_por_medio(500, NULL, 1, true);
  ASSERT r.cash = 500 AND r.puntos = 0, 'points_used nulo';
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. El porcentaje que se aplico queda en la reserva
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_points_refund_pct numeric
  CHECK (cancellation_points_refund_pct IS NULL OR cancellation_points_refund_pct BETWEEN 0 AND 1);

COMMENT ON COLUMN public.bookings.cancellation_points_refund_pct IS
  'Porcentaje (0-1) de points_used que se devuelve al cancelar. Lo escribe process_cancellation_refund; NULL = 100% (cancelaciones que no pasan por la RPC).';

-- ----------------------------------------------------------------------------
-- 3. Los puntos se devuelven al porcentaje de la politica, no al 100% fijo
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

-- Misma regla que el Cash: floor(points_used x porcentaje). NULL = 100%.
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
-- 4. process_cancellation_refund: el Cash sin el valor de los puntos
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric);

CREATE FUNCTION public.process_cancellation_refund(
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
v_reparto := public.reembolso_por_medio(p_refund_amount, v_points_used, v_pct, p_monto_incluye_puntos);
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
  ELSE (public.reembolso_por_medio(p_cancellation_refund_amount, v_points_used, v_pct, p_monto_incluye_puntos)).cash
END
WHERE id = p_booking_id;

-- Step 5: Return result
RETURN json_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_status', v_current_status,
'cash_refunded', v_cash,
'points_refunded', v_reparto.puntos
);
END;
$function$;

REVOKE ALL ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric, numeric, boolean) TO service_role;
