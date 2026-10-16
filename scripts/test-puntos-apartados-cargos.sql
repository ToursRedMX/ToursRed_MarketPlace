-- Prueba de `20261016060535_puntos_apartados_en_cargos_con_pasarela.sql`.
--
-- Arma el esquema con test-apartar-saldo.sql (que encadena las migraciones de
-- puntos anteriores, con deduct_points y reembolsar_saldo_y_puntos reales) y
-- aplica la migracion real.
--
-- QUE SE PRUEBA
--   1. Apartar descuenta los puntos con el apartado como referencia.
--   2. Reintento con los mismos puntos: no descuenta otra vez. Con otros:
--      libera el anterior y aparta el nuevo.
--   3. Consumir escribe points_used en el cargo y es idempotente.
--   4. Sin puntos suficientes no queda apartado.
--   5. Los vencidos se liberan (cron) y regresan los puntos.
--   6. Un pago que llega DESPUES de liberar vuelve a descontar; si ya no
--      alcanza, no regala el descuento en silencio: devuelve 0 y avisa.
--   7. Cada contexto escribe en su lugar (servicio opcional, seguro) y el abono
--      solo devuelve los puntos.
--
--   psql -f scripts/test-puntos-apartados-cargos.sql

\ir test-apartar-saldo.sql

\set ON_ERROR_STOP on
\set QUIET on

\ir ../supabase/migrations/20261016060535_puntos_apartados_en_cargos_con_pasarela.sql

