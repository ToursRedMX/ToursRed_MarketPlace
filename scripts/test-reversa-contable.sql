-- ============================================================================
-- Reverso de poliza contable (pendiente 12 de la entrada 33)
-- ============================================================================
--
-- No existia una forma de reversar una poliza publicada: las tres primeras
-- reversas del ERP (D-2026-10-0002 a 0004) se armaron a mano, invirtiendo
-- cada partida y llamando a `create_accounting_entry_atomic` con
-- `source_type = 'manual'`. `reverse_accounting_entry` automatiza ese mismo
-- patron. Corre contra un Postgres de verdad, sobre la cadena real de
-- funciones y triggers de contabilidad (fixture-movimientos.sql +
-- `create_accounting_entry_atomic` real, copiada tal cual de la migracion
-- de endurecimiento), no sobre un esquema inventado.
--
-- QUE CUBRE Y POR QUE
--
--   1. Reversar invierte cargo/abono de cada partida y publica de una vez.
--   2. Es idempotente: reversar dos veces la misma poliza devuelve la MISMA
--      reversa, no crea una segunda (hereda la deduplicacion de
--      create_accounting_entry_atomic por source_type+source_id).
--   3. No se puede reversar un borrador (no esta publicado, se edita o se
--      borra directo).
--   4. Una poliza que no existe falla con mensaje claro, no un error generico.
--   5. Exige un motivo; en blanco o NULL se rechaza.
--   6/7. Permiso: admin o contador activo pueden; cualquier otro rol, o una
--      contadora BLOQUEADA (aunque sea super_admin: bloquear gana), no.
--   8. Un llamador sin sesion (service_role, cron) pasa libre -- igual que
--      create_accounting_entry_atomic.
--   9. Un CONTADOR (no admin) puede completar la reversa de punta a punta --
--      esta es la prueba de que el permiso interno de
--      create_accounting_entry_atomic tambien se amplio. Sin ese segundo
--      cambio, el contador pasa el primer permiso y choca con "Acceso no
--      autorizado" dentro de la funcion que de verdad escribe el asiento.
--  10. La descripcion de la reversa trae el folio original y el motivo dado.
--
--   psql -f scripts/test-reversa-contable.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

\ir fixture-movimientos.sql

-- El fixture solo trae cuentas de gasto/banco; la poliza de prueba necesita
-- una de ingreso.
INSERT INTO chart_of_accounts VALUES ('401', 'Ingresos por servicios', 'ingreso', true);

-- Un cuarto usuario sin ningun rol de contabilidad, para el caso 6.
INSERT INTO users (id, first_name, last_name, role, is_active, is_super_admin) VALUES
  ('c0000000-0000-0000-0000-0000000000a4', 'Operador', 'SinAcceso', 'tour_operator', true, false);

-- `is_admin_user()`: la usaba (antes de este cambio) create_accounting_entry_atomic.
-- El fixture no la trae porque ninguna prueba anterior la necesitaba.
CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin'));
$$;

-- El fixture no declara el check de entry_type; create_accounting_entry_atomic
-- (real, copiada en la migracion de abajo) lo necesita para 'diario'.
ALTER TABLE accounting_entries DROP CONSTRAINT IF EXISTS accounting_entries_entry_type_check;
ALTER TABLE accounting_entries ADD CONSTRAINT accounting_entries_entry_type_check
  CHECK (entry_type IN ('ingreso', 'egreso', 'diario', 'apertura'));

-- El fixture tampoco trae `updated_at`; create_accounting_entry_atomic SI la
-- escribe al publicar.
ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- La pieza real bajo prueba: el parche a create_accounting_entry_atomic, el
-- nuevo source_type, y reverse_accounting_entry.
\ir ../supabase/migrations/20261003120000_reverse_accounting_entry.sql

DO $$
DECLARE
  v_original  uuid;
  v_original2 uuid;
  v_original3 uuid;
  v_draft     uuid;
  v_reversa   uuid;
  v_reversa2  uuid;
  v_reversa3  uuid;
  v_reversa4  uuid;
  v_folio     text;
  v_count     integer;
  v_paso      boolean;
  v_d         numeric;
  v_h         numeric;
  v_desc      text;
  v_source    text;
  v_sourceid  uuid;
  v_etype     text;
