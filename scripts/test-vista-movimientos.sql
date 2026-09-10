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

-- NOTA SOBRE LAS COMPROBACIONES: todas agregan con `sum()`, incluso cuando el
-- fixture tiene una sola fila por categoria. No es de adorno. Un
-- `SELECT caja INTO v ... WHERE categoria = X` sin agregar toma LA PRIMERA
-- FILA y descarta las demas sin avisar, asi que una mutacion que agregue filas
-- de mas —por ejemplo dejar pasar un reembolso todavia pendiente— pasaria la
-- prueba. Se descubrio exactamente asi: la mutacion sobrevivio.

-- El fixture (roles, esquema, tablas de utileria y datos) vive aparte porque
-- lo comparte `test-gastos-operacion.sql`.
\ir fixture-movimientos.sql


-- ---------------------------------------------------------------------------
-- La migracion de verdad.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql
-- Y encima la correccion: la membresia deja de ser pasivo, y lo devengado y no
-- pagado a los ejecutivos pasa a ser deuda. Se aplican las DOS en orden, que es
-- el estado real de produccion, en vez de probar solo la version final.
\ir ../supabase/migrations/20260910200000_corregir_membresia_y_pasivo_por_comisiones.sql
-- Y la tercera, que agrega el bloque 19: los gastos de operacion.
\ir ../supabase/migrations/20260910240000_captura_de_gastos_de_operacion.sql

-- Los gastos van DESPUES porque su tabla no existe hasta que corre la
-- migracion. Se meten con `estado = 'registrado'` a mano, sin pasar por
-- `registrar_gasto_operacion`: aqui se prueba COMO REPARTE LA VISTA, no como
-- se genera el asiento. Eso lo cubre `test-gastos-operacion.sql`.
INSERT INTO accounting_entries (id, entry_number, entry_type, entry_date, source_type, source_id)
VALUES ('a1000000-0000-0000-0000-000000000001','EGR-202609-9001','egreso','2026-09-08','gasto_operacion','70000000-0000-0000-0000-000000000001'),
       ('a1000000-0000-0000-0000-000000000002','EGR-202609-9002','egreso','2026-09-08','gasto_operacion','70000000-0000-0000-0000-000000000002');

INSERT INTO gastos_operacion
  (id, fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
   subtotal, iva, total, total_mxn, metodo_pago, pagado_en, estado, asiento_id)
VALUES
  -- PAGADO: salio del banco. 400 de activo negativo, cero pasivo.
  ('70000000-0000-0000-0000-000000000001','2026-09-08','601.01','Telcel','Internet de oficina',
   'MXN',1,344.83,55.17,400,400,'spei','2026-09-08','registrado','a1000000-0000-0000-0000-000000000001'),
  -- POR PAGAR: no salio del banco todavia, pero ya se debe. Cero activo,
  -- 260 de pasivo. Es el caso que suele repartirse mal.
  ('70000000-0000-0000-0000-000000000002','2026-09-08','602','Anthropic','Claude',
   'USD',20,13,0,13,260,NULL,NULL,'registrado','a1000000-0000-0000-0000-000000000002'),
  -- BORRADOR: no tiene asiento y no debe asomarse a la vista. Si el bloque 19
  -- se dejara el filtro de estado, el caso 11 lo caza: los numeros subirian.
  ('70000000-0000-0000-0000-000000000003','2026-09-08','601.02','Papeleria','Hojas',
   'MXN',1,100,16,116,116,NULL,NULL,'borrador',NULL);

\echo '=== Caso 1: un anticipo es caja y pasivo, NO ingreso ==='
DO $$
DECLARE v record;
BEGIN
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso INTO v FROM vista_movimientos_financieros
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
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso INTO v FROM vista_movimientos_financieros
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
   WHERE categoria IN ('monedero_topup_spei','monedero_debit');

  -- 1000 de recarga. El pago de 400 NO agrega caja: ese dinero ya entro.
  IF v_caja <> 1000 THEN
    RAISE EXCEPTION 'FALLO 3: la caja del monedero es % y debe ser 1000. Si dio 1400, el pago con monedero se esta contando como dinero nuevo.', v_caja;
  END IF;
  IF v_traspaso <> 400 THEN
    RAISE EXCEPTION 'FALLO 3: el pago con monedero debe verse como traspaso de 400, y dio %', v_traspaso;
  END IF;
  RAISE NOTICE '  recarga 1000 + reserva 400 con monedero -> caja 1000, traspaso 400. OK';
END $$;

