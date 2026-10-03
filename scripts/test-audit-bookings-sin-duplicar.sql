-- Prueba de `20261003010000_audit_bookings_sin_duplicar_confirmacion.sql`.
--
-- Corre `audit_bookings_change()` CONTRA UN POSTGRES DE VERDAD y comprueba:
--
--   1. Confirmar una reserva (status -> 'confirmed') deja UNA sola fila
--      BOOKING_CONFIRMED, con payment_method y payment_intent_id en
--      new_values -- antes esos dos datos solo salian de la llamada
--      explicita que hacia stripe-webhook, que esta migracion retira.
--   2. Cancelar y completar siguen dejando su propia fila (BOOKING_CANCELLED,
--      BOOKING_COMPLETED), sin duplicar.
--   3. Un UPDATE que no cambia `status` sigue cayendo en el fallback
--      generico ('UPDATE'), sin volverse BOOKING_CONFIRMED por accidente.
--   4. INSERT y DELETE siguen dejando BOOKING_CREATED y DELETE, sin que el
--      cambio de la rama 'confirmed' los haya tocado.
--
-- Como correrla (Postgres local, sin tocar nada remoto):
--
--   psql -f scripts/test-audit-bookings-sin-duplicar.sql

\set ON_ERROR_STOP on
\set QUIET on

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid; $$;

DROP TABLE IF EXISTS public.audit_logs, public.bookings, public.users CASCADE;

CREATE TABLE public.users (
  id   uuid PRIMARY KEY,
  role text,
  email text
);

CREATE TABLE public.bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status             text NOT NULL DEFAULT 'pending',
  payment_status     text,
  payment_method     text,
  payment_intent_id  text,
  user_id            uuid,
  other_field        text
);

-- Columnas minimas: solo las que esta prueba necesita leer. target_id es
-- TEXT en produccion (insert_audit_log lo recibe como texto), igual aqui.
CREATE TABLE public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,
  actor_email text,
  actor_role  text,
  target_id   text,
  target_table text,
  action      text,
  severity    text,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz DEFAULT now()
);

-- Version minima de insert_audit_log: mismos NOMBRES de parametro que la real
-- (para que el trigger, aplicado tal cual con \ir, no necesite tocarse), pero
-- sin el contexto HTTP/IP que no viene al caso aqui.
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_tenant_type text,
  p_actor_id uuid DEFAULT NULL,
  p_actor_email text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_target_id text DEFAULT NULL,
  p_target_table text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_severity text DEFAULT 'info'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.audit_logs (id, actor_id, actor_email, actor_role, target_id, target_table, action, old_values, new_values, severity)
  VALUES (v_id, p_actor_id, p_actor_email, p_actor_role, p_target_id, p_target_table, p_action, p_old_values, p_new_values, p_severity);
  RETURN v_id;
END;
$$;

-- La migracion de verdad, sin copiar ni parafrasear su contenido.
\ir ../supabase/migrations/20261003010000_audit_bookings_sin_duplicar_confirmacion.sql

DROP TRIGGER IF EXISTS trg_audit_bookings ON public.bookings;
CREATE TRIGGER trg_audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION audit_bookings_change();

DO $prueba$
DECLARE
  v_booking uuid;
  v_filas   integer;
  v_fila    record;
