-- Prueba de `20261016054040_apartar_saldo_al_crear_el_cobro.sql`.
--
-- Arma el esquema con test-cancelacion-puntos-posteriores.sql (que a su vez
-- aplica 20261016042518 y 20261016051525, y trae refund_points_for_cancellation
-- y su trigger reales) y agrega deduct_points_for_booking, copiada de
-- pg_get_functiondef el 16-oct-2026.
--
-- QUE SE PRUEBA
--   1. Apartar descuenta puntos y Cash al crear el cobro; reintentar no
--      descuenta dos veces; reintentar con otros montos se rechaza.
--   2. El descuento del webhook despues del apartado es un no-op (mismas llaves).
--   3. Si el saldo no alcanza, no se aparta NADA (ni los puntos ni el Cash).
--   4. Reserva pendiente cancelada: se devuelve exactamente lo apartado, y el
--      trigger viejo de puntos no devuelve otra vez.
--   5. Reserva PAGADA que llega a 'cancelled'/'failed' (evento tardio): no se
--      libera nada.
--   6. Reserva pendiente borrada (limpieza diaria): se devuelve lo apartado.
--   7. Reserva cancelada que nunca aparto: el trigger viejo ya no crea puntos.
--   8. Stripe aparta los montos de la peticion, no los de la reserva: se libera
--      exactamente eso.
--
--   psql -f scripts/test-apartar-saldo.sql

\ir test-cancelacion-puntos-posteriores.sql

\set ON_ERROR_STOP on
\set QUIET on

-- deduct_points_for_booking VIGENTE (pg_get_functiondef, 16-oct-2026).
CREATE FUNCTION public.deduct_points_for_booking(p_booking_id uuid, p_points_to_deduct integer)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_user_id uuid;
v_wallet_id uuid;
v_new_balance integer;
v_current_balance integer;
BEGIN
IF p_points_to_deduct <= 0 THEN
RETURN false;
END IF;
SELECT user_id INTO v_user_id FROM public.bookings WHERE id = p_booking_id;
IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;
IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;
v_wallet_id := get_or_create_points_wallet(v_user_id);
PERFORM 1 FROM public.toursred_points_wallets WHERE id = v_wallet_id FOR UPDATE;
IF EXISTS (
SELECT 1 FROM public.toursred_points_transactions
WHERE reference_id = p_booking_id
AND type = 'redeemed'
) THEN
RAISE NOTICE 'Points already deducted for booking %', p_booking_id;
RETURN true;
END IF;
SELECT balance INTO v_current_balance
FROM public.toursred_points_wallets
WHERE id = v_wallet_id;
IF v_current_balance < p_points_to_deduct THEN
RAISE EXCEPTION 'Insufficient points. Current balance: %, Required: %', v_current_balance, p_points_to_deduct;
END IF;
UPDATE public.toursred_points_wallets
SET balance = balance - p_points_to_deduct,
total_used = total_used + p_points_to_deduct,
updated_at = now()
WHERE id = v_wallet_id
RETURNING balance INTO v_new_balance;
INSERT INTO public.toursred_points_transactions (
wallet_id, user_id, amount, balance_after, type,
description, reference_id, reference_type
) VALUES (
v_wallet_id, v_user_id, -p_points_to_deduct, v_new_balance,
'redeemed', 'Puntos canjeados en reserva',
p_booking_id, 'booking'
);
RETURN true;
END;
$function$;

\ir ../supabase/migrations/20261016054040_apartar_saldo_al_crear_el_cobro.sql

