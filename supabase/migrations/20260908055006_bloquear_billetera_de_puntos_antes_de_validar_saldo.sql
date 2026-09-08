-- ============================================================================
-- M-2 (auditoria funciones Postgres 05-sep-2026): las funciones que DESCUENTAN
-- puntos validan el saldo sobre una lectura sin bloquear
--
-- EL HALLAZGO ESTABA MAL DIMENSIONADO EN DOS SENTIDOS. Comprobado el
-- 08-sep-2026 contra la base viva antes de escribir esto.
--
-- 1. El dano NO esta acotado.
--
--    La auditoria decia que la carrera "no puede producir un saldo negativo"
--    porque la tabla tiene CHECK (balance >= 0), asi que la segunda
--    transaccion abortaria y el sintoma seria un 500, no perdida de dinero.
--    Eso era cierto en el CREATE TABLE original
--    (20260126182722_create_toursred_points_system.sql:6), pero la migracion
--    20260717193939 relajo la restriccion a
--
--      CHECK (balance >= -100000)
--
--    a proposito, para permitir clawback de puntos al cancelar. La
--    consecuencia no buscada es que hoy la carrera SI puede sobregirar: el
--    usuario gasta puntos que no tiene, hasta 100,000 en negativo.
--
-- 2. No es una funcion, son varias.
--
--    De las 13 funciones que tocan el saldo de puntos, solo importan las que
--    VALIDAN contra una lectura previa, o sea los descuentos. Las de abono
--    (award_*, refund_*) hacen `SET balance = balance + x`, que es atomico en
--    Postgres: no pierden updates y no necesitan bloqueo. Los descuentos eran:
--
--      deduct_points                            <- el unico que nombra M-2
--      deduct_points_for_booking                <- lo llaman los 5 webhooks de
--                                                  pago, que REINTENTAN por
--                                                  disenno: es el mas expuesto
--      deduct_points_for_partial_cancellation
--      redeem_points_for_booking                <- se elimina, ver mas abajo
--
-- QUE HACE ESTA MIGRACION
--
-- Toma un bloqueo de fila sobre la billetera ANTES de que corra nada que
-- dependa de su estado. Una sola linea por funcion:
--
--   PERFORM 1 FROM public.toursred_points_wallets WHERE id = v_wallet_id
--   FOR UPDATE;
--
-- justo despues de resolver v_wallet_id. Con eso las dos carreras se cierran
-- de un golpe, y sin mover una sola linea del resto del cuerpo:
--
--   - Saldo: la lectura `SELECT balance INTO v_current_balance` que ya existia
--     mas abajo ahora ocurre con el lock tomado, asi que lee el saldo real y
--     no uno viejo.
--   - Duplicado: el guard `IF EXISTS (SELECT 1 FROM ..._transactions ...)`
--     tambien queda despues del lock. La segunda llamada espera, y al
--     despertar ya ve la fila que inserto la primera, asi que devuelve true
--     sin descontar. Antes las dos pasaban el guard y descontaban las dos.
--
-- Es el patron que ya usan admin_adjust_points, claw_back_points_for_refund y
-- create_booking_atomic en este mismo repo. El contraste que sennala la
-- auditoria —update_wallet_balance, la billetera de DINERO, hace todo bien— se
-- salda aqui para la de PUNTOS.
--
-- POR QUE UNA LINEA Y NO UN REESCRITO
--
-- La migracion no reescribe los cuerpos: lee la definicion viva con
-- pg_get_functiondef, inserta esa linea con regexp_replace y la reejecuta. Es
-- a proposito, igual que en 20260908044815: copiar a mano logica de puntos
-- para agregar un bloqueo es justo como se meten errores que nadie nota hasta
-- que a un viajero le faltan puntos. Si el patron no aparece, la migracion
-- FALLA en vez de dejar el cambio a medias. Si ya trae FOR UPDATE, no hace
-- nada (idempotente).
--
-- LO QUE NO HACE, Y POR QUE
--
-- No crea un indice unico sobre (reference_id, reference_type) para las
-- transacciones 'redeemed'. Seria defensa en profundidad, pero con el lock
-- puesto el guard de duplicado ya es correcto, y un indice unico en el camino
-- de un webhook de pago convierte cualquier caso legitimo no previsto en un
-- 500. Hoy hay 7 filas 'redeemed' con referencia y 0 duplicados, asi que se
-- puede crear en cualquier momento si se decide que vale la pena.
--
-- COMO COMPROBARLO DESPUES
--
--   select p.proname,
--          (pg_get_functiondef(p.oid) ilike '%for update%') as tiene_lock
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('deduct_points','deduct_points_for_booking',
--                        'deduct_points_for_partial_cancellation');
--
-- Esperado: las tres en true. Y la longitud de cada definicion debe crecer
-- exactamente lo que mide la linea insertada, ni un caracter mas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bloqueo de fila en las tres funciones de descuento que se conservan
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_nombre text;
  v_def    text;
  v_nuevo  text;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY[
    'deduct_points',
    'deduct_points_for_booking',
    'deduct_points_for_partial_cancellation'
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_nombre;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'La funcion % no existe', v_nombre;
    END IF;

    IF v_def ILIKE '%FOR UPDATE%' THEN
      RAISE NOTICE '% ya toma el bloqueo; sin cambios', v_nombre;
      CONTINUE;
    END IF;

    -- El punto de insercion es la linea que resuelve la billetera. Es la misma
    -- en las tres, cambiando solo el argumento (p_user_id / v_user_id).
    v_nuevo := regexp_replace(
      v_def,
      '(v_wallet_id := get_or_create_points_wallet\([^)]*\);)',
      '\1' || chr(10) ||
      '-- M-2: bloquea la fila de la billetera ANTES del guard de duplicado y' || chr(10) ||
      '-- de la validacion de saldo. Sin esto, dos llamadas concurrentes leen' || chr(10) ||
      '-- el mismo saldo, las dos pasan la validacion y las dos descuentan.' || chr(10) ||
      'PERFORM 1 FROM public.toursred_points_wallets WHERE id = v_wallet_id FOR UPDATE;',
      ''
    );

    IF v_nuevo = v_def THEN
      RAISE EXCEPTION
        'No se encontro el punto de insercion en %; no se toca nada', v_nombre;
    END IF;

    EXECUTE v_nuevo;
    RAISE NOTICE '% actualizada con FOR UPDATE', v_nombre;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. Eliminar redeem_points_for_booking
--
-- Descuenta puntos y es la unica de las cuatro SIN guard de duplicado: dos
-- llamadas para la misma reserva descontaban dos veces, sin necesidad siquiera
-- de que fueran concurrentes.
--
-- Se elimina en vez de arreglarse porque no la llama nadie. Comprobado el
-- 08-sep-2026:
--
--   - Sin referencias en src/ ni en supabase/functions/.
--   - Ninguna otra funcion de public la menciona.
--   - Ningun trigger la usa.
--   - proacl = {postgres=X/postgres, service_role=X/postgres}: NO esta
--     otorgada a anon ni a authenticated, asi que el navegador no puede
--     invocarla por PostgREST ni aunque alguien lo intente.
--
-- Dejarla arreglada seria mantener viva una funcion de dinero que nadie llama;
-- es la misma trampa de mantenimiento que F-2 en la auditoria de frontend.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.redeem_points_for_booking(uuid, integer, numeric);