\echo '=== Caso 3b: los otros tipos del monedero tambien se tratan ==='
DO $$
DECLARE v_gc record; v_promo record;
BEGIN
  -- Canje de tarjeta de regalo: el pasivo cambia de cuenta (218-12 -> 218-11).
  -- Ni caja ni ingreso.
  SELECT sum(caja) AS caja, sum(ingreso) AS ingreso, sum(traspaso) AS traspaso
    INTO v_gc FROM vista_movimientos_financieros WHERE categoria = 'monedero_gift_card';
  IF v_gc.caja <> 0 OR v_gc.ingreso <> 0 OR v_gc.traspaso <> 200 THEN
    RAISE EXCEPTION
      'FALLO 3b: canje de tarjeta dio caja=% ingreso=% traspaso=%, esperado 0/0/200. El canje no es dinero nuevo: se cobro al vender la tarjeta.',
      v_gc.caja, v_gc.ingreso, v_gc.traspaso;
  END IF;

  -- Saldo de promocion: no entra dinero pero se crea deuda, y eso cuesta.
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso
    INTO v_promo FROM vista_movimientos_financieros WHERE categoria = 'monedero_promotion';
  IF v_promo.caja <> 0 OR v_promo.pasivo <> 150 OR v_promo.ingreso <> -150 THEN
    RAISE EXCEPTION
      'FALLO 3b: saldo de promocion dio caja=% pasivo=% ingreso=%, esperado 0/150/-150. Regalar saldo no entra dinero pero si genera pasivo y cuesta.',
      v_promo.caja, v_promo.pasivo, v_promo.ingreso;
  END IF;
  RAISE NOTICE '  canje de tarjeta = traspaso; promocion = pasivo + y costo. OK';
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
  SELECT sum(caja) AS caja, sum(traspaso) AS traspaso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'monedero_refund';
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
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso INTO v FROM vista_movimientos_financieros
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
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'tour_destacado';
  IF v.caja <> 900 OR v.ingreso <> 900 OR v.pasivo <> 0 THEN
    RAISE EXCEPTION
      'FALLO 8: caja=% pasivo=% ingreso=% (esperado 900/0/900). Es un servicio de promocion: no hay nada que liberar a la agencia.',
      v.caja,v.pasivo,v.ingreso;
  END IF;
  RAISE NOTICE '  tour destacado 900 -> caja 900, ingreso 900, pasivo 0. OK';
END $$;

\echo '=== Caso 8b: el reembolso a la tarjeta SI sale del banco ==='
DO $$
DECLARE v record; v_fee record;
BEGIN
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso, sum(traspaso) AS traspaso INTO v FROM vista_movimientos_financieros
   WHERE categoria = 'reembolso_metodo_original';

  -- Solo el confirmado. El `pending` de 999 no ha movido nada.
  IF v.caja <> -1500 THEN
    RAISE EXCEPTION
      'FALLO 8b: caja = %, esperado -1500. Si dio -2499 se colo el reembolso pendiente; si dio 0, la via de devolucion a la tarjeta no se esta viendo y ese dinero SI sale del banco.',
      v.caja;
  END IF;
  IF v.pasivo <> -1500 THEN
    RAISE EXCEPTION 'FALLO 8b: pasivo = %, esperado -1500', v.pasivo;
  END IF;
  IF v.traspaso <> 0 THEN
    RAISE EXCEPTION 'FALLO 8b: esto NO es un traspaso al monedero, y dio traspaso = %', v.traspaso;
  END IF;

  -- Y la comision POR reembolsar, que es dinero nuevo que sale.
  SELECT sum(caja) AS caja, sum(ingreso) AS ingreso INTO v_fee FROM vista_movimientos_financieros
   WHERE categoria = 'comision_por_reembolso';
  IF v_fee.caja <> -25 OR v_fee.ingreso <> -25 THEN
    RAISE EXCEPTION
      'FALLO 8b: la comision por reembolsar dio caja=% ingreso=%, esperado -25/-25. Si dio -55 se sumo processor_fee_lost, que ya se conto al cobrar.',
      v_fee.caja, v_fee.ingreso;
  END IF;
  RAISE NOTICE '  reembolso a tarjeta 1500 -> caja -1500 (no traspaso), mas 25 de comision por reembolsar. OK';
END $$;

\echo '=== Caso 8c: la membresia es ingreso, no deuda ==='
DO $$
DECLARE v record;
BEGIN
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso
    INTO v FROM vista_movimientos_financieros WHERE categoria = 'cobro_membership';
  IF v.caja <> 800 OR v.pasivo <> 0 OR v.ingreso <> 800 THEN
    RAISE EXCEPTION
      'FALLO 8c: membresia dio caja=% pasivo=% ingreso=%, esperado 800/0/800. Una membresia es producto de ToursRed: no hay agencia a la que liberarle nada, asi que no genera pasivo y es ingreso desde el primer momento.',
      v.caja, v.pasivo, v.ingreso;
  END IF;
  RAISE NOTICE '  membresia 800 -> ingreso 800, pasivo 0. OK';