CREATE FUNCTION pg_temp.v(n int, pts int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := ('00000000-0000-0000-0000-0000000005' || lpad(n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO users (id) VALUES (u);
  INSERT INTO toursred_cash_wallets (user_id, balance) VALUES (u, 0);
  INSERT INTO toursred_points_wallets (user_id, balance) VALUES (u, pts);
  RETURN u;
END $$;

DO $$
DECLARE
  u uuid; b uuid; s uuid := '00000000-0000-0000-0000-0000000006a1'; o uuid := '00000000-0000-0000-0000-0000000006b1';
  a1 uuid; a2 uuid; r int; v_ok boolean;
BEGIN
  u := pg_temp.v(1, 30000);
  b := '00000000-0000-0000-0000-0000000006c1';
  INSERT INTO bookings (id, user_id, booking_code, deposit_amount, payment_status, status) VALUES (b, u, 'TRG-AP1', 500, 'succeeded', 'confirmed');
  INSERT INTO booking_supplements (id, booking_id, total_paid, status) VALUES (s, b, 1000, 'pending_payment');
  INSERT INTO booking_optional_services (id, booking_id, subtotal, total_paid) VALUES (o, b, 400, 400);

  -- 1. Apartar
  a1 := apartar_puntos_de_cargo(u, 'supplement', s, 10000, now() + interval '3 hours');
  IF pg_temp.pts(u::text) <> 20000 THEN RAISE EXCEPTION '1: apartar deberia dejar 20000, hay %', pg_temp.pts(u::text); END IF;
  IF NOT EXISTS (SELECT 1 FROM toursred_points_transactions WHERE reference_id = a1 AND type = 'redeemed' AND amount = -10000 AND reference_type = 'supplement_payment') THEN
    RAISE EXCEPTION '1: el canje no usa el apartado como referencia';
  END IF;

  -- 2. Reintentos
  a2 := apartar_puntos_de_cargo(u, 'supplement', s, 10000, now() + interval '3 hours');
  IF a2 <> a1 OR pg_temp.pts(u::text) <> 20000 THEN RAISE EXCEPTION '2a: el reintento desconto otra vez (% pts)', pg_temp.pts(u::text); END IF;
  a2 := apartar_puntos_de_cargo(u, 'supplement', s, 8000, now() + interval '3 hours');
  IF a2 = a1 OR pg_temp.pts(u::text) <> 22000 THEN
    RAISE EXCEPTION '2b: con otros puntos deberia liberar 10000 y apartar 8000 (22000), hay %', pg_temp.pts(u::text);
  END IF;
  IF (SELECT estado FROM puntos_apartados_cargos WHERE id = a1) <> 'liberado' THEN RAISE EXCEPTION '2b: el apartado anterior no quedo liberado'; END IF;

  -- 3. Consumir
  r := consumir_puntos_de_cargo('supplement', s);
  IF r <> 8000 OR (SELECT points_used FROM booking_supplements WHERE id = s) <> 8000 THEN
    RAISE EXCEPTION '3a: consumir deberia dar 8000 y escribirlos en el suplemento; dio % y quedo %', r, (SELECT points_used FROM booking_supplements WHERE id = s);
  END IF;
  r := consumir_puntos_de_cargo('supplement', s);
  IF r <> 8000 OR pg_temp.pts(u::text) <> 22000 THEN RAISE EXCEPTION '3b: el webhook repetido no es idempotente (% / %)', r, pg_temp.pts(u::text); END IF;
  IF consumir_puntos_de_cargo('supplement', gen_random_uuid()) <> 0 THEN RAISE EXCEPTION '3c: un cargo sin apartado deberia dar 0'; END IF;

  -- 4. Sin puntos suficientes
  v_ok := false;
  BEGIN
    PERFORM apartar_puntos_de_cargo(u, 'optional_service', o, 999999, now() + interval '3 hours');
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '4: apartar mas de lo que hay deberia fallar'; END IF;
  IF EXISTS (SELECT 1 FROM puntos_apartados_cargos WHERE referencia = o) THEN RAISE EXCEPTION '4: quedo un apartado sin descuento'; END IF;

  -- 7. Servicio opcional, seguro y abono
  PERFORM apartar_puntos_de_cargo(u, 'optional_service', o, 2000, now() + interval '3 hours');
  PERFORM apartar_puntos_de_cargo(u, 'insurance', b, 3000, now() + interval '3 hours');
  PERFORM apartar_puntos_de_cargo(u, 'payment_plan_installment', b, 4000, now() + interval '3 hours');
  -- La llamada va aparte: un SELECT en la misma expresion usa la foto de antes.
  r := consumir_puntos_de_cargo('optional_service', o);
  IF r <> 2000 OR (SELECT points_used FROM booking_optional_services WHERE id = o) <> 2000 THEN
    RAISE EXCEPTION '7a: el servicio opcional no guardo sus puntos';
  END IF;
  r := consumir_puntos_de_cargo('insurance', b);
  IF r <> 3000 OR (SELECT travel_insurance_points_used FROM bookings WHERE id = b) <> 3000 THEN
    RAISE EXCEPTION '7b: el seguro no guardo sus puntos';
  END IF;
  IF consumir_puntos_de_cargo('payment_plan_installment', b) <> 4000 THEN RAISE EXCEPTION '7c: el abono no devolvio sus puntos'; END IF;
  IF pg_temp.pts(u::text) <> 13000 THEN RAISE EXCEPTION '7: saldo esperado 13000 (22000 - 2000 - 3000 - 4000), hay %', pg_temp.pts(u::text); END IF;

  -- 5. Vencidos
  u := pg_temp.v(2, 30000);
  a1 := apartar_puntos_de_cargo(u, 'supplement', gen_random_uuid(), 10000, now() + interval '3 hours');
  UPDATE puntos_apartados_cargos SET vence_en = now() - interval '1 minute' WHERE id = a1;
  IF liberar_puntos_apartados_vencidos() <> 1 THEN RAISE EXCEPTION '5: deberia liberar 1 apartado vencido'; END IF;
  IF pg_temp.pts(u::text) <> 30000 OR (SELECT estado FROM puntos_apartados_cargos WHERE id = a1) <> 'liberado' THEN
    RAISE EXCEPTION '5: el vencido no regreso sus puntos (% pts)', pg_temp.pts(u::text);
  END IF;
  IF liberar_puntos_apartados_vencidos() <> 0 THEN RAISE EXCEPTION '5: liberar dos veces'; END IF;

  -- 6. Pago que llega despues de liberar: vuelve a descontar.
  r := consumir_puntos_de_cargo('supplement', (SELECT referencia FROM puntos_apartados_cargos WHERE id = a1));
  IF r <> 10000 OR pg_temp.pts(u::text) <> 20000 THEN
    RAISE EXCEPTION '6a: un pago tardio deberia volver a descontar 10000 (20000), dio % y hay %', r, pg_temp.pts(u::text);
  END IF;
  --    ...y si ya no alcanzan, devuelve 0 (sin descontar de mas ni romper el webhook).
  u := pg_temp.v(3, 10000);
  a1 := apartar_puntos_de_cargo(u, 'supplement', '00000000-0000-0000-0000-0000000006d1', 10000, now() + interval '3 hours');
  UPDATE puntos_apartados_cargos SET vence_en = now() - interval '1 minute' WHERE id = a1;
  PERFORM liberar_puntos_apartados_vencidos();
  UPDATE toursred_points_wallets SET balance = 0 WHERE user_id = u;
  IF consumir_puntos_de_cargo('supplement', '00000000-0000-0000-0000-0000000006d1') <> 0 THEN
    RAISE EXCEPTION '6b: sin puntos, el pago tardio deberia dar 0';
  END IF;
END $$;

\echo 'puntos apartados de cargos: apartar, reintentos, consumir, sin saldo, vencidos, pago tardio y contextos OK'
