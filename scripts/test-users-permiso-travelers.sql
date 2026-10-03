-- Prueba de `20261002010000_users_permiso_travelers_puede_activar.sql`.
--
-- Mismo arnes que test-users-auto-escalada.sql (esquema minimo, auth.uid()/
-- auth.jwt() de mentiras por variables de sesion), extendido con
-- has_manage_travelers_permission() y admin_permissions. Corre la migracion
-- 20261001010000 (base) y la nueva CONTRA UN POSTGRES DE VERDAD, y comprueba:
--
--   1. Un admin con can_manage_travelers=true activa/desactiva un viajero.
--   2. Lo mismo, pero el mismo admin NO puede tocar una fila que no sea
--      traveler (agencia, otro admin): la politica la esconde, 0 filas.
--   3. El mismo admin NO puede tocar role/is_super_admin/is_approved/
--      email_verified/no_show_count de NADIE, ni de un viajero.
--   4. Un admin SIN el permiso sigue sin poder tocar ninguna fila ajena.
--   5. Con el MFA de admins activado, el carve-out exige aal2 igual que el
--      super admin.
--
-- Como correrla (Postgres local, sin tocar nada remoto):
--
--   psql -f scripts/test-users-permiso-travelers.sql

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Copia minima del esquema (igual a test-users-auto-escalada.sql).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

DO $crear$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $crear$;

ALTER ROLE service_role BYPASSRLS;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1'));
$$;

DROP TABLE IF EXISTS public.users, public.platform_settings, public.admin_permissions CASCADE;

CREATE TABLE public.users (
  id             uuid PRIMARY KEY,
  role           text    NOT NULL,
  is_super_admin boolean DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  is_approved    boolean DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false,
  no_show_count  integer NOT NULL DEFAULT 0,
  first_name     text,
  phone_number   text
);

CREATE TABLE public.platform_settings (
  mfa_required_for_admins     boolean,
  mfa_required_for_accountant boolean
);
INSERT INTO public.platform_settings VALUES (false, false);

-- Como en produccion: user_id referencia users, can_manage_travelers default
-- false (ver 20251229181146_add_can_manage_travelers_permission.sql).
CREATE TABLE public.admin_permissions (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  can_manage_travelers boolean DEFAULT false
);

-- Helpers, copiados de produccion.
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'super_admin'));
$$;

CREATE OR REPLACE FUNCTION public.is_accountant_user() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'accountant');
$$;

CREATE OR REPLACE FUNCTION public.has_aal2() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce(auth.jwt()->>'aal', '') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION public.requires_aal2_check() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin_toggle boolean := false;
  v_accountant_toggle boolean := false;
BEGIN
  SELECT COALESCE(mfa_required_for_admins, false), COALESCE(mfa_required_for_accountant, false)
    INTO v_admin_toggle, v_accountant_toggle
    FROM public.platform_settings LIMIT 1;
  IF NOT v_admin_toggle AND NOT v_accountant_toggle THEN RETURN false; END IF;
  IF v_admin_toggle AND public.is_admin_user() THEN RETURN true; END IF;
  IF v_accountant_toggle AND public.is_accountant_user() THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- Copiado de produccion (migracion 20251229181433_add_admin_view_travelers_policy.sql
-- y posteriores que la tocaron): super admin pasa directo, si no es admin no
-- pasa, si es admin mira admin_permissions.
CREATE OR REPLACE FUNCTION public.has_manage_travelers_permission() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  user_role text;
  v_is_admin boolean;
BEGIN
  SELECT role, is_super_admin INTO user_role, v_is_admin
  FROM public.users WHERE id = auth.uid();

  IF v_is_admin = true THEN RETURN true; END IF;
  IF user_role = 'admin' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.admin_permissions
      WHERE user_id = auth.uid() AND can_manage_travelers = true
    );
  END IF;
  RETURN false;
END;
$$;

-- La politica de UPDATE, tal cual estaba en produccion antes de esta migracion.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select para la prueba" ON public.users FOR SELECT USING (true);

