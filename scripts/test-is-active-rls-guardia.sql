-- Prueba del SEGURO de `20260909220350_rls_respeta_is_active_al_decidir_rol.sql`.
--
-- Va en un archivo aparte de `test-is-active-rls.sql` porque aqui la migracion
-- tiene que FALLAR, y con `ON_ERROR_STOP on` un fallo se lleva por delante el
-- resto del script.
--
-- QUE SE PRUEBA, Y POR QUE ES LA PRUEBA QUE MAS IMPORTA DE LAS DOS
--
-- Hoy hay UNA sola cuenta de super admin, y es con la que se gestiona toda la
-- plataforma. Si su fila tuviera `is_active = false` por un dedazo, aplicar la
-- migracion la dejaria sin acceso y sin nadie que pudiera devolverselo.
--
-- La primera version de la migracion tenia el seguro en un `DO` y el resto en
-- sentencias sueltas, y esta prueba la reprobo: en autocommit el seguro
-- disparaba y las sentencias siguientes se ejecutaban IGUAL. Por eso la
-- migracion entera vive hoy dentro de un solo bloque `DO`, y por eso esto se
-- corre SIN transaccion a proposito: es el peor caso, no el comodo.
--
--   psql -f scripts/test-is-active-rls-guardia.sql

\set ON_ERROR_STOP on
\set QUIET on

CREATE SCHEMA IF NOT EXISTS auth;

DO $crear$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END $crear$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

DROP TABLE IF EXISTS public.users CASCADE;
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text,
  role text,
  is_super_admin boolean DEFAULT false,
  is_active boolean DEFAULT true
);

-- El escenario que el seguro debe cazar: el unico super admin, bloqueado.
--
-- El SEGUNDO admin, activo y sin super, esta aqui a proposito: sin el, el otro
-- seguro de la migracion ("no quedaria ningun admin activo") tapaba a este y la
-- prueba pasaba aunque el seguro del super admin no existiera. Con el, solo el
-- seguro del super admin puede evitar el desastre, que es lo que se quiere
-- probar.
INSERT INTO public.users (id, email, role, is_super_admin, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@toursred.com',  'admin',    true,  false),
  ('22222222-2222-2222-2222-222222222222', 'otroadmin@ejemplo.com','admin',   false, true),
  ('33333333-3333-3333-3333-333333333333', 'viejo@ejemplo.com',   'traveler', false, NULL);

-- ---------------------------------------------------------------------------
-- Se aplica el archivo REAL, en autocommit. Debe abortar y no dejar rastro.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP off
\ir ../supabase/migrations/20260909220350_rls_respeta_is_active_al_decidir_rol.sql
\set ON_ERROR_STOP on

DO $prueba$
DECLARE
  v_notnull boolean;
  v_nulos int;
  v_helper_endurecido boolean;
BEGIN
  -- 1. No alcanzo a tocar la tabla.
  SELECT attnotnull INTO v_notnull
  FROM pg_attribute
  WHERE attrelid = 'public.users'::regclass AND attname = 'is_active';

  IF v_notnull THEN
    RAISE EXCEPTION
      'FALLO: la migracion aborto pero igual puso is_active NOT NULL. El seguro no es atomico: revisa que TODO viva dentro del bloque DO.';
  END IF;

  SELECT count(*) INTO v_nulos FROM public.users WHERE is_active IS NULL;
  IF v_nulos <> 1 THEN
    RAISE EXCEPTION 'FALLO: la migracion aborto pero igual normalizo los NULL (quedan %, se esperaba 1)', v_nulos;
  END IF;

  -- 2. Y sobre todo: no alcanzo a endurecer los helpers, que es lo que habria
  --    dejado al super admin sin acceso.
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'current_user_has_role' AND prosrc LIKE '%is_active%'
  ) INTO v_helper_endurecido;

  IF v_helper_endurecido THEN
    RAISE EXCEPTION
      'FALLO: la migracion aborto pero igual reescribio current_user_has_role. El unico super admin se habria quedado fuera.';
  END IF;

  RAISE NOTICE 'El seguro aborto y no dejo la base a medias: 4 comprobaciones OK.';
END $prueba$;

\echo 'Seguro de is_active: OK'
