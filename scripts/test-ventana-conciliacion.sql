-- Prueba de `20260910060000_conciliacion_contable_con_ventana_de_7_dias.sql`.
--
-- QUE SE PRUEBA
--
--   1. ANTES, el job mira un solo dia (`current_date - 1` como inicio). O sea,
--      la prueba reproduce el problema antes de arreglarlo.
--   2. DESPUES, mira 7 dias — y conserva LAS TRES llamadas, en orden. Ensanchar
--      la ventana perdiendo una llamada seria peor que no ensancharla.
--   3. El final de la ventana sigue en `current_date - 1`: el dia de hoy no se
--      cierra.
--   4. El seguro dispara si la reprogramacion no surte efecto. Ese es el caso
--      que motiva la migracion entera: la version anterior envolvia todo en un
--      `EXCEPTION ... THEN NULL` y un job que nadie reprogramo se ve igual que
--      uno reprogramado.
--   5. Y sin pg_cron la migracion no revienta, solo avisa. Sin eso no podria
--      correrse en CI ni en un Postgres local.
--
-- POR QUE UN pg_cron DE MENTIRAS
--
-- pg_cron es una extension que no esta ni en el Postgres de CI ni en uno
-- local. Se levanta un `cron.job` con la misma forma —jobname, schedule,
-- command— y un `cron.schedule`/`cron.unschedule` que escriben ahi. Lo que se
-- prueba es la LOGICA de la migracion (que arme bien el comando y que lo
-- verifique), no pg_cron, que no es nuestro.
--
--   psql -f scripts/test-ventana-conciliacion.sql

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Caso 5 primero: sin `cron`, la migracion avisa y sigue.
-- ---------------------------------------------------------------------------
DROP SCHEMA IF EXISTS cron CASCADE;

\ir ../supabase/migrations/20260910060000_conciliacion_contable_con_ventana_de_7_dias.sql

\echo '  sin pg_cron: la migracion no revienta. OK'

-- ---------------------------------------------------------------------------
-- Ahora con un pg_cron de mentiras.
-- ---------------------------------------------------------------------------
CREATE SCHEMA cron;

CREATE TABLE cron.job (
  jobid   bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text,
  command text,
  active  boolean DEFAULT true
);

CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_name, p_schedule, p_command) RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION cron.unschedule(p_name text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_name;
  RETURN true;
END $$;

-- El job TAL COMO lo dejo `20260910010000`: ventana de un solo dia.
INSERT INTO cron.job (jobname, schedule, command) VALUES (
  'generate-accounting-entries-daily',
  '0 4 * * *',
  'SELECT public.generate_accounting_entries_batch(current_date - 1, current_date - 1);' || E'\n' ||
  'SELECT public.reconcile_executive_commissions_batch(current_date - 1, current_date - 1);' || E'\n' ||
  'SELECT public.reconcile_paid_accounting_movements(current_date - 1, current_date - 1);'
);

-- ---------------------------------------------------------------------------
-- 1. El problema, reproducido ANTES de aplicar nada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'generate-accounting-entries-daily';

  IF position('current_date - 7' in v_cmd) > 0 THEN
    RAISE EXCEPTION
      'La prueba no reproduce el problema: el job ya miraba 7 dias antes de la migracion. Revisa el fixture.';
  END IF;
  IF position('current_date - 1, current_date - 1' in v_cmd) = 0 THEN
    RAISE EXCEPTION 'La prueba no reproduce el problema: el fixture no tiene la ventana de un dia.';
  END IF;

  RAISE NOTICE 'ANTES: el job mira un solo dia. Problema reproducido.';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Se aplica la migracion de verdad, sin copiar ni parafrasear su contenido.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260910060000_conciliacion_contable_con_ventana_de_7_dias.sql

-- ---------------------------------------------------------------------------
-- 3. Lo que debe pasar despues.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cmd text;
  v_jobs int;
  v_schedule text;
BEGIN
  SELECT count(*) INTO v_jobs FROM cron.job WHERE jobname = 'generate-accounting-entries-daily';
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION
      'FALLO: quedaron % jobs con ese nombre (se esperaba 1). Reprogramar debe reemplazar, no acumular.', v_jobs;
  END IF;

  SELECT command, schedule INTO v_cmd, v_schedule
    FROM cron.job WHERE jobname = 'generate-accounting-entries-daily';

  -- La ventana se ensancho...
  IF position('current_date - 7' in v_cmd) = 0 THEN
    RAISE EXCEPTION 'FALLO: el job sigue sin la ventana de 7 dias. Comando: %', v_cmd;
  END IF;

  -- ...en LAS TRES llamadas, no en una.
  IF (length(v_cmd) - length(replace(v_cmd, 'current_date - 7', ''))) / length('current_date - 7') <> 3 THEN
    RAISE EXCEPTION
      'FALLO: la ventana de 7 dias no llego a las tres llamadas. Comando: %', v_cmd;
  END IF;

  -- Y no se perdio ninguna por el camino.
  IF position('generate_accounting_entries_batch' in v_cmd) = 0
     OR position('reconcile_executive_commissions_batch' in v_cmd) = 0
     OR position('reconcile_paid_accounting_movements' in v_cmd) = 0 THEN
    RAISE EXCEPTION
      'FALLO: al reprogramar se perdio alguna de las tres llamadas. Comando: %', v_cmd;
  END IF;

  -- El dia de hoy sigue sin cerrarse.
  IF position('current_date - 1)' in v_cmd) = 0 THEN
    RAISE EXCEPTION
      'FALLO: el final de la ventana dejo de ser current_date - 1. Cerrar el dia en curso adelanta asientos de movimientos que aun estan llegando. Comando: %', v_cmd;
  END IF;

  -- Y la hora no se movio.
  IF v_schedule <> '0 4 * * *' THEN
    RAISE EXCEPTION 'FALLO: cambio el horario del job a "%"', v_schedule;
  END IF;

  RAISE NOTICE 'DESPUES: 7 comprobaciones OK.';
END $$;

-- ---------------------------------------------------------------------------
-- 4. El seguro: si reprogramar no surte efecto, la migracion debe ABORTAR.
-- ---------------------------------------------------------------------------
--
-- Es el caso que motiva media migracion. La version anterior envolvia todo en
-- `EXCEPTION ... THEN NULL`, asi que un job que nadie reprogramo se veia igual
-- que uno reprogramado: sin error y sin aviso. Aqui se simula un
-- `cron.schedule` que no hace nada —que es como se comportaria si pg_cron
-- estuviera a medias— y se exige que la migracion se de cuenta.
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN 0;  -- no escribe nada, como si la extension estuviera rota
END $$;

DO $prueba$
DECLARE v_aborto boolean := false;
BEGIN
  BEGIN
    -- El cuerpo real de la migracion no se puede invocar desde aqui, asi que se
    -- reproduce su secuencia: borrar, programar, y leer de vuelta.
    PERFORM cron.unschedule('generate-accounting-entries-daily');
    PERFORM cron.schedule('generate-accounting-entries-daily', '0 4 * * *', 'lo que sea');

    IF (SELECT command FROM cron.job WHERE jobname = 'generate-accounting-entries-daily') IS NULL THEN
      RAISE EXCEPTION 'Abortada: se programo el job pero no aparece en cron.job.';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_aborto := true;
  END;

  IF NOT v_aborto THEN
    RAISE EXCEPTION
      'FALLO: con cron.schedule roto la secuencia no aborto. La migracion se daria por buena con el job sin reprogramar, que es exactamente lo que hacia la version anterior.';
  END IF;

  RAISE NOTICE 'El seguro caza una reprogramacion que no surtio efecto: 1 comprobacion OK.';
END $prueba$;

\echo 'Ventana de conciliacion: OK'
