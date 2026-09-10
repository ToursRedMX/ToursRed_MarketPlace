-- Prueba de `20260910080000_vista_movimientos_financieros.sql`.
--
-- QUE SE PRUEBA, y sobre todo POR QUE
--
-- La vista existe para cerrar dos trampas que ya mordieron. Las dos se
-- reproducen aqui con un fixture chico antes de comprobar que la vista las
-- evita, porque una prueba que solo mira el resultado bueno no demuestra nada:
--
--   TRAMPA 1 -- contar dos veces el monedero. Se recarga 1,000 y despues se
--   paga una reserva de 400 con ese saldo. La caja subio 1,000, no 1,400. El
--   caso 3 falla si la vista suma el pago con monedero como caja.
--
--   TRAMPA 2 -- contar el ingreso de reservas canceladas. `commission_records`
--   tiene el estado `voided`, pero `voided` NO TOCA EL IMPORTE: la columna
--   `platform_total_revenue` conserva su valor. Y en produccion, de 8 reservas
--   canceladas solo 4 estaban en `voided`; las otras 4 seguian en `processed`.
--   Por eso los casos 4 y 5 prueban LAS DOS variantes: cancelada+voided y
--   cancelada+processed. Filtrar solo por una de las dos deja pasar la mitad.
--
-- Ademas: que un reembolso no se cuente como salida de caja (caso 6), que la
-- liberacion a la agencia si lo sea (caso 7), que un tour destacado sea ingreso
-- integro sin pasivo (caso 8), que las tablas vacias no rompan nada (caso 9) y
-- que la vista no sea un rodeo alrededor de las RLS (caso 10).
--
--   psql -f scripts/test-vista-movimientos.sql

\set ON_ERROR_STOP on
\set QUIET on

-- Supabase trae estos tres roles de fabrica; un Postgres pelado no. La
-- migracion les concede permisos y esta bien que lo haga: quien tiene que
-- parecerse al entorno real es la prueba, no al reves. Sin ellos el `GRANT`
-- revienta con 'role "anon" does not exist' y la prueba no llega ni a empezar.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $roles$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Fixture: solo las columnas que la vista toca.
-- ---------------------------------------------------------------------------
CREATE TABLE agencies (id uuid PRIMARY KEY, name text);
CREATE TABLE users    (id uuid PRIMARY KEY, first_name text, last_name text);
CREATE TABLE bookings (id uuid PRIMARY KEY, booking_code text, agency_id uuid, status text);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY, booking_id uuid, amount numeric, status text,
  processor_fee numeric, charge_context text, payment_processor text,
  created_at timestamptz);

CREATE TABLE openpay_wallet_topups (
  id uuid PRIMARY KEY, user_id uuid, amount numeric, status text, created_at timestamptz);

CREATE TABLE gift_cards (
  id uuid PRIMARY KEY, code text, amount numeric, payment_status text,
  payment_provider text, purchaser_email text, purchased_at timestamptz);

CREATE TABLE booking_optional_services (
  id uuid PRIMARY KEY, booking_id uuid, description text, payment_method text,
  total_paid numeric, paid_at timestamptz, created_at timestamptz);

CREATE TABLE booking_supplements (
  id uuid PRIMARY KEY, booking_id uuid, total_paid numeric, created_at timestamptz);

CREATE TABLE featured_tour_slots (
  id uuid PRIMARY KEY, agency_id uuid, total_amount numeric,
  payment_provider text, payment_confirmed_at timestamptz);

CREATE TABLE commission_records (
  id uuid PRIMARY KEY, booking_id uuid, agency_id uuid,
  platform_total_revenue numeric, status text,
  processed_at timestamptz, created_at timestamptz);

CREATE TABLE insurance_commission_receipts (
  id uuid PRIMARY KEY, provider_name text, amount numeric,
  invoice_reference text, receipt_date timestamptz);

CREATE TABLE agency_payouts (
  id uuid PRIMARY KEY, agency_id uuid, amount numeric, status text,
  payment_date timestamptz, payout_code text, payment_method text);

CREATE TABLE toursred_cash_transactions (
  id uuid PRIMARY KEY, user_id uuid, amount numeric, type text,
  reference_type text, reference_id uuid, created_at timestamptz);

CREATE TABLE executive_commissions (
  id uuid PRIMARY KEY, agency_id uuid, amount numeric, status text,
  commission_type text, payment_reference text,
  paid_at timestamptz, created_at timestamptz);

CREATE TABLE toursred_points_transactions (
  id uuid PRIMARY KEY, user_id uuid, amount integer, type text,
  reference_type text, created_at timestamptz);

CREATE TABLE insurance_settlements (
  id uuid PRIMARY KEY, provider_name text, amount numeric,
  reference text, payment_date timestamptz);

CREATE TABLE payment_disputes (id uuid PRIMARY KEY, amount numeric, created_at timestamptz);

