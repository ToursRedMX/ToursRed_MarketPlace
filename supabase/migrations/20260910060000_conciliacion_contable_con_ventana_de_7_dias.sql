-- La conciliacion contable diaria deja de perder los dias que falla.
--
-- ============================================================================
-- QUE PASABA
-- ============================================================================
--
-- El job `generate-accounting-entries-daily` (creado por `20260910010000`)
-- corre a las 04:00 UTC y llama a tres funciones con la MISMA ventana:
--
--     generate_accounting_entries_batch(current_date - 1, current_date - 1)
--     reconcile_executive_commissions_batch(current_date - 1, current_date - 1)
--     reconcile_paid_accounting_movements(current_date - 1, current_date - 1)
--
-- Un solo dia, sin traslape. Y ahi esta el problema: si el job no corre una
-- noche —la base reiniciandose, pg_cron caido, una fila que revienta y aborta
-- la transaccion entera, porque no hay manejo de error por fila— ese dia NO SE
-- VUELVE A MIRAR NUNCA. El movimiento cobrado se queda sin asiento contable
-- para siempre, y nadie se entera, porque al dia siguiente la ventana ya se
-- movio.
--
-- No es hipotetico: el 10-sep-2026, al revisar esto, habia 19 movimientos
-- pagados sin asiento (8 servicios opcionales, 7 seguros, 4 cuotas de plan de
-- pagos). Se barrieron a mano con la ventana de un ano. Esta migracion existe
-- para que no vuelva a hacer falta barrer a mano.
--
-- ============================================================================
-- POR QUE 7 DIAS Y POR QUE ES GRATIS
-- ============================================================================
--
-- Con `current_date - 7` cada movimiento se mira siete noches seguidas. Para
-- perderlo tendrian que fallar siete corridas consecutivas, no una.
--
-- El traslape no cuesta nada porque las tres funciones son IDEMPOTENTES: cada
-- una recorre un `SELECT` cuyo `WHERE` lleva
--
--     AND NOT EXISTS (SELECT 1 FROM accounting_entries ae
--                     WHERE ae.source_type = '<tipo>' AND ae.source_id = <fila>.id)
--
-- o sea que una fila que ya tiene asiento ni siquiera entra al loop. Verificado
-- el 10-sep-2026, y no solo leyendo:
--
--   * `reconcile_paid_accounting_movements` se corrio DOS VECES seguidas
--     contra produccion sobre la ventana de un ano. La primera creo 19
--     asientos; la segunda creo 0 y el total se quedo en 75. Prueba directa.
--
--   * Las otras dos se comprobaron leyendo su cuerpo en `pg_proc`: las 8
--     ramas de `generate_accounting_entries_batch` y la unica de
--     `reconcile_executive_commissions_batch` llevan la misma guardia sobre
--     `(source_type, source_id)`. No se corrieron con ventana ancha a
--     proposito: habria sido escribir en produccion para probar algo que el
--     codigo ya deja claro.
--
-- Se ensancha solo el INICIO de la ventana. El final sigue en `current_date - 1`
-- porque el dia de hoy todavia esta recibiendo movimientos y cerrarlo seria
-- adelantarse.
--
-- ============================================================================
-- POR QUE ESTO NO ARREGLA EL OTRO PROBLEMA
-- ============================================================================
--
-- Sigue sin haber manejo de error POR FILA: si una sola fila hace reventar a
-- su creador, la sentencia entera se deshace y esa noche no se concilia nada.
-- Siete dias de traslape hacen que eso deje de ser permanente —la noche
-- siguiente lo reintenta— pero no es lo mismo que aislar la fila mala. Eso es
-- un cambio dentro de las funciones de Codex y se deja a proposito fuera de
-- aqui: esta migracion cambia UNA cosa, la ventana.

DO $migracion$
DECLARE
  v_comando text;
  v_quedo   text;
BEGIN
  -- El comando, con la unica diferencia respecto de `20260910010000`:
  -- `current_date - 7` como inicio en las tres llamadas.
  v_comando :=
    'SELECT public.generate_accounting_entries_batch(current_date - 7, current_date - 1);' || E'\n' ||
    'SELECT public.reconcile_executive_commissions_batch(current_date - 7, current_date - 1);' || E'\n' ||
    'SELECT public.reconcile_paid_accounting_movements(current_date - 7, current_date - 1);';

  -- pg_cron no existe en un Postgres pelado —ni en el de CI, ni en el local—,
  -- y esta migracion tiene que poder aplicarse ahi para que la prueba la corra
  -- de verdad. Por eso se comprueba antes en vez de dejar que reviente.
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron no esta disponible: no hay job que reprogramar. Nada que hacer.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-accounting-entries-daily') THEN
    PERFORM cron.unschedule('generate-accounting-entries-daily');
  END IF;

  PERFORM cron.schedule('generate-accounting-entries-daily', '0 4 * * *', v_comando);

  -- -------------------------------------------------------------------------
  -- Y se comprueba que quedo. Esto es lo que la version anterior no hacia.
  -- -------------------------------------------------------------------------
  --
  -- `20260910010000` envolvia todo esto en un `EXCEPTION WHEN undefined_table
  -- OR undefined_function THEN NULL`, o sea que si algo salia mal la migracion
  -- se daba por buena y el job quedaba como estuviera —o sin existir—. Un job
  -- que nadie reprogramo se ve exactamente igual que uno reprogramado: no hay
  -- error, no hay aviso. Aqui se lee de vuelta y se exige.
  SELECT command INTO v_quedo FROM cron.job
   WHERE jobname = 'generate-accounting-entries-daily';

  IF v_quedo IS NULL THEN
    RAISE EXCEPTION
      'Abortada: se programo el job pero no aparece en cron.job. Revisa pg_cron antes de reintentar.';
  END IF;

  IF position('current_date - 7' in v_quedo) = 0 THEN
    RAISE EXCEPTION
      'Abortada: el job quedo programado sin la ventana de 7 dias. Comando actual: %', v_quedo;
  END IF;

  IF position('reconcile_paid_accounting_movements' in v_quedo) = 0
     OR position('reconcile_executive_commissions_batch' in v_quedo) = 0
     OR position('generate_accounting_entries_batch' in v_quedo) = 0 THEN
    RAISE EXCEPTION
      'Abortada: al reprogramar se perdio alguna de las tres llamadas. Comando actual: %', v_quedo;
  END IF;

  RAISE NOTICE 'Listo: la conciliacion contable diaria ahora mira 7 dias hacia atras.';
END $migracion$;
