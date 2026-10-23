-- Cobro de las notificaciones por suscripcion: FASE 1, base de datos y control de acceso. APAGADO POR DEFECTO.
--
-- Pedido de Axel (22-oct-2026): las notificaciones por SMS (y WhatsApp a futuro) seran gratis por lanzamiento y, cuando el decida,
-- se cobraran como una suscripcion mensual. Decisiones ya tomadas:
--   * Un interruptor con FECHA en la configuracion: antes de la fecha todo es gratis; desde la fecha se cobra.
--   * Al empezar el cobro se APAGAN las preferencias de quien no este cubierto; para reactivarlas hay que pagar primero.
--   * Cobertura: viajero con ToursRed Plus activo (incluido, sin pagar aparte), viajero con suscripcion propia, o agencia con
--     su suscripcion (la agencia paga UNA vez y eso cubre a su dueno y a su personal).
--   * El codigo de verificacion (OTP) NO entra: es de seguridad y siempre es gratis. No pasa por nada de lo de aqui.
--   * Pago fallido: periodo de gracia configurable (3 dias) antes de pausar.
--
-- ESTA FASE NO COBRA NADA NI CAMBIA EL COMPORTAMIENTO ACTUAL. Con el interruptor apagado (el valor por defecto) la funcion
-- unica de cobertura devuelve 'gratis' en su PRIMERA linea, sin consultar nada mas, asi que los cuatro puntos de control
-- (encolar y despachar el SMS del viajero, encolar y despachar el aviso de la agencia) dejan pasar exactamente lo mismo que hoy.
-- Los precios, Stripe, las pantallas y lo fiscal son de las fases siguientes.
--
-- PUNTOS DE CONTROL (los unicos lugares por donde sale un SMS de reserva/aviso; el OTP no pasa por ellos):
--   viajero: queue_booking_sms (al encolar) y prepare_sms_notification (justo antes de enviar)
--   agencia: queue_agency_sms  (al encolar) y prepare_agency_sms       (justo antes de enviar)
-- La cobertura de una agencia se revisa POR AGENCIA, no por usuario: alguien del personal de dos agencias solo recibe los
-- avisos de la que pago.

-- 1. Ajustes (en la fila unica de platform_settings) -----------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS cobro_notificaciones_activo        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobro_notificaciones_desde         timestamptz,
  ADD COLUMN IF NOT EXISTS cobro_notificaciones_dias_gracia   integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS cobro_notificaciones_reseteado_en  timestamptz;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_cobro_notif_gracia_check CHECK (cobro_notificaciones_dias_gracia BETWEEN 0 AND 30);

COMMENT ON COLUMN public.platform_settings.cobro_notificaciones_activo IS
  'Interruptor del cobro de las notificaciones. Apagado = todo gratis. Encendido cobra desde cobro_notificaciones_desde (o ya, si esa fecha es nula).';
COMMENT ON COLUMN public.platform_settings.cobro_notificaciones_reseteado_en IS
  'Cuando se apagaron las preferencias de quien no estaba cubierto al empezar el cobro. Lo escribe aplicar_inicio_cobro_notificaciones; se limpia si el interruptor se apaga, para que un nuevo inicio vuelva a reiniciar.';

-- 2. Suscripciones ----------------------------------------------------------------------------------------------
-- Una por viajero (tipo viajero) o por agencia (tipo agencia). La llenara el webhook de Stripe en la fase 2.
CREATE TABLE IF NOT EXISTS public.suscripciones_notificaciones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                    text NOT NULL,
  user_id                 uuid REFERENCES public.users(id) ON DELETE CASCADE,
  agency_id               uuid REFERENCES public.agencies(id) ON DELETE CASCADE,
  stripe_customer_id      text,
  stripe_subscription_id  text UNIQUE,
  status                  text NOT NULL DEFAULT 'incomplete',
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  cancelled_at            timestamptz,
  -- Hasta cuando se sigue enviando aunque el pago haya fallado (la gracia). La fija el webhook al fallar un cobro y se limpia al pagar.
  en_gracia_hasta         timestamptz,
  price_paid              numeric(12,2),
  moneda                  text NOT NULL DEFAULT 'MXN',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suscripciones_notificaciones_tipo_check CHECK (tipo IN ('viajero', 'agencia')),
  CONSTRAINT suscripciones_notificaciones_status_check CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  CONSTRAINT suscripciones_notificaciones_sujeto_check CHECK (
    (tipo = 'viajero' AND user_id IS NOT NULL AND agency_id IS NULL)
 OR (tipo = 'agencia' AND agency_id IS NOT NULL AND user_id IS NULL))
);

