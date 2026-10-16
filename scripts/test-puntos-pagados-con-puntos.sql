-- Prueba de `20261016023158_puntos_ganados_por_pesos_pagados_con_puntos.sql`.
--
-- LA REGLA (Axel, 16-oct-2026): cada peso pagado genera un punto.
--   pasarela x1 | puntos (100 pts = $1) x1, nunca dobles | Cash x2 solo sin pasarela
--
-- Antes del fix, los pesos pagados con puntos daban 0 puntos en una reserva:
--   TRG-0E05WC6UZ7P  25,000 pts + $250 Stripe  -> 250  (debian 500)
--   TRG-IDBZH9ZXZHX  $250 Cash + 25,000 pts    -> 500  (debian 750)
--
-- QUE SE PRUEBA
--   1. ANTES: con la funcion vigente (copiada de pg_get_functiondef el 16-oct)
--      se reproducen los 250 y 500 de produccion. Se provoca, no se afirma.
--   2. DESPUES (la migracion real, con \ir): los mismos dos casos dan 500 y 750.
--   3. Pasarela sola, Cash solo, Cash + pasarela: no cambian.
--   4. Sin membresia activa: 0, como antes.
--   5. El trigger real dispara una sola vez y deja points_earned en la reserva.
--
--   psql -f scripts/test-puntos-pagados-con-puntos.sql

\set ON_ERROR_STOP on
\set QUIET on

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET search_path = public;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.bookings (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  payment_status     text NOT NULL DEFAULT 'pending',
  user_payment       numeric,
  toursred_cash_used numeric,
  points_used        integer,
  points_earned      integer DEFAULT 0
);

CREATE TABLE public.memberships (
  user_id            uuid,
  status             text,
  current_period_end timestamptz
);

CREATE TABLE public.toursred_points_wallets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid UNIQUE,
  balance      integer NOT NULL DEFAULT 0,
  total_earned integer NOT NULL DEFAULT 0,
  updated_at   timestamptz
);

CREATE TABLE public.toursred_points_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      uuid,
  user_id        uuid,
  amount         integer,
  balance_after  integer,
  type           text,
  description    text,
  reference_id   uuid,
  reference_type text,
  expires_at     timestamptz
);

CREATE FUNCTION public.get_or_create_points_wallet(p_user_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM toursred_points_wallets WHERE user_id = p_user_id;
  IF v_id IS NULL THEN
    INSERT INTO toursred_points_wallets (user_id) VALUES (p_user_id) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- Trigger y funcion VIGENTES el 16-oct-2026 (pg_get_functiondef), sin cambios.
CREATE FUNCTION public.auto_award_points_on_booking_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
$function$;

CREATE TRIGGER trg_auto_award_points_on_booking_completion
BEFORE UPDATE OF status, payment_status ON public.bookings
FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.payment_status IS DISTINCT FROM new.payment_status)))
EXECUTE FUNCTION auto_award_points_on_booking_completion();

CREATE FUNCTION public.award_points_for_booking(p_booking_id uuid, p_amount_to_pay numeric)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  IF p_amount_to_pay < 0 THEN
    RETURN 0;
  END IF;
  SELECT user_id, COALESCE(toursred_cash_used, 0), COALESCE(points_used, 0), COALESCE(user_payment, 0)
  INTO v_user_id, v_toursred_cash_used, v_points_used, v_user_payment
  FROM bookings WHERE id = p_booking_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = v_user_id AND status = 'active' AND current_period_end > now()
  ) INTO v_has_active_membership;
  IF NOT v_has_active_membership THEN
    RETURN 0;
  END IF;
  v_is_full_wallet := v_user_payment = 0 AND (v_toursred_cash_used > 0 OR v_points_used > 0);
  v_wallet_id := get_or_create_points_wallet(v_user_id);
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
  SET balance = balance + v_points_to_award, total_earned = total_earned + v_points_to_award, updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_new_balance;
  INSERT INTO toursred_points_transactions (
    wallet_id, user_id, amount, balance_after, type, description, reference_id, reference_type, expires_at
  ) VALUES (
    v_wallet_id, v_user_id, v_points_to_award, v_new_balance, 'earned', 'Puntos ganados por reserva completada',
    p_booking_id, 'booking', v_expires_at
  );
  RETURN v_points_to_award;