CREATE POLICY "Users and super admins can update users" ON public.users
FOR UPDATE
USING      (((SELECT auth.uid()) = id) OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2())))
WITH CHECK (((SELECT auth.uid()) = id) OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2())));

GRANT SELECT, UPDATE ON public.users TO authenticated, anon, service_role;
GRANT SELECT ON public.platform_settings, public.admin_permissions TO authenticated, anon, service_role;

-- El trigger de la entrada 34 (20261001010000), base sobre la que se extiende.
\ir ../supabase/migrations/20261001010000_users_bloquea_auto_escalada.sql

INSERT INTO public.users (id, role, is_super_admin, is_active, is_approved, email_verified) VALUES
  ('11111111-1111-1111-1111-111111111111', 'traveler', false, true,  false, true),  -- viajero
  ('22222222-2222-2222-2222-222222222222', 'agency',   false, true,  false, true),  -- agencia
  ('33333333-3333-3333-3333-333333333333', 'admin',    false, true,  false, true),  -- otro admin (no viajero)
  ('66666666-6666-6666-6666-666666666666', 'admin',    false, true,  false, true),  -- admin con can_manage_travelers
  ('77777777-7777-7777-7777-777777777777', 'admin',    false, true,  false, true);  -- admin SIN el permiso

INSERT INTO public.admin_permissions (user_id, can_manage_travelers) VALUES
  ('66666666-6666-6666-6666-666666666666', true),
  ('77777777-7777-7777-7777-777777777777', false);

-- ---------------------------------------------------------------------------
-- Antes de esta migracion, el permiso es letra muerta: el admin con el
-- permiso no puede ni desactivar a un viajero.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
SET LOCAL ROLE authenticated;
UPDATE public.users SET is_active = false WHERE id = '11111111-1111-1111-1111-111111111111';
DO $antes$ BEGIN
  IF (SELECT is_active FROM public.users WHERE id = '11111111-1111-1111-1111-111111111111') <> true THEN
    RAISE EXCEPTION 'La prueba no reproduce el hueco: sin la migracion, is_active no deberia cambiar';
  END IF;
  RAISE NOTICE 'ANTES: can_manage_travelers no destraba nada. Hueco reproducido.';
END $antes$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Se aplica la migracion de verdad, sin copiar ni parafrasear su contenido.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20261002010000_users_permiso_travelers_puede_activar.sql

