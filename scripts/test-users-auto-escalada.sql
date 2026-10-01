-- Prueba de `20261001010000_users_bloquea_auto_escalada.sql`.
--
-- Corre la migracion CONTRA UN POSTGRES DE VERDAD, con la politica de UPDATE y
-- los helpers (is_super_admin, requires_aal2_check, has_aal2) copiados de
-- produccion el 01-oct-2026, y comprueba:
--
--   1. ANTES de la migracion, un viajero se hace super admin. La prueba
--      reproduce el hueco antes de taparlo.
--   2. DESPUES, ni el viajero ni la agencia ni el bloqueado pueden tocar
--      ninguna de las seis columnas.
--   3. Lo que NO se puede romper: el viajero sigue editando su perfil
--      (nombre, telefono), y reenviar el mismo valor no cuenta como cambio.
--   4. El super admin sigue aprobando y bloqueando — y, con el MFA de admins
--      activado, sin aal2 ya no.
--   5. service_role y las funciones SECURITY DEFINER pasan.
--
-- Como correrla (Postgres local, sin tocar nada remoto):
--
--   psql -f scripts/test-users-auto-escalada.sql

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Copia minima del esquema.
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

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;

-- auth.uid() y auth.jwt() de mentiras: leen variables de sesion para poder
-- cambiar de usuario y de AAL dentro de la misma conexion.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1'));
$$;

DROP TABLE IF EXISTS public.users, public.platform_settings CASCADE;

-- Tipos, nulabilidad y defaults de las seis columnas: los de produccion.
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

-- La politica de UPDATE, tal cual esta en produccion.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select para la prueba" ON public.users FOR SELECT USING (true);

CREATE POLICY "Users and super admins can update users" ON public.users
FOR UPDATE
USING      (((SELECT auth.uid()) = id) OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2())))
WITH CHECK (((SELECT auth.uid()) = id) OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2())));

GRANT SELECT, UPDATE ON public.users TO authenticated, anon, service_role;
GRANT SELECT ON public.platform_settings TO authenticated, anon, service_role;

