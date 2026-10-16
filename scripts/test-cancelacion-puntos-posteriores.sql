-- Prueba de `20261016051525_cancelacion_devuelve_puntos_de_cargos_posteriores.sql`.
--
-- Cancelar la reserva completa devolvia en Cash lo pagado con puntos DESPUES de
-- reservar (extras, seguro, abonos). process_cancellation_refund recibe ahora
-- p_puntos_cargos_posteriores: los puntos ya incluidos en el monto, que salen
-- del Cash y regresan como puntos.
--
-- Arma el esquema con test-puntos-tope-50-y-pago-mixto.sql (que aplica
-- 20261016042518, de donde sale reembolsar_saldo_y_puntos) y agrega lo que usa
-- la cancelacion, copiado de pg_get_functiondef el 16-oct-2026:
-- reembolso_por_medio, consumido_por_parciales, refund_points_for_cancellation
-- y su trigger. El trigger importa: devuelve los puntos de la RESERVA y usa como
-- guardia un 'refund' con reference_type 'booking'; si el movimiento nuevo
-- usara esa referencia, el trigger se saltaria los de la reserva.
--
-- QUE SE PRUEBA
--   A. Seguro pagado con puntos, cancelacion al 100%: el Cash pierde esos
--      puntos y los puntos regresan; el trigger devuelve aparte los de la reserva.
--   B. Abono pagado con puntos al 50% de la politica.
--   C. Sin el parametro (los llamadores que no tienen cargos posteriores):
--      exactamente como antes.
--   D. Con p_monto_incluye_puntos = false (solo devuelve Cash comprometido): el
--      parametro se ignora.
--
--   psql -f scripts/test-cancelacion-puntos-posteriores.sql

\ir test-puntos-tope-50-y-pago-mixto.sql

\set ON_ERROR_STOP on
\set QUIET on

ALTER TABLE bookings
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_type text,
  ADD COLUMN cancellation_points_refund_pct numeric,
  ADD COLUMN cancellation_refund_amount numeric;
ALTER TABLE toursred_cash_wallets ADD COLUMN currency text;
ALTER TABLE toursred_cash_wallets ADD CONSTRAINT toursred_cash_wallets_user_id_key UNIQUE (user_id);

CREATE TABLE booking_partial_cancellations (booking_id uuid, original_partial_amount numeric, points_share integer);

-- VIGENTES el 16-oct-2026 (pg_get_functiondef), sin cambios.
CREATE FUNCTION public.reembolso_por_medio(p_monto numeric, p_puntos_usados integer, p_porcentaje numeric, p_monto_incluye_puntos boolean DEFAULT true, OUT cash numeric, OUT puntos integer)
 RETURNS record LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_pct    numeric := least(1, greatest(0, coalesce(p_porcentaje, 1)));
  v_puntos integer := greatest(0, coalesce(p_puntos_usados, 0));
BEGIN
  puntos := floor(v_puntos * v_pct)::integer;
  IF coalesce(p_monto_incluye_puntos, true) THEN
    cash := greatest(0, round(coalesce(p_monto, 0) - v_pct * v_puntos / 100.0, 2));
  ELSE
    cash := greatest(0, round(coalesce(p_monto, 0), 2));
  END IF;
END;
$function$;

CREATE FUNCTION public.consumido_por_parciales(p_booking_id uuid, OUT principal numeric, OUT puntos integer)
 RETURNS record LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT coalesce(sum(original_partial_amount), 0), coalesce(sum(points_share), 0)::integer
  FROM public.booking_partial_cancellations
  WHERE booking_id = p_booking_id;
$function$;