BEGIN
  -- --- 1. INSERT deja BOOKING_CREATED, una sola fila -------------------------
  INSERT INTO public.bookings (status) VALUES ('pending') RETURNING id INTO v_booking;
  SELECT count(*) INTO v_filas FROM public.audit_logs WHERE target_id = v_booking::text;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'FALLO: INSERT deberia dejar 1 fila, dejo %', v_filas;
  END IF;

  -- --- 2. Confirmar deja UNA fila BOOKING_CONFIRMED con el pago en new_values
  UPDATE public.bookings
     SET status = 'confirmed', payment_status = 'succeeded',
         payment_method = 'card', payment_intent_id = 'pi_test_123'
   WHERE id = v_booking;

  SELECT count(*) INTO v_filas
    FROM public.audit_logs
   WHERE target_id = v_booking::text AND action = 'BOOKING_CONFIRMED';
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'FALLO: confirmar deberia dejar exactamente 1 fila BOOKING_CONFIRMED, dejo %', v_filas;
  END IF;

  SELECT * INTO v_fila FROM public.audit_logs
   WHERE target_id = v_booking::text AND action = 'BOOKING_CONFIRMED';
  IF v_fila.new_values->>'payment_method' IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION 'FALLO: new_values.payment_method deberia ser "card", fue %', v_fila.new_values->>'payment_method';
  END IF;
  IF v_fila.new_values->>'payment_intent_id' IS DISTINCT FROM 'pi_test_123' THEN
    RAISE EXCEPTION 'FALLO: new_values.payment_intent_id deberia ser "pi_test_123", fue %', v_fila.new_values->>'payment_intent_id';
  END IF;
  IF v_fila.actor_role IS DISTINCT FROM 'system' OR v_fila.actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO: sin sesion (auth.uid() NULL), actor deberia ser system/NULL. Fue role=%, id=%', v_fila.actor_role, v_fila.actor_id;
  END IF;

  -- --- 3. Un UPDATE que no cambia status NO genera otro BOOKING_CONFIRMED ---
  UPDATE public.bookings SET other_field = 'x' WHERE id = v_booking;
  SELECT count(*) INTO v_filas
    FROM public.audit_logs
   WHERE target_id = v_booking::text AND action = 'BOOKING_CONFIRMED';
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'FALLO: un UPDATE sin cambio de status no deberia agregar otro BOOKING_CONFIRMED (hay %)', v_filas;
  END IF;
  SELECT count(*) INTO v_filas
    FROM public.audit_logs
   WHERE target_id = v_booking::text AND action = 'UPDATE';
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'FALLO: ese UPDATE deberia caer en el fallback generico "UPDATE", dejo %', v_filas;
  END IF;

  -- --- 4. Cancelar y completar dejan su propia fila, sin duplicar ----------
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_booking;
  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_booking; -- vuelve a confirmarse (otro camino, otra fila)
  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking;

  SELECT count(*) INTO v_filas FROM public.audit_logs WHERE target_id = v_booking::text AND action = 'BOOKING_CANCELLED';
  IF v_filas <> 1 THEN RAISE EXCEPTION 'FALLO: BOOKING_CANCELLED deberia ser 1, fue %', v_filas; END IF;

  SELECT count(*) INTO v_filas FROM public.audit_logs WHERE target_id = v_booking::text AND action = 'BOOKING_COMPLETED';
  IF v_filas <> 1 THEN RAISE EXCEPTION 'FALLO: BOOKING_COMPLETED deberia ser 1, fue %', v_filas; END IF;

  SELECT count(*) INTO v_filas FROM public.audit_logs WHERE target_id = v_booking::text AND action = 'BOOKING_CONFIRMED';
  IF v_filas <> 2 THEN RAISE EXCEPTION 'FALLO: dos confirmaciones reales (dos transiciones a confirmed) deberian dejar 2 filas, dejaron %', v_filas; END IF;

  -- --- 5. DELETE sigue dejando su fila --------------------------------------
  DELETE FROM public.bookings WHERE id = v_booking;
  SELECT count(*) INTO v_filas FROM public.audit_logs WHERE target_id = v_booking::text AND action = 'DELETE';
  IF v_filas <> 1 THEN RAISE EXCEPTION 'FALLO: DELETE deberia dejar 1 fila, dejo %', v_filas; END IF;

  RAISE NOTICE 'OK: confirmar deja una sola fila BOOKING_CONFIRMED con el pago en new_values; INSERT/cancelar/completar/DELETE sin duplicar.';
END $prueba$;
