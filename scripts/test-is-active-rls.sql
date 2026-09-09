-- Prueba de `20260909220350_rls_respeta_is_active_al_decidir_rol.sql`.
--
-- Corre la migracion CONTRA UN POSTGRES DE VERDAD sobre una copia minima del
-- esquema, y comprueba las dos cosas que importan:
--
--   1. Antes de la migracion, un admin BLOQUEADO pasa `current_user_has_role`.
--      O sea, la prueba reproduce el bug antes de arreglarlo.
--   2. Despues, no pasa — y nadie mas se queda fuera, en particular quien tiene
--      `is_active` en NULL, que es el dedazo que dejaria a una persona real sin
--      acceso si la condicion fuera `= true`.
--
-- El seguro que aborta la migracion cuando dejaria fuera al unico super admin
-- se prueba aparte, en `test-is-active-rls-guardia.sql`, porque necesita una
-- base en la que la migracion FALLE.
--
-- Como correrla (Postgres 16 local, sin tocar nada remoto):
--
--   psql -f scripts/test-is-active-rls.sql

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Copia minima del esquema: solo lo que la migracion toca o consulta.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

-- Supabase siempre trae este rol; aqui hay que crearlo para que los GRANT de
-- la migracion tengan a quien apuntar.
DO $crear$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END $crear$;

-- `auth.uid()` de mentiras: lee de una variable de sesion para poder cambiar de
-- usuario dentro de la misma conexion.
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
  -- Tal cual nacio en `20251229171833`: DEFAULT true y SIN not null. Esa
  -- nulabilidad es justo lo que hace peligrosa la version con `= true`.
  is_active boolean DEFAULT true
);

INSERT INTO public.users (id, email, role, is_super_admin, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@toursred.com',   'admin',    true,  true),
  ('22222222-2222-2222-2222-222222222222', 'exadmin@ejemplo.com',  'admin',    false, false),
  ('33333333-3333-3333-3333-333333333333', 'viejo@ejemplo.com',    'traveler', false, NULL),
  ('44444444-4444-4444-4444-444444444444', 'agencia@ejemplo.com',  'agency',   false, true);

-- Helpers TAL COMO ESTABAN antes de la migracion (`20260527231929`).
CREATE OR REPLACE FUNCTION public.current_user_has_role(check_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = ANY (check_roles));
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- 1. El bug, reproducido ANTES de aplicar nada.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'La prueba no reproduce el bug: el admin bloqueado ya no pasaba antes de la migracion. Revisa el fixture.';
  END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'La prueba no reproduce el bug en current_user_is_admin.';
  END IF;

  RAISE NOTICE 'ANTES: el admin bloqueado pasa como admin. Bug reproducido.';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Se aplica la migracion de verdad, sin copiar ni parafrasear su contenido.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260909220350_rls_respeta_is_active_al_decidir_rol.sql

-- ---------------------------------------------------------------------------
-- 3. Lo que debe pasar despues.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nulos int;
  v_notnull boolean;
BEGIN
  -- El bloqueado ya no es admin.
  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  IF public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'FALLO: el admin bloqueado sigue pasando current_user_has_role';
  END IF;
  IF public.current_user_is_admin() THEN
    RAISE EXCEPTION 'FALLO: el admin bloqueado sigue pasando current_user_is_admin';
  END IF;

  -- El admin activo sigue entrando. Si esto falla, se bloqueo la plataforma.
  PERFORM set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  IF NOT public.current_user_has_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'FALLO GRAVE: el admin activo dejo de ser admin';
  END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'FALLO GRAVE: el admin activo dejo de pasar current_user_is_admin';
  END IF;

  -- El que tenia is_active NULL sigue funcionando: la migracion se lo
  -- normalizo a true.
  PERFORM set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
  IF NOT public.current_user_has_role(ARRAY['traveler']) THEN
    RAISE EXCEPTION 'FALLO: el usuario que tenia is_active NULL perdio su rol';
  END IF;

  -- La agencia no se convirtio en admin de rebote.
  PERFORM set_config('test.uid', '44444444-4444-4444-4444-444444444444', false);
  IF public.current_user_is_admin() THEN
    RAISE EXCEPTION 'FALLO: una agencia pasa como admin';
  END IF;
  IF NOT public.current_user_has_role(ARRAY['agency']) THEN
    RAISE EXCEPTION 'FALLO: la agencia perdio su rol';
  END IF;

  -- Los NULL se normalizaron y la columna quedo sin ambiguedad.
  SELECT count(*) INTO v_nulos FROM public.users WHERE is_active IS NULL;
  IF v_nulos <> 0 THEN
    RAISE EXCEPTION 'FALLO: quedaron % filas con is_active NULL', v_nulos;
  END IF;

  SELECT attnotnull INTO v_notnull
  FROM pg_attribute
  WHERE attrelid = 'public.users'::regclass AND attname = 'is_active';
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'FALLO: is_active siguio siendo nullable';
  END IF;

  -- El operador, probado de verdad. Ojo con el orden: la migracion normaliza
  -- los NULL ANTES de reescribir los helpers, asi que despues de aplicarla ya
  -- no queda ninguno y comprobar "el usuario NULL entra" no prueba nada — la
  -- primera version de esta prueba caia justo ahi y pasaba con `= true`.
  --
  -- Para probar el operador hay que reintroducir un NULL a la fuerza. No es un
  -- escenario inventado: es lo que pasaria si alguien mas adelante quitara el
  -- NOT NULL, y es la unica razon por la que vale la pena que la condicion sea
  -- `IS DISTINCT FROM false` en vez de `= true`.
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN is_active DROP NOT NULL';
  UPDATE public.users SET is_active = NULL
   WHERE id = '33333333-3333-3333-3333-333333333333';

  PERFORM set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
  IF NOT public.current_user_has_role(ARRAY['traveler']) THEN
    RAISE EXCEPTION 'FALLO: con is_active NULL el usuario pierde su rol. La condicion esta escrita como `= true` en vez de `IS DISTINCT FROM false`, asi que si alguien quita el NOT NULL la gente se queda fuera en silencio';
  END IF;

  UPDATE public.users SET is_active = true
   WHERE id = '33333333-3333-3333-3333-333333333333';
  EXECUTE 'ALTER TABLE public.users ALTER COLUMN is_active SET NOT NULL';

  -- Y las funciones conservan lo que las hace seguras.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'current_user_has_role'
      AND prosecdef
      AND 'search_path=public' = ANY (proconfig)
  ) THEN
    RAISE EXCEPTION 'FALLO: current_user_has_role perdio SECURITY DEFINER o su search_path';
  END IF;

  RAISE NOTICE 'DESPUES: 11 comprobaciones OK.';
END $$;

\echo 'is_active en RLS: OK'