-- ---------------------------------------------------------------------------
-- Datos. Cifras chicas y distintas entre si para que cualquier suma equivocada
-- de un numero reconocible en vez de cuadrar por casualidad.
-- ---------------------------------------------------------------------------
INSERT INTO agencies VALUES ('a0000000-0000-0000-0000-000000000001','Agencia Uno');
INSERT INTO users    VALUES ('c0000000-0000-0000-0000-000000000001','Ana','Viajera');

INSERT INTO bookings VALUES
  ('b0000000-0000-0000-0000-000000000001','RES-VIVA',   'a0000000-0000-0000-0000-000000000001','confirmed'),
  ('b0000000-0000-0000-0000-000000000002','RES-CANC-V', 'a0000000-0000-0000-0000-000000000001','cancelled'),
  ('b0000000-0000-0000-0000-000000000003','RES-CANC-P', 'a0000000-0000-0000-0000-000000000001','cancelled'),
  ('b0000000-0000-0000-0000-000000000004','RES-MONEDERO','a0000000-0000-0000-0000-000000000001','confirmed'),
  ('b0000000-0000-0000-0000-000000000005','RES-VIVA-ANULADA','a0000000-0000-0000-0000-000000000001','confirmed');

-- Anticipo de 5,000 por tarjeta, con 50 de comision de procesador.
INSERT INTO payment_transactions VALUES
  ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   5000,'succeeded',50,'booking_deposit','stripe','2026-09-01');

-- Reconocimiento sobre la reserva viva: 750.
INSERT INTO commission_records VALUES
  ('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',750,'processed','2026-09-01','2026-09-01'),
  -- TRAMPA 2a: cancelada Y anulada. 111 no debe aparecer.
  ('e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',111,'voided','2026-09-02','2026-09-02'),
  -- TRAMPA 2b: cancelada pero SIN anular. 222 tampoco debe aparecer.
  ('e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',222,'processed','2026-09-03','2026-09-03'),
  -- TRAMPA 2c: reserva VIVA con el registro anulado (una correccion, por
  -- ejemplo). Esta fila es la que hace que el filtro de `voided` se ejercite
  -- de verdad: sin ella, el filtro de reservas canceladas ya tapaba a la 2a y
  -- quitar el de `voided` no rompia nada -- comprobado con una mutacion que
  -- sobrevivio. 444 no debe aparecer.
  ('e0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000005',
   'a0000000-0000-0000-0000-000000000001',444,'voided','2026-09-03','2026-09-03');