END $$;

\echo '=== Caso 8d: lo devengado y no pagado a ejecutivos es deuda ==='
DO $$
DECLARE v record;
BEGIN
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso
    INTO v FROM vista_movimientos_financieros WHERE categoria = 'comision_ejecutivo';
  -- Pagada 60 + pendiente 90: sale del banco solo la pagada, se debe la otra,
  -- y las dos son gasto.
  IF v.caja <> -60 OR v.pasivo <> 90 OR v.ingreso <> -150 THEN
    RAISE EXCEPTION
      'FALLO 8d: ejecutivos dio caja=% pasivo=% ingreso=%, esperado -60/90/-150. La comision devengada y no pagada es gasto Y deuda a la vez.',
      v.caja, v.pasivo, v.ingreso;
  END IF;
  RAISE NOTICE '  ejecutivos -> caja -60, deuda 90, gasto -150. OK';
END $$;

\echo '=== Caso 8e: LA ECUACION CONTABLE, categoria por categoria ==='
DO $$
DECLARE v_mala text; v_desc numeric;
BEGIN
  -- activo = pasivo + ingreso. Este invariante es lo que caza un bloque que
  -- reparta mal un movimiento, sin que nadie tenga que revisarlo a mano.
  SELECT categoria, round((sum(caja) - sum(pasivo) - sum(ingreso))::numeric,2)
    INTO v_mala, v_desc
    FROM vista_movimientos_financieros
   GROUP BY categoria
  HAVING round((sum(caja) - sum(pasivo) - sum(ingreso))::numeric,2) <> 0
   LIMIT 1;

  IF v_mala IS NOT NULL THEN
    RAISE EXCEPTION
      'FALLO 8e: la categoria "%" descuadra por %. Debe cumplirse activo = pasivo + ingreso: si entra dinero al banco, o se le debe a alguien o se gano.',
      v_mala, v_desc;
  END IF;
  RAISE NOTICE '  todas las categorias cumplen activo = pasivo + ingreso. OK';
END $$;

\echo '=== Caso 8g: de quien es el dinero, concepto por concepto ==='
DO $$
DECLARE r record;
BEGIN
  -- POR QUE ESTE CASO EXISTE, ADEMAS DEL INVARIANTE:
  --
  -- El invariante (8e) caza descuadres, NO malas clasificaciones. Marcar la
  -- comision de la aseguradora como pasivo en vez de ingreso cuadra igual
  -- —450 de activo contra 450 de pasivo— y pasa. Comprobado con una mutacion
  -- que sobrevivio.
  --
  -- Es el mismo caso del bug que Axel encontro con la membresia: estaba
  -- balanceada y mal clasificada. La pregunta "de quien es este dinero" hay
  -- que afirmarla concepto por concepto; no se deduce de que las cuentas
  -- cuadren.

  -- Productos propios de ToursRed: no hay a quien liberarle nada.
  FOR r IN
    SELECT categoria, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso
      FROM vista_movimientos_financieros
     WHERE categoria IN ('cobro_membership','tour_destacado','comision_aseguradora')
     GROUP BY categoria
  LOOP
    IF r.pasivo <> 0 OR r.ingreso <= 0 THEN
      RAISE EXCEPTION
        'FALLO 8g: "%" dio pasivo=% ingreso=%. Es un producto propio de ToursRed: no le debe nada a nadie, asi que pasivo 0 e ingreso positivo.',
        r.categoria, r.pasivo, r.ingreso;
    END IF;
  END LOOP;

  -- Dinero de terceros al entrar: todavia no se gano nada.
  FOR r IN
    SELECT categoria, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso
      FROM vista_movimientos_financieros
     WHERE categoria IN ('cobro_booking_deposit','tarjeta_regalo','monedero_topup_spei')
     GROUP BY categoria
  LOOP
    IF r.pasivo <= 0 OR r.ingreso <> 0 THEN
      RAISE EXCEPTION
        'FALLO 8g: "%" dio pasivo=% ingreso=%. Ese dinero entra al banco pero es del viajero o de la agencia: pasivo positivo e ingreso 0 hasta que se reconozca.',
        r.categoria, r.pasivo, r.ingreso;
    END IF;
  END LOOP;

  RAISE NOTICE '  productos propios sin pasivo, dinero de terceros sin ingreso. OK';
END $$;