END;
$function$;

-- Un viajero con membresia y otro sin ella.
INSERT INTO memberships VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'active', now() + interval '30 days');

-- Crea la reserva pendiente, la confirma (dispara el trigger real) y devuelve
-- points_earned. Cada caso usa su propio id.
CREATE FUNCTION pg_temp.confirmar(p_id int, p_user uuid, p_pasarela numeric, p_cash numeric, p_puntos int)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_id uuid := ('00000000-0000-0000-0000-' || lpad(p_id::text, 12, '0'))::uuid; v_pe integer;
BEGIN
  INSERT INTO bookings (id, user_id, user_payment, toursred_cash_used, points_used)
  VALUES (v_id, p_user, p_pasarela, p_cash, p_puntos);
  UPDATE bookings SET status = 'confirmed', payment_status = 'succeeded' WHERE id = v_id;
  SELECT points_earned INTO v_pe FROM bookings WHERE id = v_id;
  RETURN v_pe;
END $$;

-- ---------------------------------------------------------------------------
-- 1. ANTES: se reproducen los numeros de produccion.
-- ---------------------------------------------------------------------------
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000a1';
BEGIN
  IF pg_temp.confirmar(1, u, 250, 0, 25000) IS DISTINCT FROM 250 THEN
    RAISE EXCEPTION 'ANTES: puntos + Stripe deberia reproducir 250, dio %', (SELECT points_earned FROM bookings WHERE id = '00000000-0000-0000-0000-000000000001');
  END IF;
  IF pg_temp.confirmar(2, u, 0, 250, 25000) IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'ANTES: Cash + puntos deberia reproducir 500, dio %', (SELECT points_earned FROM bookings WHERE id = '00000000-0000-0000-0000-000000000002');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2..5. La migracion REAL.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20261016023158_puntos_ganados_por_pesos_pagados_con_puntos.sql

DO $$
DECLARE
  u  uuid := '00000000-0000-0000-0000-0000000000a1';
  sm uuid := '00000000-0000-0000-0000-0000000000b2';
  r  record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- id, caso,                                  pasarela, cash, puntos, esperado
    (11, 'puntos + Stripe (TRG-0E05WC6UZ7P)',      250::numeric, 0::numeric,   25000, 500),
    (12, 'Cash + puntos (TRG-IDBZH9ZXZHX)',        0,            250,          25000, 750),
    (13, 'solo pasarela',                          500,          0,            0,     500),
    (14, 'solo Cash (doble)',                      0,            500,          0,     1000),
    (15, 'Cash + pasarela (sin doble)',            250,          250,          0,     500),
    (16, 'pasarela + Cash + puntos',               100,          150,          25000, 500),
    (17, 'centavos de puntos se truncan',          0,            100.50,       2550,  226)
  ) AS t(id, caso, pasarela, cash, puntos, esperado)
  LOOP
    IF pg_temp.confirmar(r.id, u, r.pasarela, r.cash, r.puntos) IS DISTINCT FROM r.esperado THEN
      RAISE EXCEPTION 'DESPUES, %: esperaba %, dio %', r.caso, r.esperado,
        (SELECT points_earned FROM bookings WHERE id = ('00000000-0000-0000-0000-' || lpad(r.id::text, 12, '0'))::uuid);
    END IF;
  END LOOP;

  -- 4. Sin membresia activa: nada.
  IF pg_temp.confirmar(21, sm, 250, 0, 25000) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'sin membresia deberia dar 0';
  END IF;

  -- 5. Una sola fila earned por reserva, y el monedero cuadra con las filas.
  IF EXISTS (SELECT 1 FROM toursred_points_transactions WHERE type = 'earned'
             GROUP BY reference_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'una reserva genero mas de una fila earned';
  END IF;
  IF (SELECT balance FROM toursred_points_wallets WHERE user_id = u)
     IS DISTINCT FROM (SELECT coalesce(sum(amount), 0) FROM toursred_points_transactions WHERE user_id = u) THEN
    RAISE EXCEPTION 'el saldo del monedero no cuadra con sus movimientos';
  END IF;
END $$;

\echo 'puntos pagados con puntos: ANTES reproducido (250/500), DESPUES 9 casos OK'