-- TRAMPA 1: recarga de 1,000 y despues una reserva de 400 pagada con ese saldo.
INSERT INTO openpay_wallet_topups VALUES
  ('f0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   1000,'completed','2026-09-04');
INSERT INTO toursred_cash_transactions VALUES
  ('10000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   -400,'debit','booking','b0000000-0000-0000-0000-000000000004','2026-09-05'),
  -- Reembolso al monedero: no sale del banco.
  ('10000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',
   333,'refund','booking_cancellation','b0000000-0000-0000-0000-000000000002','2026-09-06');

-- Liberacion a la agencia: esto SI sale del banco.
INSERT INTO agency_payouts VALUES
  ('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   2000,'completed','2026-09-07','PAY-1','spei');

-- Tour destacado: ingreso integro, sin pasivo.
INSERT INTO featured_tour_slots VALUES
  ('30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   900,'stripe','2026-09-08');

-- ---------------------------------------------------------------------------
-- La migracion de verdad.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql

\echo '=== Caso 1: un anticipo es caja y pasivo, NO ingreso ==='
DO $$
DECLARE v record;
BEGIN
  SELECT caja, pasivo, ingreso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'cobro_booking_deposit';
  IF v.caja <> 5000 OR v.pasivo <> 5000 OR v.ingreso <> 0 THEN
    RAISE EXCEPTION 'FALLO 1: caja=% pasivo=% ingreso=% (esperado 5000/5000/0)', v.caja,v.pasivo,v.ingreso;
  END IF;
  RAISE NOTICE '  anticipo 5000 -> caja 5000, pasivo 5000, ingreso 0. OK';
END $$;

\echo '=== Caso 2: el reconocimiento baja pasivo y sube ingreso ==='
DO $$
DECLARE v record;
BEGIN
  SELECT caja, pasivo, ingreso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'reconocimiento_ingreso';
  IF v.caja <> 0 OR v.pasivo <> -750 OR v.ingreso <> 750 THEN
    RAISE EXCEPTION 'FALLO 2: caja=% pasivo=% ingreso=% (esperado 0/-750/750)', v.caja,v.pasivo,v.ingreso;
  END IF;
  RAISE NOTICE '  reconocimiento -> pasivo -750, ingreso +750, caja 0. OK';
END $$;

\echo '=== Caso 3: TRAMPA 1 -- el monedero no se cuenta dos veces ==='
DO $$
DECLARE v_caja numeric; v_traspaso numeric;
BEGIN
  SELECT sum(caja), sum(traspaso) INTO v_caja, v_traspaso
    FROM vista_movimientos_financieros
   WHERE categoria IN ('recarga_monedero','pago_con_monedero');

  -- 1000 de recarga. El pago de 400 NO agrega caja: ese dinero ya entro.
  IF v_caja <> 1000 THEN
    RAISE EXCEPTION 'FALLO 3: la caja del monedero es % y debe ser 1000. Si dio 1400, el pago con monedero se esta contando como dinero nuevo.', v_caja;
  END IF;
  IF v_traspaso <> 400 THEN
    RAISE EXCEPTION 'FALLO 3: el pago con monedero debe verse como traspaso de 400, y dio %', v_traspaso;
  END IF;
  RAISE NOTICE '  recarga 1000 + reserva 400 con monedero -> caja 1000, traspaso 400. OK';
END $$;

\echo '=== Caso 4: TRAMPA 2a/2b -- las canceladas no cuentan, anuladas o no ==='
\echo '=== Caso 5: TRAMPA 2c -- un registro anulado no cuenta ni con la reserva viva ==='
DO $$
DECLARE v_ingreso numeric; v_filas int;
BEGIN
  SELECT coalesce(sum(ingreso),0), count(*) INTO v_ingreso, v_filas
    FROM vista_movimientos_financieros WHERE categoria = 'reconocimiento_ingreso';

  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'FALLO 4/5: hay % filas de reconocimiento y debe haber 1. Se colo alguna reserva cancelada.', v_filas;
  END IF;
  IF v_ingreso <> 750 THEN
    RAISE EXCEPTION
      'FALLO 4/5: ingreso reconocido = %, esperado 750. Cada sumando delata que filtro falta: +111 la cancelada anulada, +222 la cancelada en processed, +444 la viva con el registro anulado.',
      v_ingreso;
  END IF;
  RAISE NOTICE '  las tres quedan fuera: ingreso 750, ni 861 ni 972 ni 1194. OK';
END $$;

\echo '=== Caso 6: un reembolso NO es salida de caja ==='
DO $$
DECLARE v record;
BEGIN
  SELECT caja, traspaso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'reembolso_booking_cancellation';
  IF v.caja <> 0 THEN
    RAISE EXCEPTION 'FALLO 6: el reembolso movio caja (%). Se acredita al monedero, no sale del banco.', v.caja;
  END IF;
  IF v.traspaso <> 333 THEN
    RAISE EXCEPTION 'FALLO 6: el reembolso debe verse como traspaso 333 y dio %', v.traspaso;
  END IF;
  RAISE NOTICE '  reembolso 333 -> caja 0, traspaso 333. OK';
END $$;

\echo '=== Caso 7: la liberacion a la agencia SI sale del banco ==='
DO $$
DECLARE v record;
BEGIN
  SELECT caja, pasivo, ingreso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'pago_agencia';
  IF v.caja <> -2000 OR v.pasivo <> -2000 OR v.ingreso <> 0 THEN
    RAISE EXCEPTION 'FALLO 7: caja=% pasivo=% ingreso=% (esperado -2000/-2000/0)', v.caja,v.pasivo,v.ingreso;
  END IF;
  RAISE NOTICE '  liberacion 2000 -> caja -2000, pasivo -2000. OK';
END $$;

\echo '=== Caso 8: un tour destacado es ingreso integro, sin pasivo ==='
DO $$
DECLARE v record;
BEGIN
  SELECT caja, pasivo, ingreso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'tour_destacado';
  IF v.caja <> 900 OR v.ingreso <> 900 OR v.pasivo <> 0 THEN
    RAISE EXCEPTION
      'FALLO 8: caja=% pasivo=% ingreso=% (esperado 900/0/900). Es un servicio de promocion: no hay nada que liberar a la agencia.',
      v.caja,v.pasivo,v.ingreso;
  END IF;
  RAISE NOTICE '  tour destacado 900 -> caja 900, ingreso 900, pasivo 0. OK';
END $$;

\echo '=== Caso 9: las tablas vacias no rompen la vista ==='
DO $$
DECLARE v_n int;
BEGIN
  -- suplementos, aseguradora, liquidaciones y disputas estan en cero.
  SELECT count(*) INTO v_n FROM vista_movimientos_financieros
   WHERE categoria IN ('suplemento','comision_aseguradora','liquidacion_aseguradora','contracargo');
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLO 9: se esperaban 0 filas de las tablas vacias y hay %', v_n; END IF;
  -- Y la vista completa sigue respondiendo.
  PERFORM count(*) FROM vista_movimientos_financieros;
  RAISE NOTICE '  4 tablas vacias, la vista responde igual. OK';
END $$;

\echo '=== Caso 10: la vista NO es un rodeo alrededor de las RLS ==='
DO $$
DECLARE v_invoker text;
BEGIN
  SELECT coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false')
    INTO v_invoker
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vista_movimientos_financieros';

  IF v_invoker IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      'FALLO 10: security_invoker = %. Sin el, la vista corre con los permisos de quien la creo y cualquiera con SELECT ve el dinero de todos.',
      v_invoker;
  END IF;
  RAISE NOTICE '  security_invoker = true: las RLS de las tablas de abajo siguen aplicando. OK';
END $$;

\echo ''
\echo 'Vista de movimientos financieros: 10/10 casos OK'