CREATE FUNCTION public.refund_points_for_cancellation(p_booking_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_user_id uuid;
v_wallet_id uuid;
v_points_used integer;
v_pct numeric;
v_points_to_refund integer;
v_new_balance integer;
BEGIN
IF EXISTS (
SELECT 1 FROM toursred_points_transactions
WHERE reference_id = p_booking_id
AND type = 'refund'
AND reference_type = 'booking'
) THEN
RETURN 0;
END IF;
SELECT user_id, points_used, cancellation_points_refund_pct
INTO v_user_id, v_points_used, v_pct
FROM bookings
WHERE id = p_booking_id;
IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;
IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;
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

CREATE FUNCTION public.auto_refund_points_on_cancellation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE TRIGGER trg_auto_refund_points_on_cancellation AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION auto_refund_points_on_cancellation();

-- La firma VIGENTE, para que el DROP de la migracion tenga algo que borrar.
CREATE FUNCTION public.process_cancellation_refund(p_booking_id uuid, p_refund_amount numeric DEFAULT 0, p_reference_type text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_new_status text DEFAULT 'cancelled'::text, p_set_cancelled_at boolean DEFAULT true, p_cancellation_type text DEFAULT NULL::text, p_cancellation_refund_amount numeric DEFAULT NULL::numeric, p_porcentaje_puntos numeric DEFAULT 1, p_monto_incluye_puntos boolean DEFAULT true)
 RETURNS json LANGUAGE sql AS $$ SELECT '{}'::json $$;

\ir ../supabase/migrations/20261016051525_cancelacion_devuelve_puntos_de_cargos_posteriores.sql

-- ---------------------------------------------------------------------------
-- Un viajero nuevo por caso: saldos en cero, sin ruido de las otras pruebas.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.viajero(n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO users (id) VALUES (u);
  INSERT INTO toursred_cash_wallets (user_id, balance) VALUES (u, 0);
  INSERT INTO toursred_points_wallets (user_id, balance) VALUES (u, 0);
  RETURN u;
END $$;

CREATE FUNCTION pg_temp.reserva(n int, u uuid, deposito numeric, puntos int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b uuid := ('00000000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO bookings (id, user_id, booking_code, deposit_amount, service_charge, points_used, payment_status, status)
  VALUES (b, u, 'TRG-C' || n, deposito, 0, puntos, 'succeeded', 'confirmed');
  RETURN b;
END $$;

DO $$
DECLARE u uuid; b uuid; r json; v_post int; v_res int;
BEGIN
  -- A. Anticipo $1000 (20,000 pts de la reserva = $200) + seguro $300 comprado
  --    despues con 15,000 pts ($150). Cancelacion al 100%: el llamador devuelve
  --    1000 + 300 e informa los 15,000 puntos del seguro.
  u := pg_temp.viajero(1);
  b := pg_temp.reserva(1, u, 1000, 20000);
  r := process_cancellation_refund(p_booking_id => b, p_refund_amount => 1300, p_reference_type => 'traveler_cancellation',
         p_description => 'Cancelacion', p_porcentaje_puntos => 1, p_puntos_cargos_posteriores => 15000);
  IF pg_temp.cash(u::text) <> 950 THEN
    RAISE EXCEPTION 'A: Cash esperado 950 (1300 - 150 del seguro - 200 de la reserva), hay %', pg_temp.cash(u::text);
  END IF;
  SELECT coalesce(sum(amount), 0) INTO v_post FROM toursred_points_transactions
   WHERE reference_id = b AND type = 'refund' AND reference_type = 'post_booking_extra';
  SELECT coalesce(sum(amount), 0) INTO v_res FROM toursred_points_transactions
   WHERE reference_id = b AND type = 'refund' AND reference_type = 'booking';
  IF v_post <> 15000 OR v_res <> 20000 OR pg_temp.pts(u::text) <> 35000 THEN
    RAISE EXCEPTION 'A: puntos esperados 15000 (cargos) + 20000 (reserva, por el trigger) = 35000; hay % + % = %', v_post, v_res, pg_temp.pts(u::text);
  END IF;
  IF (r->>'points_post_booking_refunded')::int <> 15000 THEN
    RAISE EXCEPTION 'A: el resultado no informa los puntos de cargos posteriores: %', r;
  END IF;
  IF (SELECT cancellation_refund_amount FROM bookings WHERE id = b) <> 950 THEN
    RAISE EXCEPTION 'A: cancellation_refund_amount deberia registrar el Cash (950), registra %', (SELECT cancellation_refund_amount FROM bookings WHERE id = b);
  END IF;

  -- B. Principal $1500 (anticipo 1000 con 20,000 pts + abono 500 con 10,000 pts)
  --    al 50%: el llamador devuelve 750 e informa floor(10000 * 0.5) = 5000.
  --    Cash = 750 - 50 (abono) - 0.5 * 200 (reserva) = 600.
  u := pg_temp.viajero(2);
  b := pg_temp.reserva(2, u, 1000, 20000);
  PERFORM process_cancellation_refund(p_booking_id => b, p_refund_amount => 750, p_reference_type => 'traveler_cancellation',
         p_description => 'Cancelacion', p_porcentaje_puntos => 0.5, p_puntos_cargos_posteriores => 5000);
  IF pg_temp.cash(u::text) <> 600 OR pg_temp.pts(u::text) <> 15000 THEN
    RAISE EXCEPTION 'B: esperaba Cash 600 y 15000 pts (10000 reserva + 5000 abono), hay % y %', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;

  -- C. Sin el parametro: como antes (Cash 1000 - 200, puntos de la reserva).
  u := pg_temp.viajero(3);
  b := pg_temp.reserva(3, u, 1000, 20000);
  PERFORM process_cancellation_refund(p_booking_id => b, p_refund_amount => 1000, p_reference_type => 'agency_booking_cancellation',
         p_description => 'Cancelacion');
  IF pg_temp.cash(u::text) <> 800 OR pg_temp.pts(u::text) <> 20000 THEN
    RAISE EXCEPTION 'C: sin cargos posteriores esperaba Cash 800 y 20000 pts, hay % y %', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;
  IF EXISTS (SELECT 1 FROM toursred_points_transactions WHERE reference_id = b AND reference_type = 'post_booking_extra') THEN
    RAISE EXCEPTION 'C: sin el parametro no debe haber movimiento de cargos posteriores';
  END IF;

  -- D. p_monto_incluye_puntos = false: el monto es Cash comprometido y el
  --    parametro no aplica.
  u := pg_temp.viajero(4);
  b := pg_temp.reserva(4, u, 1000, 0);
  PERFORM process_cancellation_refund(p_booking_id => b, p_refund_amount => 300, p_reference_type => 'payment_cancellation',
         p_description => 'Cancelacion', p_monto_incluye_puntos => false, p_puntos_cargos_posteriores => 5000);
  IF pg_temp.cash(u::text) <> 300 OR pg_temp.pts(u::text) <> 0 THEN
    RAISE EXCEPTION 'D: con p_monto_incluye_puntos = false esperaba Cash 300 y 0 pts, hay % y %', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;
END $$;

\echo 'cancelacion completa: puntos de cargos posteriores regresan como puntos, 4 casos OK'