-- Una funcion SECURITY DEFINER que escribe una columna protegida, como
-- update_user_no_show_count en produccion. La crea el superusuario de la
-- prueba, asi que current_user dentro de ella es ese superusuario.
CREATE OR REPLACE FUNCTION public.sumar_no_show(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.users SET no_show_count = no_show_count + 1 WHERE id = p_user;
$$;
GRANT EXECUTE ON FUNCTION public.sumar_no_show(uuid) TO authenticated;

INSERT INTO public.users (id, role, is_super_admin, is_active, is_approved, email_verified) VALUES
  ('11111111-1111-1111-1111-111111111111', 'traveler', false, true,  false, false), -- viajero
  ('22222222-2222-2222-2222-222222222222', 'agency',   false, true,  false, true),  -- agencia sin aprobar
  ('33333333-3333-3333-3333-333333333333', 'traveler', false, false, false, true),  -- viajero bloqueado
  ('44444444-4444-4444-4444-444444444444', 'admin',    true,  true,  true,  true),  -- super admin
  ('55555555-5555-5555-5555-555555555555', 'traveler', false, true,  false, true);  -- victima del super admin

-- ---------------------------------------------------------------------------
-- 1. ANTES de la migracion: el hueco existe.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
UPDATE public.users SET role = 'admin', is_super_admin = true
 WHERE id = '11111111-1111-1111-1111-111111111111';
DO $antes$ BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'La prueba no reproduce el hueco: sin la migracion el viajero deberia poder hacerse super admin';
  END IF;
  RAISE NOTICE 'ANTES: un viajero se hizo super admin desde su propia sesion. Hueco reproducido.';
END $antes$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- 2. Se aplica la migracion de verdad, sin copiar ni parafrasear su contenido.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20261001010000_users_bloquea_auto_escalada.sql


-- Intenta un UPDATE como `authenticated` con el uid y el aal dados. Devuelve
-- 'rechazado' si salio 42501, o el numero de filas que toco. Cualquier OTRO
-- error se propaga: un fallo distinto no es "bloqueado", es la prueba rota.
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
  v_viajero   constant uuid := '11111111-1111-1111-1111-111111111111';
  v_agencia   constant uuid := '22222222-2222-2222-2222-222222222222';
  v_bloqueado constant uuid := '33333333-3333-3333-3333-333333333333';
  v_super     constant uuid := '44444444-4444-4444-4444-444444444444';
  v_victima   constant uuid := '55555555-5555-5555-5555-555555555555';
  v_caso record;
  v_r text;
  v_fila public.users;
BEGIN
  -- --- 2. Nadie se sube nada a si mismo --------------------------------------
  -- Cada columna POR SEPARADO: si el trigger solo mirara `role`, un caso que
  -- cambiara role e is_super_admin juntos pasaria igual y no lo veriamos.
  FOR v_caso IN
    SELECT * FROM (VALUES
      (v_viajero,   'role = ''admin'''),
      (v_viajero,   'is_super_admin = true'),
      (v_agencia,   'is_approved = true'),
      (v_bloqueado, 'is_active = true'),
      (v_viajero,   'email_verified = true'),
      (v_viajero,   'no_show_count = no_show_count - 1')
    ) AS t(uid, cambio)
  LOOP
    v_r := pg_temp.intentar(v_caso.uid, 'aal1',
      format('UPDATE public.users SET %s WHERE id = %L', v_caso.cambio, v_caso.uid));
    IF v_r <> 'rechazado' THEN
      RAISE EXCEPTION 'FALLO: un usuario sin privilegios pudo hacer "%" sobre su propia fila (resultado: % filas)',
        v_caso.cambio, v_r;
    END IF;
  END LOOP;
  RAISE NOTICE 'DESPUES: las seis columnas rechazadas, una por una.';

  -- --- 3. Lo que NO se puede romper: editar el propio perfil -----------------
  v_r := pg_temp.intentar(v_viajero, 'aal1',
    format('UPDATE public.users SET first_name = ''Ana'', phone_number = ''+525500000000'' WHERE id = %L', v_viajero));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: el viajero ya no puede editar su nombre y telefono (resultado: %). Se rompio "Mi perfil".', v_r;
  END IF;

  -- Reenviar la fila entera, con los valores protegidos SIN cambiar, no es un
  -- cambio. Un formulario que hace update({...perfil}) no se puede romper.
  v_r := pg_temp.intentar(v_viajero, 'aal1',
    format('UPDATE public.users SET first_name = ''Ana Maria'', role = ''traveler'', is_super_admin = false, is_active = true, email_verified = false, no_show_count = 0 WHERE id = %L', v_viajero));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: reenviar los mismos valores protegidos se rechaza (resultado: %). Debe compararse con IS DISTINCT FROM.', v_r;
  END IF;

  SELECT * INTO v_fila FROM public.users WHERE id = v_viajero;
  IF v_fila.first_name IS DISTINCT FROM 'Ana Maria' OR v_fila.phone_number IS DISTINCT FROM '+525500000000' THEN
    RAISE EXCEPTION 'FALLO: el UPDATE del perfil dijo 1 fila pero no se guardo (nombre %, telefono %)',
      v_fila.first_name, v_fila.phone_number;
  END IF;
  RAISE NOTICE 'DESPUES: el viajero sigue editando su perfil, y reenviar la fila entera no se rechaza.';

  -- --- 4. El super admin sigue administrando ---------------------------------
  v_r := pg_temp.intentar(v_super, 'aal1',
    format('UPDATE public.users SET is_approved = true WHERE id = %L', v_agencia));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: el super admin ya no puede aprobar una agencia (resultado: %)', v_r;
  END IF;

  v_r := pg_temp.intentar(v_super, 'aal1',
    format('UPDATE public.users SET is_active = false WHERE id = %L', v_victima));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: el super admin ya no puede bloquear a un usuario (resultado: %)', v_r;
  END IF;

  SELECT * INTO v_fila FROM public.users WHERE id = v_agencia;
  IF v_fila.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO: la aprobacion dijo 1 fila pero is_approved quedo en %', v_fila.is_approved;
  END IF;
  RAISE NOTICE 'DESPUES: el super admin aprueba y bloquea con el MFA de admins apagado.';

  -- Con el MFA de admins ENCENDIDO, sin aal2 ya no. Sobre su PROPIA fila,
  -- porque sobre una ajena la politica la esconde (0 filas) antes de que el
  -- trigger llegue a mirarla, y eso no probaria el trigger.
  UPDATE public.platform_settings SET mfa_required_for_admins = true;

  v_r := pg_temp.intentar(v_super, 'aal1',
    format('UPDATE public.users SET role = ''super_admin'' WHERE id = %L', v_super));
  IF v_r <> 'rechazado' THEN
    RAISE EXCEPTION 'FALLO: con el MFA de admins activado, un super admin en aal1 cambio su rol (resultado: %)', v_r;
  END IF;

  v_r := pg_temp.intentar(v_super, 'aal2',
    format('UPDATE public.users SET is_active = true WHERE id = %L', v_victima));
  IF v_r <> '1' THEN
    RAISE EXCEPTION 'FALLO: con el MFA de admins activado, un super admin en aal2 no pudo desbloquear (resultado: %)', v_r;
  END IF;

  UPDATE public.platform_settings SET mfa_required_for_admins = false;
  RAISE NOTICE 'DESPUES: con el MFA de admins activado, aal1 se rechaza y aal2 pasa.';

  -- --- 5. Los caminos de servidor pasan --------------------------------------
  -- Funcion SECURITY DEFINER llamada por un usuario cualquiera: current_user
  -- dentro de ella es su dueno, no `authenticated`.
  PERFORM set_config('test.uid', v_agencia::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.sumar_no_show(v_viajero);
  RESET ROLE;

  SELECT * INTO v_fila FROM public.users WHERE id = v_viajero;
  IF v_fila.no_show_count <> 1 THEN
    RAISE EXCEPTION 'FALLO: una funcion SECURITY DEFINER no pudo sumar un no-show (quedo en %)', v_fila.no_show_count;
  END IF;

  -- service_role, sin uid: es como entran las Edge Functions.
  PERFORM set_config('test.uid', '', true);
  SET LOCAL ROLE service_role;
  UPDATE public.users SET email_verified = true WHERE id = v_viajero;
  RESET ROLE;

  SELECT * INTO v_fila FROM public.users WHERE id = v_viajero;
  IF v_fila.email_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO: service_role no pudo marcar el correo como verificado';
  END IF;
  RAISE NOTICE 'DESPUES: funciones SECURITY DEFINER y service_role pasan.';
END $despues$;

\echo 'OK: users ya no deja que nadie se suba privilegios desde su propia sesion.'