CREATE OR REPLACE FUNCTION pg_temp.intentar(p_uid uuid, p_aal text, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_filas integer;
BEGIN
  PERFORM set_config('test.uid', p_uid::text, true);
  PERFORM set_config('test.aal', p_aal, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'rechazado';
  END;
  RESET ROLE;
  RETURN v_filas::text;
END;
$$;

DO $despues$
DECLARE
  v_viajero       constant uuid := '11111111-1111-1111-1111-111111111111';
  v_agencia       constant uuid := '22222222-2222-2222-2222-222222222222';
  v_otro_admin    constant uuid := '33333333-3333-3333-3333-333333333333';
  v_con_permiso   constant uuid := '66666666-6666-6666-6666-666666666666';
  v_sin_permiso   constant uuid := '77777777-7777-7777-7777-777777777777';
  v_r text;
  v_fila public.users;
BEGIN
  -- --- 1. El admin con el permiso activa y desactiva a un viajero -----------
  v_r := pg_temp.intentar(v_con_permiso, 'aal1',
    format('UPDATE public.users SET is_active = false WHERE id = %L', v_viajero));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: el admin con can_manage_travelers no pudo desactivar al viajero (resultado: %)', v_r;
  END IF;

  SELECT * INTO v_fila FROM public.users WHERE id = v_viajero;
  IF v_fila.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALLO: dijo 1 fila pero is_active quedo en %', v_fila.is_active;
  END IF;

  v_r := pg_temp.intentar(v_con_permiso, 'aal1',
    format('UPDATE public.users SET is_active = true WHERE id = %L', v_viajero));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: el admin con can_manage_travelers no pudo reactivar al viajero (resultado: %)', v_r;
  END IF;
  RAISE NOTICE 'DESPUES: el admin con can_manage_travelers activa y desactiva viajeros.';

  -- --- 2. El mismo admin NO toca filas que no son traveler -------------------
  FOR v_r IN
    SELECT pg_temp.intentar(v_con_permiso, 'aal1',
      format('UPDATE public.users SET is_active = false WHERE id = %L', uid))
    FROM (VALUES (v_agencia), (v_otro_admin)) AS t(uid)
  LOOP
    IF v_r <> '0' THEN
      RAISE EXCEPTION 'FALLO: can_manage_travelers alcanzo una fila que no es traveler (resultado: %)', v_r;
    END IF;
  END LOOP;
  RAISE NOTICE 'DESPUES: can_manage_travelers no alcanza agencias ni otros admins.';

  -- --- 3. El mismo admin NO puede tocar las columnas privilegiadas ----------
  -- Ni siquiera sobre el viajero que SI puede desactivar.
  FOR v_r IN
    SELECT pg_temp.intentar(v_con_permiso, 'aal1', cambio)
    FROM (VALUES
      (format('UPDATE public.users SET role = ''admin'' WHERE id = %L', v_viajero)),
      (format('UPDATE public.users SET is_super_admin = true WHERE id = %L', v_viajero)),
      (format('UPDATE public.users SET is_approved = true WHERE id = %L', v_viajero)),
      (format('UPDATE public.users SET email_verified = false WHERE id = %L', v_viajero)),
      (format('UPDATE public.users SET no_show_count = 1 WHERE id = %L', v_viajero)),
      (format('UPDATE public.users SET is_active = false, role = ''admin'' WHERE id = %L', v_viajero))
    ) AS t(cambio)
  LOOP
    IF v_r <> 'rechazado' THEN
      RAISE EXCEPTION 'FALLO: can_manage_travelers pudo cambiar una columna privilegiada distinta de is_active (resultado: %)', v_r;
    END IF;
  END LOOP;
  RAISE NOTICE 'DESPUES: can_manage_travelers sigue sin poder tocar role/is_super_admin/is_approved/email_verified/no_show_count, ni combinado con is_active.';

  -- --- 4. Un admin SIN el permiso sigue sin poder tocar nada ajeno ----------
  v_r := pg_temp.intentar(v_sin_permiso, 'aal1',
    format('UPDATE public.users SET is_active = false WHERE id = %L', v_viajero));
  IF v_r <> '0' THEN
    RAISE EXCEPTION 'FALLO: un admin sin can_manage_travelers pudo tocar al viajero (resultado: %)', v_r;
  END IF;
  RAISE NOTICE 'DESPUES: sin el permiso, sigue en 0 filas.';

  -- --- 5. Con el MFA de admins encendido, el carve-out exige aal2 ----------
  UPDATE public.platform_settings SET mfa_required_for_admins = true;

  v_r := pg_temp.intentar(v_con_permiso, 'aal1',
    format('UPDATE public.users SET is_active = false WHERE id = %L', v_viajero));
  IF v_r <> '0' THEN
    RAISE EXCEPTION 'FALLO: con MFA de admins activado y aal1, can_manage_travelers igual pudo tocar la fila (resultado: %)', v_r;
  END IF;

  v_r := pg_temp.intentar(v_con_permiso, 'aal2',
    format('UPDATE public.users SET is_active = false WHERE id = %L', v_viajero));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: con MFA de admins activado y aal2, can_manage_travelers no pudo tocar la fila (resultado: %)', v_r;
  END IF;

  UPDATE public.platform_settings SET mfa_required_for_admins = false;
  RAISE NOTICE 'DESPUES: con el MFA de admins activado, el carve-out exige aal2 igual que el super admin.';
END $despues$;

\echo 'OK: can_manage_travelers ya puede activar/desactivar viajeros, y solo eso.'
