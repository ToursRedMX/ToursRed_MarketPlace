-- Prueba de `20260910050000_bloquear_revoca_la_sesion.sql`.
--
-- Corre la migracion CONTRA UN POSTGRES DE VERDAD sobre una copia minima del
-- esquema `auth` de GoTrue, y comprueba las cinco cosas que importan:
--
--   1. ANTES de la migracion, bloquear deja la sesion viva. O sea, la prueba
--      reproduce el hueco antes de taparlo.
--   2. DESPUES, bloquear borra las sesiones — y las tablas que cuelgan de
--      `auth.sessions` se van por CASCADE, sin que la migracion las nombre.
--   3. El MFA SOBREVIVE. Es lo mas importante de todo: si borrar sesiones
--      desenrolara el segundo factor, desbloquear a alguien lo dejaria sin MFA.
--   4. Solo dispara en la TRANSICION a bloqueado, no en cada UPDATE.
--   5. Y la que de verdad da miedo: si la revocacion FALLA, el bloqueo tiene
--      que quedar escrito igual, con rastro en `audit_errors`. Un error en un
--      trigger AFTER deshace el UPDATE, asi que sin el EXCEPTION un cambio de
--      Supabase en el esquema `auth` haria imposible bloquear a nadie.
--
-- Como correrla (Postgres local, sin tocar nada remoto):
--
--   psql -f scripts/test-revocar-sesion.sql

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Copia minima del esquema, con las MISMAS claves foraneas que produccion.
-- Verificadas contra la base el 10-sep-2026 leyendo pg_constraint: si alguna
-- dejara de ser ON DELETE CASCADE, el caso 2 se pondria rojo.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

DROP TABLE IF EXISTS auth.mfa_amr_claims, auth.refresh_tokens, auth.mfa_factors,
                     auth.sessions, auth.users, public.users, public.audit_errors CASCADE;

CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE auth.refresh_tokens (
  id bigserial PRIMARY KEY,
  session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE
);

CREATE TABLE auth.mfa_amr_claims (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE
);

-- Ojo: cuelga de auth.users, NO de auth.sessions. Esa diferencia es el caso 3.
CREATE TABLE auth.mfa_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text,
  telefono text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.audit_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_message text NOT NULL,
  sqlstate text,
  raw_payload jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Dos usuarios con sesion. El segundo esta para probar que no se lleva por
-- delante a quien no toca.
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

INSERT INTO public.users (id, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'bloqueado@ejemplo.com', 'agency'),
  ('22222222-2222-2222-2222-222222222222', 'tranquilo@ejemplo.com', 'traveler');

