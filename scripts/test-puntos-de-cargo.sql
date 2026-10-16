-- Prueba de `20261016065215_puntos_de_un_cargo.sql`.
--
-- puntos_de_cargo lee los puntos apartados para un cargo SIN consumirlos:
-- MercadoPago y PayPal verifican el monto cobrado (total menos esos puntos)
-- antes de registrar el pago y consumirlos.
--
-- QUE SE PRUEBA
--   1. Apartado vivo: devuelve sus puntos y no los consume.
--   2. Ya consumido (el webhook llego primero): devuelve los consumidos.
--   3. Liberado o sin apartado: 0 (el monto esperado es el total).
--   4. Si hay uno vivo y uno consumido viejo, manda el vivo.
--
--   psql -f scripts/test-puntos-de-cargo.sql

\ir test-puntos-apartados-cargos.sql

\set ON_ERROR_STOP on
\set QUIET on

\ir ../supabase/migrations/20261016065215_puntos_de_un_cargo.sql

DO $$
DECLARE u uuid := pg_temp.v(9, 50000); s uuid := gen_random_uuid(); a uuid;
BEGIN
  -- 3. Sin apartado
  IF puntos_de_cargo('supplement', s) <> 0 THEN RAISE EXCEPTION '3a: sin apartado deberia dar 0'; END IF;

  -- 1. Apartado vivo: lo lee y NO lo consume.
  a := apartar_puntos_de_cargo(u, 'supplement', s, 7000, now() + interval '3 hours');
  IF puntos_de_cargo('supplement', s) <> 7000 THEN RAISE EXCEPTION '1: deberia leer 7000'; END IF;
  IF (SELECT estado FROM puntos_apartados_cargos WHERE id = a) <> 'apartado' THEN RAISE EXCEPTION '1: leer no debe consumir'; END IF;

  -- 2. Consumido
  PERFORM consumir_puntos_de_cargo('supplement', s);
  IF puntos_de_cargo('supplement', s) <> 7000 THEN RAISE EXCEPTION '2: consumido deberia seguir leyendo 7000'; END IF;

  -- 4. Un apartado vivo nuevo manda sobre el consumido viejo.
  PERFORM apartar_puntos_de_cargo(u, 'supplement', s, 3000, now() + interval '3 hours');
  IF puntos_de_cargo('supplement', s) <> 3000 THEN RAISE EXCEPTION '4: deberia leer el apartado vivo (3000), lee %', puntos_de_cargo('supplement', s); END IF;

  -- 3. Liberado
  a := apartar_puntos_de_cargo(u, 'insurance', s, 1000, now() + interval '3 hours');
  PERFORM liberar_puntos_de_cargo(a);
  IF puntos_de_cargo('insurance', s) <> 0 THEN RAISE EXCEPTION '3b: liberado deberia dar 0'; END IF;
END $$;

\echo 'puntos_de_cargo: lee sin consumir, consumido, liberado y vivo sobre viejo OK'