-- Viajero con saldo: 30,000 puntos y $500 de Cash.
CREATE FUNCTION pg_temp.viajero_con_saldo(n int, pts int, cash numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := ('00000000-0000-0000-0000-0000000003' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO users (id) VALUES (u);
  INSERT INTO toursred_cash_wallets (user_id, balance) VALUES (u, cash);
  INSERT INTO toursred_points_wallets (user_id, balance) VALUES (u, pts);
  RETURN u;
END $$;

-- Reserva pendiente con 25,000 puntos y $250 de Cash comprometidos.
CREATE FUNCTION pg_temp.pendiente(n int, u uuid, pts int, cash numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b uuid := ('00000000-0000-0000-0000-0000000004' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO bookings (id, user_id, booking_code, deposit_amount, service_charge, points_used, toursred_cash_used, payment_status, status)
  VALUES (b, u, 'TRG-H' || n, 500, 0, pts, cash, 'pending', 'pending');
  RETURN b;
END $$;

DO $$
DECLARE u uuid; b uuid; r jsonb; v_ok boolean;
BEGIN
  -- 1. Apartar
  u := pg_temp.viajero_con_saldo(1, 30000, 500);
  b := pg_temp.pendiente(1, u, 25000, 250);
  r := apartar_saldo_de_reserva(b);
  IF pg_temp.pts(u::text) <> 5000 OR pg_temp.cash(u::text) <> 250 THEN
    RAISE EXCEPTION '1a: apartar deberia dejar 5000 pts y $250, hay % y %', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;
  IF (SELECT saldo_apartado_en IS NULL OR saldo_apartado_puntos <> 25000 OR saldo_apartado_cash <> 250 FROM bookings WHERE id = b) THEN
    RAISE EXCEPTION '1a: la reserva no registro lo apartado';
  END IF;
  r := apartar_saldo_de_reserva(b);
  IF NOT (r->>'ya_estaba')::boolean OR pg_temp.pts(u::text) <> 5000 OR pg_temp.cash(u::text) <> 250 THEN
    RAISE EXCEPTION '1b: reintentar desconto otra vez: % pts, $%', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;
  v_ok := false;
  BEGIN
    PERFORM apartar_saldo_de_reserva(b, 1000, 0);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '1c: reintentar con otros montos deberia rechazarse'; END IF;

  -- 2. El webhook vuelve a pedir lo mismo: no-op.
  PERFORM deduct_points_for_booking(b, 25000);
  PERFORM update_wallet_balance(u, -250, 'debit', 'webhook', b, 'booking', b::text || '_charge_booking');
  IF pg_temp.pts(u::text) <> 5000 OR pg_temp.cash(u::text) <> 250 THEN
    RAISE EXCEPTION '2: el descuento del webhook cobro otra vez: % pts, $%', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;

  -- 4. Se cancela sin pagar: regresa exactamente lo apartado, una sola vez.
  UPDATE bookings SET status = 'cancelled' WHERE id = b;
  IF pg_temp.pts(u::text) <> 30000 OR pg_temp.cash(u::text) <> 500 THEN
    RAISE EXCEPTION '4: al cancelar sin pagar deberia volver a 30000 pts y $500, hay % y %', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;
  IF (SELECT saldo_liberado_en IS NULL FROM bookings WHERE id = b) THEN
    RAISE EXCEPTION '4: no marco saldo_liberado_en';
  END IF;

  -- 3. Sin saldo suficiente no se aparta nada.
  u := pg_temp.viajero_con_saldo(3, 100, 500);
  b := pg_temp.pendiente(3, u, 25000, 250);
  v_ok := false;
  BEGIN
    PERFORM apartar_saldo_de_reserva(b);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '3: apartar sin puntos suficientes deberia fallar'; END IF;
  IF pg_temp.pts(u::text) <> 100 OR pg_temp.cash(u::text) <> 500 OR (SELECT saldo_apartado_en IS NOT NULL FROM bookings WHERE id = b) THEN
    RAISE EXCEPTION '3: quedo apartado a medias: % pts, $%', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;

  -- 5. Reserva PAGADA que llega a cancelled/failed: no se libera el Cash.
  u := pg_temp.viajero_con_saldo(5, 30000, 500);
  b := pg_temp.pendiente(5, u, 25000, 250);
  PERFORM apartar_saldo_de_reserva(b);
  UPDATE bookings SET payment_status = 'succeeded', status = 'confirmed' WHERE id = b;
  UPDATE bookings SET status = 'cancelled', payment_status = 'failed' WHERE id = b;
  IF pg_temp.cash(u::text) <> 250 THEN
    RAISE EXCEPTION '5: una reserva pagada no debe devolver el Cash apartado; hay $%', pg_temp.cash(u::text);
  END IF;
  IF (SELECT saldo_liberado_en IS NOT NULL FROM bookings WHERE id = b) THEN
    RAISE EXCEPTION '5: marco liberada una reserva pagada';
  END IF;

  -- 6. Pendiente borrada por la limpieza: se devuelve lo apartado.
  u := pg_temp.viajero_con_saldo(6, 30000, 500);
  b := pg_temp.pendiente(6, u, 25000, 250);
  PERFORM apartar_saldo_de_reserva(b);
  DELETE FROM bookings WHERE id = b;
  IF pg_temp.pts(u::text) <> 30000 OR pg_temp.cash(u::text) <> 500 THEN
    RAISE EXCEPTION '6: borrar la pendiente deberia devolver 30000 pts y $500, hay % y %', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;

  -- 7. Cancelada sin haber apartado nunca: no se crean puntos.
  u := pg_temp.viajero_con_saldo(7, 0, 0);
  b := pg_temp.pendiente(7, u, 25000, 0);
  UPDATE bookings SET status = 'cancelled' WHERE id = b;
  IF pg_temp.pts(u::text) <> 0 THEN
    RAISE EXCEPTION '7: cancelar una reserva que nunca desconto puntos creo % puntos', pg_temp.pts(u::text);
  END IF;

  -- 8. Stripe aparta lo que manda la peticion (10,000 pts, sin Cash) aunque la
  --    reserva diga 25,000: al cancelar regresan 10,000, ni uno mas.
  u := pg_temp.viajero_con_saldo(8, 30000, 500);
  b := pg_temp.pendiente(8, u, 25000, 250);
  PERFORM apartar_saldo_de_reserva(b, 10000, 0);
  IF pg_temp.pts(u::text) <> 20000 OR pg_temp.cash(u::text) <> 500 THEN
    RAISE EXCEPTION '8: apartar 10000 pts sin Cash dejo % pts y $%', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;
  UPDATE bookings SET status = 'cancelled' WHERE id = b;
  IF pg_temp.pts(u::text) <> 30000 OR pg_temp.cash(u::text) <> 500 THEN
    RAISE EXCEPTION '8: al cancelar deberian volver exactamente 10000 pts; hay % y $%', pg_temp.pts(u::text), pg_temp.cash(u::text);
  END IF;
END $$;

\echo 'apartar saldo: apartar, no-op del webhook, todo o nada, liberar, pagada, borrada, sin crear puntos y montos de Stripe, 8 casos OK'