\echo '=== Caso 8f: el fixture ejercita TODOS los bloques ==='
DO $$
DECLARE v_hay text[]; v_esperado text[];
BEGIN
  -- Un invariante solo vale lo que cubre el fixture. Si un bloque no produce
  -- ni una fila, romperlo no rompe la prueba: la mutacion de la tarjeta de
  -- regalo sobrevivio exactamente asi. Esta lista es EXACTA a proposito: al
  -- agregar un bloque a la vista hay que agregarle su fila al fixture y su
  -- nombre aqui, y la prueba obliga a hacerlo.
  SELECT array_agg(DISTINCT categoria ORDER BY categoria) INTO v_hay
    FROM vista_movimientos_financieros;

  v_esperado := ARRAY[
    'cobro_booking_deposit','cobro_membership','comision_aseguradora',
    'comision_ejecutivo','comision_por_reembolso','comision_procesador',
    'contracargo','gasto_operacion','liquidacion_aseguradora','monedero_debit',
    'monedero_gift_card','monedero_promotion','monedero_refund',
    'monedero_topup_spei','pago_agencia','reconocimiento_ingreso',
    'reembolso_metodo_original','servicio_opcional','suplemento',
    'tarjeta_regalo','tour_destacado'
  ];

  IF v_hay IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION
      'FALLO 8f: el fixture ya no cubre los mismos bloques. Sin fila, un bloque roto no rompe la prueba. Falta cubrir: % / Nuevo o sobrante: %',
      (SELECT coalesce(array_agg(x),'{}') FROM unnest(v_esperado) x WHERE NOT x = ANY(v_hay)),
      (SELECT coalesce(array_agg(x),'{}') FROM unnest(v_hay) x WHERE NOT x = ANY(v_esperado));
  END IF;
  RAISE NOTICE '  los % bloques con datos producen filas y entran al invariante. OK', array_length(v_hay,1);
END $$;

\echo '=== Caso 11: un gasto pagado sale del banco; uno por pagar es deuda ==='
DO $$
DECLARE v record; v_borrador int;
BEGIN
  SELECT sum(caja) AS caja, sum(pasivo) AS pasivo, sum(ingreso) AS ingreso INTO v
    FROM vista_movimientos_financieros WHERE categoria = 'gasto_operacion';

  -- Pagado 400 -> caja -400, pasivo 0.  Por pagar 260 -> caja 0, pasivo +260.
  -- Los dos son gasto (ingreso negativo) por su total en pesos: -400 - 260.
  IF v.caja <> -400 OR v.pasivo <> 260 OR v.ingreso <> -660 THEN
    RAISE EXCEPTION 'FALLO 11: caja=% pasivo=% ingreso=% (esperado -400/260/-660)',
      v.caja, v.pasivo, v.ingreso;
  END IF;

  -- Y el borrador no esta. Se comprueba por su importe, no por contar filas:
  -- 116 solo puede venir de el.
  SELECT count(*) INTO v_borrador FROM vista_movimientos_financieros
   WHERE origen_tabla = 'gastos_operacion' AND abs(ingreso) = 116;
  IF v_borrador <> 0 THEN
    RAISE EXCEPTION 'FALLO 11: el borrador de 116 se asomo a la vista. Un gasto sin asiento no es un hecho.';
  END IF;

  RAISE NOTICE '  pagado -400 de banco, por pagar +260 de deuda, borrador fuera. OK';
END $$;

\echo '=== Caso 9: vaciar una fuente no rompe la vista ==='
DO $$
DECLARE v_antes int; v_despues int; v_disputas int;
BEGIN
  SELECT count(*) INTO v_antes FROM vista_movimientos_financieros;

  -- Antes este caso comprobaba que 4 tablas VACIAS no rompian nada. Dejo de
  -- servir cuando el fixture las lleno para que sus bloques se ejercitaran
  -- (caso 8f). Lo que si sigue importando es lo inverso: que una fuente que se
  -- queda sin filas no tumbe el reporte entero ni haga desaparecer lo demas.
  TRUNCATE payment_disputes;

  SELECT count(*) INTO v_despues FROM vista_movimientos_financieros;
  SELECT count(*) INTO v_disputas FROM vista_movimientos_financieros
   WHERE categoria = 'contracargo';

  IF v_disputas <> 0 THEN
    RAISE EXCEPTION 'FALLO 9: se vacio payment_disputes y siguen apareciendo % contracargos', v_disputas;
  END IF;
  IF v_despues <> v_antes - 1 THEN
    RAISE EXCEPTION
      'FALLO 9: vaciar una fuente cambio el total de % a %, y solo debia quitar la unica fila de esa fuente.',
      v_antes, v_despues;
  END IF;
  RAISE NOTICE '  fuente vacia: se va su fila y el resto sigue en pie. OK';
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
\echo 'Vista de movimientos financieros: 18/18 casos OK'