-- Una suscripcion VIVA por viajero o por agencia (las canceladas se conservan como historial).
CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_notificaciones_viva_unica
  ON public.suscripciones_notificaciones (tipo, COALESCE(user_id, agency_id))
  WHERE status IN ('incomplete', 'trialing', 'active', 'past_due');

CREATE OR REPLACE FUNCTION public.sellar_updated_at_suscripcion_notificaciones()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$ BEGIN NEW.updated_at := now(); RETURN NEW; END $function$;

DROP TRIGGER IF EXISTS suscripciones_notificaciones_updated_at ON public.suscripciones_notificaciones;
CREATE TRIGGER suscripciones_notificaciones_updated_at
  BEFORE UPDATE ON public.suscripciones_notificaciones
  FOR EACH ROW EXECUTE FUNCTION public.sellar_updated_at_suscripcion_notificaciones();

ALTER TABLE public.suscripciones_notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suscripciones_notificaciones FROM PUBLIC, anon;
GRANT SELECT ON public.suscripciones_notificaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suscripciones_notificaciones TO service_role;
-- Solo lectura para el usuario (su propia suscripcion, o la de su agencia si es el dueno) y para un administrador.
-- Las escrituras son del servicio (webhook de Stripe): un usuario nunca se da a si mismo una suscripcion.
DROP POLICY IF EXISTS "Viajero lee su suscripcion de notificaciones" ON public.suscripciones_notificaciones;
CREATE POLICY "Viajero lee su suscripcion de notificaciones" ON public.suscripciones_notificaciones
  FOR SELECT TO authenticated USING (suscripciones_notificaciones.tipo = 'viajero' AND suscripciones_notificaciones.user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Dueno lee la suscripcion de notificaciones de su agencia" ON public.suscripciones_notificaciones;
CREATE POLICY "Dueno lee la suscripcion de notificaciones de su agencia" ON public.suscripciones_notificaciones
  FOR SELECT TO authenticated USING (
    suscripciones_notificaciones.tipo = 'agencia' AND EXISTS (SELECT 1 FROM public.agencies a WHERE a.id = suscripciones_notificaciones.agency_id AND a.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Admin lee las suscripciones de notificaciones" ON public.suscripciones_notificaciones;
CREATE POLICY "Admin lee las suscripciones de notificaciones" ON public.suscripciones_notificaciones
  FOR SELECT TO authenticated USING (public.is_admin_user());

-- 3. La agencia de cada aviso queda en la cola -----------------------------------------------------------------
-- Para volver a comprobar la cobertura de ESA agencia justo antes de enviar (un mensaje no trae reserva de donde sacarla).
ALTER TABLE messaging_private.notification_outbox
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;

-- 4. LA regla de cobertura: una sola fuente de verdad -----------------------------------------------------------
-- La decision pura (sin leer nada): se puede probar con una tabla de verdad. Devuelve por que esta cubierto, o NULL si no.
--   cobro no vigente -> 'gratis'   Plus -> 'plus'   suscripcion al dia -> 'suscripcion'   en gracia -> 'gracia'   si no -> NULL
CREATE OR REPLACE FUNCTION messaging_private.decidir_cobertura(p_vigente boolean, p_plus boolean, p_suscripcion boolean, p_gracia boolean)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE
           WHEN NOT COALESCE(p_vigente, false) THEN 'gratis'
           WHEN COALESCE(p_plus, false)        THEN 'plus'
           WHEN COALESCE(p_suscripcion, false) THEN 'suscripcion'
           WHEN COALESCE(p_gracia, false)      THEN 'gracia'
           ELSE NULL
         END;
$function$;

-- A que agencia pertenece un usuario: la que es suya como dueno o, si no, la primera donde es personal activo.
CREATE OR REPLACE FUNCTION messaging_private.agencia_de_usuario(p_user uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT a.id FROM public.agencies a WHERE a.user_id = p_user ORDER BY a.id LIMIT 1),
    (SELECT s.agency_id FROM public.agency_staff s WHERE s.user_id = p_user AND s.is_active ORDER BY s.agency_id LIMIT 1));
$function$;

-- Lo que consultan los cuatro puntos de control. p_tipo 'viajero' mira ToursRed Plus (la misma regla que la billetera de puntos:
-- has_active_membership) y la suscripcion del viajero; 'agencia' mira la suscripcion de esa agencia (p_agency). Una agencia
-- desconocida con el cobro vigente NO esta cubierta: falla cerrado. Con el cobro apagado NO consulta nada mas: 'gratis'.
CREATE OR REPLACE FUNCTION messaging_private.cobertura_notificaciones(p_tipo text, p_user uuid, p_agency uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  s public.platform_settings;
  v_vigente boolean;
  v_plus boolean := false;
  v_sub boolean := false;
  v_gracia boolean := false;
BEGIN
  SELECT * INTO STRICT s FROM public.platform_settings;
  v_vigente := s.cobro_notificaciones_activo AND COALESCE(s.cobro_notificaciones_desde, now()) <= now();
  IF NOT v_vigente THEN RETURN 'gratis'; END IF;

  IF p_tipo = 'viajero' THEN
    IF p_user IS NULL THEN RETURN NULL; END IF;
    v_plus := public.has_active_membership(p_user);
    SELECT COALESCE(bool_or(x.status IN ('active', 'trialing') AND x.current_period_end > now()), false),
           COALESCE(bool_or(x.en_gracia_hasta > now()), false)
      INTO v_sub, v_gracia
      FROM public.suscripciones_notificaciones x
     WHERE x.tipo = 'viajero' AND x.user_id = p_user;
  ELSIF p_tipo = 'agencia' THEN
    IF p_agency IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(bool_or(x.status IN ('active', 'trialing') AND x.current_period_end > now()), false),
           COALESCE(bool_or(x.en_gracia_hasta > now()), false)
      INTO v_sub, v_gracia
      FROM public.suscripciones_notificaciones x
     WHERE x.tipo = 'agencia' AND x.agency_id = p_agency;
  ELSE
    RAISE EXCEPTION 'Tipo de cobertura invalido';
  END IF;

  RETURN messaging_private.decidir_cobertura(true, v_plus, v_sub, v_gracia);
END
$function$;

-- 5. Control de acceso del SMS del VIAJERO (encolar y despachar) -------------------------------------------------
-- Se reescriben a partir de su definicion en la base y fallan si un fragmento no esta EXACTAMENTE una vez.
DO $$
DECLARE
  d text;
  veces integer;
  viejo text;
  nuevo text;
BEGIN
  -- queue_booking_sms: despues de la comprobacion de la preferencia.
  SELECT pg_get_functiondef('public.queue_booking_sms(uuid,text)'::regprocedure) INTO d;
  viejo := ' if not exists(select 1 from messaging_private.notification_preferences where user_id=u.id and application=''toursred'' and channel=''sms'' and transactional_enabled) then return null; end if;';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'queue_booking_sms cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := viejo || E'\n if messaging_private.cobertura_notificaciones(''viajero'', u.id, null) is null then return null; end if;';
  EXECUTE replace(d, viejo, nuevo);

  -- prepare_sms_notification: antes de la comprobacion de la hora de salida, ya con la preferencia revisada.
  SELECT pg_get_functiondef('public.prepare_sms_notification(uuid,uuid)'::regprocedure) INTO d;
  viejo := ' if (snap->>''departure_at'')::timestamptz<=now() or (snap->>''departure_date'')::date<current_date then return jsonb_build_object(''allowed'',false); end if;';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'prepare_sms_notification cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := E' if messaging_private.cobertura_notificaciones(''viajero'', o.user_id, null) is null then return jsonb_build_object(''allowed'',false); end if;\n' || viejo;
  EXECUTE replace(d, viejo, nuevo);
END $$;

-- 6. Control de acceso del aviso de la AGENCIA (encolar y despachar) ---------------------------------------------
-- queue_agency_sms gana p_agency (la agencia del evento); si no llega se deduce del usuario. Se elimina la firma anterior.
DROP FUNCTION IF EXISTS messaging_private.queue_agency_sms(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION messaging_private.queue_agency_sms(p_user uuid, p_tipo text, p_booking uuid, p_ref uuid, p_agency uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  s public.platform_settings;
  u public.users;
  v_cat text;
  v_pref boolean;
  v_agency uuid;
  v_id uuid;
BEGIN
  SELECT * INTO STRICT s FROM public.platform_settings;
  IF NOT s.sms_habilitado THEN RETURN NULL; END IF;

  v_cat := CASE p_tipo
             WHEN 'reserva' THEN 'agencia_reserva'
             WHEN 'cancelacion' THEN 'agencia_cancelacion'
             WHEN 'mensaje' THEN 'agencia_mensaje'
           END;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Tipo de aviso invalido'; END IF;

  SELECT * INTO u FROM public.users WHERE id = p_user;
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false)
     OR u.phone_verified_at IS NULL OR u.phone_verified_e164 IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT CASE p_tipo WHEN 'reserva' THEN np.agencia_reserva
                     WHEN 'cancelacion' THEN np.agencia_cancelacion
                     ELSE np.agencia_mensaje END
    INTO v_pref
    FROM messaging_private.notification_preferences np
   WHERE np.user_id = u.id AND np.application = 'toursred' AND np.channel = 'sms';
  IF NOT COALESCE(v_pref, false) THEN RETURN NULL; END IF;

  -- Cobro: la agencia del evento tiene que estar cubierta (con el cobro apagado esto siempre pasa).
  v_agency := COALESCE(p_agency, messaging_private.agencia_de_usuario(u.id));
  IF messaging_private.cobertura_notificaciones('agencia', u.id, v_agency) IS NULL THEN RETURN NULL; END IF;

  v_id := public.enqueue_sms_notification(
    u.id, p_booking, u.phone_verified_e164, 'ZZ', v_cat,
    v_cat || ':' || p_ref::text || ':' || u.id::text,
    now(), now() + interval '1 hour');
  IF v_id IS NOT NULL AND v_agency IS NOT NULL THEN
    UPDATE messaging_private.notification_outbox SET agency_id = v_agency WHERE id = v_id AND agency_id IS NULL;
  END IF;
  RETURN v_id;
END
$function$;

-- Los disparadores pasan la agencia del evento.
CREATE OR REPLACE FUNCTION messaging_private.agency_booking_sms_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_nueva boolean;
BEGIN
  IF NEW.agency_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'confirmed' AND NEW.payment_status = 'succeeded' THEN
    v_nueva := true;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'confirmed' AND OLD.payment_status = 'succeeded' THEN v_nueva := false; END IF;
    END IF;
    IF v_nueva THEN
      FOR r IN SELECT x.user_id FROM messaging_private.agency_sms_recipients(NEW.agency_id, 'reserva') x LOOP
        PERFORM messaging_private.queue_agency_sms(r.user_id, 'reserva', NEW.id, NEW.id, NEW.agency_id);
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo una reserva que la agencia ya conocia (confirmada) y que NO cancelo la propia agencia.
    IF OLD.status = 'confirmed' AND NEW.status = 'cancelled'
       AND NEW.cancelled_by_agency_at IS NULL AND NEW.agency_cancellation_id IS NULL THEN
      FOR r IN SELECT x.user_id FROM messaging_private.agency_sms_recipients(NEW.agency_id, 'cancelacion') x LOOP
        PERFORM messaging_private.queue_agency_sms(r.user_id, 'cancelacion', NEW.id, NEW.id, NEW.agency_id);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION messaging_private.agency_message_sms_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_agency uuid;
BEGIN
  -- La agencia de la conversacion (por su tour o reserva); nula si la conversacion no esta ligada a una: entonces se deduce del usuario.
  v_agency := messaging_private.conversation_agency(NEW.conversation_id);
  FOR r IN
    SELECT DISTINCT mp.user_id
      FROM public.message_participants mp
     WHERE mp.conversation_id = NEW.conversation_id
       AND mp.user_id <> NEW.sender_id
       AND (
         EXISTS (SELECT 1 FROM public.agencies a WHERE a.user_id = mp.user_id)
         OR EXISTS (
           SELECT 1
             FROM public.agency_staff s
             JOIN public.agency_staff_permissions p ON p.staff_id = s.id
            WHERE s.user_id = mp.user_id AND s.is_active AND p.can_view_messages)
       )
  LOOP
    PERFORM messaging_private.queue_agency_sms(r.user_id, 'mensaje', NULL, NEW.id, v_agency);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

-- prepare_agency_sms: vuelve a comprobar la cobertura de la agencia justo antes de enviar (pudo vencer entre encolar y despachar).
CREATE OR REPLACE FUNCTION messaging_private.prepare_agency_sms(o messaging_private.notification_outbox)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  u public.users;
  b public.bookings;
  v_tipo text;
  v_pref boolean;
  v_tour text;
  v_agency uuid;
BEGIN
  v_tipo := CASE o.category
              WHEN 'agencia_reserva' THEN 'reserva'
              WHEN 'agencia_cancelacion' THEN 'cancelacion'
              ELSE 'mensaje'
            END;

  SELECT * INTO u FROM public.users WHERE id = o.user_id;
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false) OR u.phone_verified_at IS NULL
     OR u.phone_verified_e164 IS DISTINCT FROM o.destination_e164 THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT CASE v_tipo WHEN 'reserva' THEN np.agencia_reserva
                     WHEN 'cancelacion' THEN np.agencia_cancelacion
                     ELSE np.agencia_mensaje END
    INTO v_pref
    FROM messaging_private.notification_preferences np
   WHERE np.user_id = u.id AND np.application = 'toursred' AND np.channel = 'sms';
  IF NOT COALESCE(v_pref, false) THEN RETURN jsonb_build_object('allowed', false); END IF;

  IF v_tipo = 'mensaje' THEN
    v_agency := COALESCE(o.agency_id, messaging_private.agencia_de_usuario(u.id));
    IF messaging_private.cobertura_notificaciones('agencia', u.id, v_agency) IS NULL THEN
      RETURN jsonb_build_object('allowed', false);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'destination', o.destination_e164);
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = o.booking_id;
  IF b.id IS NULL THEN RETURN jsonb_build_object('allowed', false); END IF;
  IF v_tipo = 'reserva' THEN
    IF NOT (b.status = 'confirmed' AND b.payment_status = 'succeeded') THEN
      RETURN jsonb_build_object('allowed', false);
    END IF;
  ELSE
    IF b.status <> 'cancelled' THEN RETURN jsonb_build_object('allowed', false); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM messaging_private.agency_sms_recipients(b.agency_id, v_tipo) x WHERE x.user_id = u.id) THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;
  IF messaging_private.cobertura_notificaciones('agencia', u.id, b.agency_id) IS NULL THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT t.name INTO v_tour FROM public.tours t WHERE t.id = b.tour_id;
  RETURN jsonb_build_object('allowed', true, 'destination', o.destination_e164,
                            'folio', b.booking_code, 'tour', v_tour);
END
$function$;

-- 7. Al empezar el cobro: apagar las preferencias de quien no este cubierto (con respaldo) -------------------------
CREATE TABLE IF NOT EXISTS messaging_private.notification_preferences_respaldo (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL,
  application           text NOT NULL,
  channel               text NOT NULL,
  transactional_enabled boolean,
  agencia_reserva       boolean,
  agencia_cancelacion   boolean,
  agencia_mensaje       boolean,
  motivo                text NOT NULL,
  respaldado_en         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE messaging_private.notification_preferences_respaldo IS
  'Las preferencias de SMS tal como estaban antes de que aplicar_inicio_cobro_notificaciones las apagara. Solo para poder restaurarlas a mano si se cancela el cobro.';
ALTER TABLE messaging_private.notification_preferences_respaldo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON messaging_private.notification_preferences_respaldo FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON messaging_private.notification_preferences_respaldo TO service_role;

-- Corre cada hora por pg_cron (sin sesion). Idempotente. Con el interruptor apagado no toca nada de las preferencias (solo limpia la
-- marca para que un nuevo inicio vuelva a reiniciar); con el cobro vigente y sin marca, apaga lo de quien no esta cubierto, lo
-- respalda antes y deja la marca. Los miembros Plus conservan sus preferencias. Devuelve cuantas personas se apagaron.
CREATE OR REPLACE FUNCTION public.aplicar_inicio_cobro_notificaciones()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  s public.platform_settings;
  r messaging_private.notification_preferences;
  v_viajero boolean;
  v_agencia boolean;
  v_apagados integer := 0;
BEGIN
  SELECT * INTO STRICT s FROM public.platform_settings FOR UPDATE;

  IF NOT s.cobro_notificaciones_activo THEN
    IF s.cobro_notificaciones_reseteado_en IS NOT NULL THEN
      UPDATE public.platform_settings SET cobro_notificaciones_reseteado_en = NULL;
    END IF;
    RETURN 0;
  END IF;
  IF COALESCE(s.cobro_notificaciones_desde, now()) > now() THEN RETURN 0; END IF;
  IF s.cobro_notificaciones_reseteado_en IS NOT NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT np.*
      FROM messaging_private.notification_preferences np
     WHERE np.application = 'toursred' AND np.channel = 'sms'
       AND (np.transactional_enabled OR np.agencia_reserva OR np.agencia_cancelacion OR np.agencia_mensaje)
     FOR UPDATE
  LOOP
    v_viajero := r.transactional_enabled
                 AND messaging_private.cobertura_notificaciones('viajero', r.user_id, NULL) IS NULL;
    v_agencia := (r.agencia_reserva OR r.agencia_cancelacion OR r.agencia_mensaje)
                 AND messaging_private.cobertura_notificaciones('agencia', r.user_id, messaging_private.agencia_de_usuario(r.user_id)) IS NULL;
    IF v_viajero OR v_agencia THEN
      INSERT INTO messaging_private.notification_preferences_respaldo
        (user_id, application, channel, transactional_enabled, agencia_reserva, agencia_cancelacion, agencia_mensaje, motivo)
      VALUES
        (r.user_id, r.application, r.channel, r.transactional_enabled, r.agencia_reserva, r.agencia_cancelacion, r.agencia_mensaje,
         'inicio del cobro de notificaciones');
      UPDATE messaging_private.notification_preferences
         SET transactional_enabled = CASE WHEN v_viajero THEN false ELSE transactional_enabled END,
             agencia_reserva       = CASE WHEN v_agencia THEN false ELSE agencia_reserva END,
             agencia_cancelacion   = CASE WHEN v_agencia THEN false ELSE agencia_cancelacion END,
             agencia_mensaje       = CASE WHEN v_agencia THEN false ELSE agencia_mensaje END,
             updated_at = now()
       WHERE user_id = r.user_id AND application = r.application AND channel = r.channel;
      v_apagados := v_apagados + 1;
    END IF;
  END LOOP;

  UPDATE public.platform_settings SET cobro_notificaciones_reseteado_en = now();
  RETURN v_apagados;
END
$function$;

-- 8. Permisos ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION messaging_private.decidir_cobertura(boolean, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.agencia_de_usuario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.cobertura_notificaciones(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.queue_agency_sms(uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.agency_booking_sms_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.agency_message_sms_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.prepare_agency_sms(messaging_private.notification_outbox) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_inicio_cobro_notificaciones() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_inicio_cobro_notificaciones() TO service_role;

-- 9. Programado: cada hora, minuto 10 (solo donde existe pg_cron; no en la base de pruebas de CI) ------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aplicar-cobro-notificaciones') THEN
      PERFORM cron.unschedule('aplicar-cobro-notificaciones');
    END IF;
    PERFORM cron.schedule('aplicar-cobro-notificaciones', '10 * * * *', $job$SELECT public.aplicar_inicio_cobro_notificaciones();$job$);
  END IF;
END $$;
