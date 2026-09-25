-- ============================================================================
-- El sexo del viajero llega a la base
-- ============================================================================
--
-- Prueba `20260912010000_sexo_del_viajero.sql` contra un Postgres de verdad y
-- sobre la migracion REAL que define `create_booking_atomic` — no sobre una
-- funcion inventada. Se puede porque plpgsql no valida las tablas del cuerpo al
-- crear la funcion, asi que sus 743 lineas se cargan sobre una base vacia.
--
-- Eso importa: el parche es un `replace` de dos trozos exactos, asi que la
-- unica prueba que vale algo es la que corre contra el texto de verdad. Con una
-- funcion de mentira el `replace` acertaria siempre.
--
-- QUE CUBRE
--
--   1. Las dos columnas existen, en `booking_travelers` y en
--      `frequent_companions`.
--   2. El CHECK acepta los tres valores y NULL, y rechaza cualquier otro.
--   3. `create_booking_atomic` escribe `sexo` en su INSERT.
--   4. EJECUTANDO el INSERT parcheado: los tres valores se guardan, y uno
--      desconocido cae en NULL SIN reventar. Es el caso que decide el diseno —
--      si dependiera del CHECK, un front viejo abortaria la reserva entera.
--   5. La migracion es reaplicable: correrla dos veces no falla ni duplica.
--   6. La funcion conserva SECURITY DEFINER y su search_path.
--
--   psql -f scripts/test-sexo-del-viajero.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- Lo minimo que las dos ALTER necesitan.
CREATE TABLE public.booking_travelers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  nombre text, apellido text, email text, telefono text,
  fecha_nacimiento date, documento_tipo text, documento_numero text,
  categoria_viajero text, precio_aplicado numeric,
  emergency_contact_name text, emergency_contact_phone text
);
CREATE TABLE public.frequent_companions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, nombre text, apellido text
);

-- La funcion REAL, tal cual esta en el repo.
\ir ../supabase/migrations/20260830185226_fix_create_booking_atomic_auth_check.sql
-- Y el cambio que se prueba.
\ir ../supabase/migrations/20260912010000_sexo_del_viajero.sql

DO $prueba$
DECLARE
  v_src        text;
  v_insert     text;
  v_n          int;
  v_guardado   text;
  v_esperado   text;
  v_fallo      boolean;
BEGIN
  -- =========================================================================
  -- 1. Las dos columnas
  -- =========================================================================
  FOR v_n IN
    SELECT 1 FROM (VALUES ('booking_travelers'), ('frequent_companions')) t(tabla)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name=t.tabla AND column_name='sexo')
  LOOP
    RAISE EXCEPTION 'Caso 1: falta la columna sexo en alguna de las dos tablas';
  END LOOP;

  -- =========================================================================
  -- 2. El CHECK: acepta los tres y NULL, rechaza el resto
  -- =========================================================================
  INSERT INTO public.booking_travelers (nombre, sexo) VALUES ('a','masculino'),('b','femenino'),('c','no_binario'),('d',NULL);
  IF (SELECT count(*) FROM public.booking_travelers) <> 4 THEN
    RAISE EXCEPTION 'Caso 2: no se guardaron los cuatro valores validos';
  END IF;

  v_fallo := false;
  BEGIN
    INSERT INTO public.booking_travelers (nombre, sexo) VALUES ('e','M');
  EXCEPTION WHEN check_violation THEN v_fallo := true;
  END;
  IF NOT v_fallo THEN
    RAISE EXCEPTION 'Caso 2: el CHECK dejo pasar un valor fuera del dominio';
  END IF;
  DELETE FROM public.booking_travelers;

  -- =========================================================================
  -- 3. La funcion escribe el sexo
  -- =========================================================================
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_booking_atomic';

  IF position(E'emergency_contact_phone, sexo' in v_src) = 0 THEN
    RAISE EXCEPTION 'Caso 3: la lista de columnas del INSERT no incluye sexo';
  END IF;
  IF position('''no_binario''' in v_src) = 0 THEN
    RAISE EXCEPTION 'Caso 3: la funcion no mapea no_binario';
  END IF;

  -- =========================================================================
  -- 4. EJECUTAR el INSERT parcheado, que es lo unico que prueba el diseno
  -- =========================================================================
  -- Se extrae del cuerpo REAL la expresion que decide, y se EVALUA. No una
  -- copia: si manana alguien cambia ese CASE, esta prueba lo ve.
  v_insert := substring(v_src from position('CASE WHEN v_traveler->>''sexo''' in v_src));
  v_insert := substring(v_insert from 1 for position('END' in v_insert) + 2);

  IF v_insert IS NULL OR length(v_insert) < 40 THEN
    RAISE EXCEPTION 'Caso 4: no se pudo extraer el mapeo del cuerpo de la funcion';
  END IF;

  FOREACH v_guardado IN ARRAY ARRAY['masculino','femenino','no_binario'] LOOP
    EXECUTE 'SELECT ' || replace(v_insert, 'v_traveler',
      format('%L::jsonb', json_build_object('sexo', v_guardado)::text)) INTO v_esperado;
    IF v_esperado IS DISTINCT FROM v_guardado THEN
      RAISE EXCEPTION 'Caso 4: % se mapeo a % en vez de conservarse', v_guardado, coalesce(v_esperado,'NULL');
    END IF;
  END LOOP;

  -- Y el que decide el diseno: un valor desconocido cae en NULL, NO revienta.
  FOREACH v_guardado IN ARRAY ARRAY['M','H','otro',''] LOOP
    EXECUTE 'SELECT ' || replace(v_insert, 'v_traveler',
      format('%L::jsonb', json_build_object('sexo', v_guardado)::text)) INTO v_esperado;
    IF v_esperado IS NOT NULL THEN
      RAISE EXCEPTION 'Caso 4: el valor desconocido % no cayo en NULL (dio %) — reventaria la reserva entera', v_guardado, v_esperado;
    END IF;
  END LOOP;

  -- =========================================================================
  -- 6. SECURITY DEFINER y search_path intactos
  -- =========================================================================
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='create_booking_atomic'
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Caso 6: la funcion perdio SECURITY DEFINER o su search_path';
  END IF;

  RAISE NOTICE 'Casos 1-4 y 6 OK';
END $prueba$;

-- =========================================================================
-- 5. Reaplicable: la migracion entera, otra vez
-- =========================================================================
\ir ../supabase/migrations/20260912010000_sexo_del_viajero.sql

DO $reaplicar$
DECLARE v_src text; v_veces int;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_booking_atomic';
  v_veces := (length(v_src) - length(replace(v_src, 'emergency_contact_phone, sexo', ''))) / length('emergency_contact_phone, sexo');
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'Caso 5: reaplicar duplico el parche (% veces)', v_veces;
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname='booking_travelers_sexo_check') <> 1 THEN
    RAISE EXCEPTION 'Caso 5: reaplicar duplico el CHECK';
  END IF;
  RAISE NOTICE 'Caso 5 OK';
END $reaplicar$;

ROLLBACK;
\echo 'Sexo del viajero: 6/6 casos OK'