-- Al primero se le dan DOS sesiones: la revocacion es por usuario, no por
-- dispositivo, y si solo tuviera una el `DELETE ... WHERE user_id` pasaria
-- aunque estuviera escrito para borrar solo la ultima.
INSERT INTO auth.sessions (id, user_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

INSERT INTO auth.refresh_tokens (session_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002'),
  ('bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO auth.mfa_amr_claims (id, session_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO auth.mfa_factors (id, user_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. El hueco, reproducido ANTES de aplicar nada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_sesiones int;
BEGIN
  UPDATE public.users SET is_active = false
   WHERE id = '11111111-1111-1111-1111-111111111111';

  SELECT count(*) INTO v_sesiones FROM auth.sessions
   WHERE user_id = '11111111-1111-1111-1111-111111111111';

  IF v_sesiones <> 2 THEN
    RAISE EXCEPTION
      'La prueba no reproduce el hueco: bloquear ya revocaba antes de la migracion (quedan % sesiones). Revisa el fixture.', v_sesiones;
  END IF;

  RAISE NOTICE 'ANTES: se bloqueo al usuario y sus 2 sesiones siguen vivas. Hueco reproducido.';

  -- Se deja como estaba para que la migracion trabaje sobre el escenario real.
  UPDATE public.users SET is_active = true
   WHERE id = '11111111-1111-1111-1111-111111111111';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Se aplica la migracion de verdad, sin copiar ni parafrasear su contenido.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260910050000_bloquear_revoca_la_sesion.sql

-- ---------------------------------------------------------------------------
-- 3. Lo que debe pasar despues.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sesiones int;
  v_tokens int;
  v_amr int;
  v_factores int;
  v_ajenas int;
  v_errores int;
  v_activo boolean;
BEGIN
  -- --- Bloqueo: se van las sesiones ----------------------------------------
  UPDATE public.users SET is_active = false
   WHERE id = '11111111-1111-1111-1111-111111111111';

  SELECT count(*) INTO v_sesiones FROM auth.sessions
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF v_sesiones <> 0 THEN
    RAISE EXCEPTION 'FALLO: al bloquear quedaron % sesion(es) vivas', v_sesiones;
  END IF;

  -- --- Y las dependientes por CASCADE, que la migracion NO nombra -----------
  SELECT count(*) INTO v_tokens FROM auth.refresh_tokens rt
   WHERE rt.session_id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                           'aaaaaaaa-0000-0000-0000-000000000002');
  IF v_tokens <> 0 THEN
    RAISE EXCEPTION
      'FALLO: sobrevivieron % refresh_token(s). Sin eso el token se sigue renovando solo, que es justo el bug.', v_tokens;
  END IF;

  SELECT count(*) INTO v_amr FROM auth.mfa_amr_claims
   WHERE session_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF v_amr <> 0 THEN
    RAISE EXCEPTION 'FALLO: sobrevivieron % mfa_amr_claim(s)', v_amr;
  END IF;

  -- --- Lo que NO se puede llevar: el MFA enrolado ---------------------------
  SELECT count(*) INTO v_factores FROM auth.mfa_factors
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF v_factores <> 1 THEN
    RAISE EXCEPTION
      'FALLO GRAVE: revocar la sesion desenrolo el MFA. Al desbloquear, esa cuenta volveria sin segundo factor.';
  END IF;

  -- --- Ni las sesiones de quien no fue bloqueado ----------------------------
  SELECT count(*) INTO v_ajenas FROM auth.sessions
   WHERE user_id = '22222222-2222-2222-2222-222222222222';
  IF v_ajenas <> 1 THEN
    RAISE EXCEPTION 'FALLO: se cerro la sesion de un usuario que nadie bloqueo';
  END IF;

  RAISE NOTICE 'DESPUES: 2 sesiones revocadas con su cascada; MFA y terceros intactos.';

  -- --- Solo la TRANSICION dispara ------------------------------------------
  --
  -- Se le devuelve una sesion al bloqueado y se hace un UPDATE cualquiera. Si
  -- el trigger no mirara la transicion, esa sesion moriria aqui.
  INSERT INTO auth.sessions (id, user_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

  UPDATE public.users SET telefono = '5551234567'
   WHERE id = '11111111-1111-1111-1111-111111111111';

  SELECT count(*) INTO v_sesiones FROM auth.sessions
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF v_sesiones <> 1 THEN
    RAISE EXCEPTION
      'FALLO: un UPDATE que no cambia is_active disparo la revocacion. Falta la clausula WHEN del trigger.';
  END IF;

  -- Y desbloquear tampoco revoca: es la transicion contraria.
  UPDATE public.users SET is_active = true
   WHERE id = '11111111-1111-1111-1111-111111111111';

  SELECT count(*) INTO v_sesiones FROM auth.sessions
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  IF v_sesiones <> 1 THEN
    RAISE EXCEPTION 'FALLO: desbloquear a un usuario le cerro la sesion';
  END IF;

  RAISE NOTICE 'Solo la transicion a bloqueado revoca: 2 comprobaciones OK.';

  -- --- Y la que de verdad importa: si revocar FALLA, el bloqueo persiste ----
  --
  -- Se simula el escenario que motiva el EXCEPTION: Supabase mueve el esquema
  -- `auth` en una actualizacion y `auth.sessions` deja de estar donde estaba.
  -- Sin ese EXCEPTION el error del trigger AFTER desharia el UPDATE y NADIE
  -- podria ser bloqueado — el remedio peor que la enfermedad.
  ALTER TABLE auth.sessions RENAME TO sessions_movida_por_supabase;

  -- El UPDATE va en su propio sub-bloque para poder cazar el error CON UN
  -- MENSAJE UTIL. Sin esto, quitar el EXCEPTION de la migracion hacia que la
  -- prueba fallara con un `relation "auth.sessions" does not exist` crudo, y
  -- quien lo viera en CI pensaria que el fixture esta roto en vez de que
  -- acaba de quitar la red que mantiene el bloqueo en pie.
  BEGIN
    UPDATE public.users SET is_active = false
     WHERE id = '11111111-1111-1111-1111-111111111111';
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE auth.sessions_movida_por_supabase RENAME TO sessions;
    RAISE EXCEPTION
      'FALLO GRAVE: al fallar la revocacion, el error tumbo el UPDATE entero (%). A la funcion del trigger le falta el EXCEPTION: sin el, un cambio de Supabase en el esquema auth deja la plataforma SIN PODER BLOQUEAR A NADIE.', SQLERRM;
  END;

  SELECT is_active INTO v_activo FROM public.users
   WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_activo IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'FALLO GRAVE: la revocacion fallo y se llevo el bloqueo con ella. Bloquear es el control PRIMARIO y no puede depender de que revocar funcione.';
  END IF;

  SELECT count(*) INTO v_errores FROM public.audit_errors
   WHERE raw_payload->>'funcion' = 'revocar_sesiones_al_bloquear'
     AND raw_payload->>'usuario_bloqueado' = '11111111-1111-1111-1111-111111111111';
  IF v_errores <> 1 THEN
    RAISE EXCEPTION
      'FALLO: la revocacion fallo en SILENCIO (% filas en audit_errors, se esperaba 1). Tragarse el error solo vale si deja rastro.', v_errores;
  END IF;

  ALTER TABLE auth.sessions_movida_por_supabase RENAME TO sessions;

  RAISE NOTICE 'Con la revocacion rota, el bloqueo persiste y queda asentado: 2 comprobaciones OK.';

  -- --- La funcion conserva lo que la hace segura ----------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'revocar_sesiones_al_bloquear'
      AND prosecdef
      AND 'search_path=public' = ANY (proconfig)
  ) THEN
    RAISE EXCEPTION
      'FALLO: revocar_sesiones_al_bloquear perdio SECURITY DEFINER o su search_path. Sin DEFINER no puede borrar en el esquema auth.';
  END IF;

  RAISE NOTICE 'Total: 10 comprobaciones OK.';
END $$;

\echo 'Revocar sesion al bloquear: OK'