BEGIN
  -- Sin sesion (service_role/cron) para armar la poliza original: 102 D 500 / 401 H 500.
  PERFORM set_config('prueba.usuario', '', false);
  v_original := create_accounting_entry_atomic(
    'ingreso', 'Venta de prueba', 'booking', gen_random_uuid(), '2026-09-01',
    '[{"account_code":"102","description":"Cobro","debit":500,"credit":0},
      {"account_code":"401","description":"Ingreso","debit":0,"credit":500}]'::jsonb
  );
  SELECT entry_number INTO v_folio FROM accounting_entries WHERE id = v_original;

  -- =========================================================================
  -- 1. Admin reversa: entry_type diario, source_type reversal, partidas invertidas
  -- =========================================================================
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a2', false);
  v_reversa := reverse_accounting_entry(v_original, 'Prueba: dato de prueba eliminado');
  IF v_reversa IS NULL THEN RAISE EXCEPTION 'Caso 1: deberia devolver el id de la reversa'; END IF;

  SELECT entry_type, source_type, source_id INTO v_etype, v_source, v_sourceid
  FROM accounting_entries WHERE id = v_reversa;
  IF v_etype <> 'diario' OR v_source <> 'reversal' OR v_sourceid <> v_original THEN
    RAISE EXCEPTION 'Caso 1: la reversa deberia ser diario/reversal/%, y es %/%/%',
      v_original, v_etype, v_source, v_sourceid;
  END IF;

  SELECT sum(debit) FILTER (WHERE account_code = '401'),
         sum(credit) FILTER (WHERE account_code = '102')
  INTO v_d, v_h FROM accounting_entry_lines WHERE entry_id = v_reversa;
  IF coalesce(v_d, 0) <> 500 OR coalesce(v_h, 0) <> 500 THEN
    RAISE EXCEPTION 'Caso 1: las partidas deberian quedar invertidas (401 D 500 / 102 H 500), y son % / %', v_d, v_h;
  END IF;

  -- =========================================================================
  -- 2. Idempotente: una segunda llamada (de OTRO usuario autorizado, con OTRO
  --    motivo) devuelve la MISMA reversa, no crea una segunda.
  -- =========================================================================
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a1', false);
  v_reversa2 := reverse_accounting_entry(v_original, 'motivo distinto, no deberia importar');
  IF v_reversa2 <> v_reversa THEN
    RAISE EXCEPTION 'Caso 2: debio devolver la misma reversa (%) y devolvio %', v_reversa, v_reversa2;
  END IF;
  SELECT count(*) INTO v_count FROM accounting_entries WHERE source_type = 'reversal' AND source_id = v_original;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Caso 2: debe haber exactamente una reversa de %, y hay %', v_original, v_count;
  END IF;

  -- =========================================================================
  -- 3. Un borrador (is_posted = false) no se puede reversar.
  -- =========================================================================
  INSERT INTO accounting_entries
    (id, entry_number, entry_type, entry_date, period_year, period_month, description, source_type, source_id, is_posted)
  VALUES
    (gen_random_uuid(), 'D-2026-09-9001', 'diario', '2026-09-01', 2026, 9, 'Borrador de prueba', 'manual', gen_random_uuid(), false)
  RETURNING id INTO v_draft;

  BEGIN
    PERFORM reverse_accounting_entry(v_draft, 'motivo');
    RAISE EXCEPTION 'Caso 3: se le permitio reversar algo que no esta publicado';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_desc = MESSAGE_TEXT;
    IF v_desc NOT LIKE '%borrador%' THEN RAISE; END IF;
  END;

  -- =========================================================================
  -- 4. Una poliza que no existe falla con mensaje claro.
  -- =========================================================================
  BEGIN
    PERFORM reverse_accounting_entry(gen_random_uuid(), 'motivo');
    RAISE EXCEPTION 'Caso 4: se le permitio reversar un id que no corresponde a nada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_desc = MESSAGE_TEXT;
    IF v_desc NOT LIKE '%no existe%' THEN RAISE; END IF;
  END;

  -- =========================================================================
  -- 5. Sin motivo (NULL o en blanco) se rechaza.
  -- =========================================================================
  BEGIN
    PERFORM reverse_accounting_entry(v_original, '   ');
    RAISE EXCEPTION 'Caso 5: se le permitio reversar sin dar ninguna razon';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_desc = MESSAGE_TEXT;
    IF v_desc NOT LIKE '%motivo%' THEN RAISE; END IF;
  END;

  -- =========================================================================
  -- 6. Un rol sin nada que ver con contabilidad: rechazado.
  -- =========================================================================
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a4', false);
  v_paso := false;
  BEGIN
    PERFORM reverse_accounting_entry(v_original, 'motivo');
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'Caso 6: un usuario sin rol de contabilidad pudo reversar';
  END IF;

  -- =========================================================================
  -- 7. Contadora BLOQUEADA, aunque sea super_admin: bloquear gana.
  -- =========================================================================
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a3', false);
  v_paso := false;
  BEGIN
    PERFORM reverse_accounting_entry(v_original, 'motivo');
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'Caso 7: una contadora bloqueada pudo reversar por ser super_admin';
  END IF;

  -- =========================================================================
  -- 8. Sin sesion (service_role/cron) pasa libre, sobre una poliza nueva.
  -- =========================================================================
  PERFORM set_config('prueba.usuario', '', false);
  v_original2 := create_accounting_entry_atomic(
    'egreso', 'Gasto de prueba', 'manual', gen_random_uuid(), '2026-09-02',
    '[{"account_code":"601.01","description":"Gasto","debit":100,"credit":0},
      {"account_code":"102","description":"Pago","debit":0,"credit":100}]'::jsonb
  );
  v_reversa3 := reverse_accounting_entry(v_original2, 'cron de limpieza');
  IF v_reversa3 IS NULL THEN
    RAISE EXCEPTION 'Caso 8: sin sesion (service_role) deberia poder reversar';
  END IF;

  -- =========================================================================
  -- 9. Un CONTADOR (no admin) completa la reversa de punta a punta. Prueba
  --    directa de que create_accounting_entry_atomic tambien amplio su
  --    permiso interno -- sin eso, esto choca con "Acceso no autorizado"
  --    DESPUES de pasar el primer chequeo.
  -- =========================================================================
  PERFORM set_config('prueba.usuario', '', false);
  v_original3 := create_accounting_entry_atomic(
    'egreso', 'Otro gasto de prueba', 'manual', gen_random_uuid(), '2026-09-03',
    '[{"account_code":"601.02","description":"Gasto","debit":50,"credit":0},
      {"account_code":"102","description":"Pago","debit":0,"credit":50}]'::jsonb
  );
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a1', false);
  v_reversa4 := reverse_accounting_entry(v_original3, 'contador reversando');
  IF v_reversa4 IS NULL THEN
    RAISE EXCEPTION 'Caso 9: un contador autorizado deberia poder completar la reversa';
  END IF;
  SELECT is_posted INTO v_paso FROM accounting_entries WHERE id = v_reversa4;
  IF NOT v_paso THEN
    RAISE EXCEPTION 'Caso 9: la reversa del contador deberia quedar publicada';
  END IF;

  -- =========================================================================
  -- 10. La descripcion trae el folio original Y el motivo dado.
  -- =========================================================================
  SELECT description INTO v_desc FROM accounting_entries WHERE id = v_reversa;
  IF v_desc NOT LIKE '%' || v_folio || '%' OR v_desc NOT LIKE '%Prueba: dato de prueba eliminado%' THEN
    RAISE EXCEPTION 'Caso 10: la descripcion deberia traer el folio (%) y el motivo, y es: %', v_folio, v_desc;
  END IF;

  RAISE NOTICE 'Los 10 casos de reversa contable OK';
END $$;

ROLLBACK;

\echo 'Reversa de poliza contable: 10/10 casos OK'
