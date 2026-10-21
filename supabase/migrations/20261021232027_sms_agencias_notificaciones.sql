-- SMS a agencias y a su personal: nueva reserva, cancelacion y mensaje nuevo.
--
-- Pedido de Axel (21-oct-2026). Hasta hoy el SMS de reserva solo iba al VIAJERO; el aviso de
-- "nueva reserva" de la agencia es un correo (send-booking-confirmation), y cancelaciones y
-- mensajes no avisaban por SMS. Esta migracion agrega tres categorias a la cola que ya existe
-- (messaging_private.notification_outbox) y reutiliza el motor de envio tal cual:
--
--   agencia_reserva      una reserva queda confirmada y pagada en un tour de la agencia
--   agencia_cancelacion  una reserva CONFIRMADA pasa a cancelada, salvo que la cancele la propia agencia
--   agencia_mensaje      llega un mensaje a una conversacion donde esta el dueno o su personal
--
-- DESTINATARIOS: el dueno (agencies.user_id) y el personal activo (agency_staff) segun sus permisos:
-- can_view_bookings para reserva y cancelacion, can_view_messages para mensajes. Cada persona
-- decide cuales recibir (tres casillas en su perfil); sin fila de preferencia, no se manda nada,
-- igual que el SMS del viajero (apagado por defecto). Ademas hace falta telefono verificado.
--
-- MENSAJES: se avisa a los PARTICIPANTES de la conversacion. Hoy solo el dueno entra a las
-- conversaciones que abre un viajero desde el tour, asi que el personal recibe aviso de mensajes
-- solo en las conversaciones donde participa. Sin limite por conversacion (decision de Axel: dejarlo
-- abierto para ver como se comporta).
--
-- SERVICIO GRATIS POR LANZAMIENTO: mas adelante se cobrara como suscripcion mensual. El unico punto
-- por donde pasa todo envio a una agencia es messaging_private.queue_agency_sms (al encolar) y
-- prepare_agency_sms (al despachar); ahi se agregara el chequeo de suscripcion. No se construye ahora.
--
-- Los disparadores NUNCA deben deshacer una reserva, un pago o un mensaje: capturan cualquier error,
-- dejan la alerta queue_error y devuelven la fila. Ojo con el patron 12 de CLAUDE.md: nunca se lee
-- OLD dentro de un AND/OR junto a TG_OP (en un INSERT OLD no existe y Postgres no garantiza el orden).

-- 1. Preferencias por tipo de aviso ------------------------------------------------------------
ALTER TABLE messaging_private.notification_preferences
  ADD COLUMN IF NOT EXISTS agencia_reserva     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agencia_cancelacion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agencia_mensaje     boolean NOT NULL DEFAULT false;

-- 2. Categorias nuevas en la cola y en los intentos --------------------------------------------
ALTER TABLE messaging_private.notification_outbox DROP CONSTRAINT notification_outbox_category_check;
ALTER TABLE messaging_private.notification_outbox ADD CONSTRAINT notification_outbox_category_check
  CHECK (category = ANY (ARRAY['reserva_confirmada','recordatorio_tour','agencia_reserva','agencia_cancelacion','agencia_mensaje']));

ALTER TABLE messaging_private.notification_attempts DROP CONSTRAINT notification_attempts_category_check;
ALTER TABLE messaging_private.notification_attempts ADD CONSTRAINT notification_attempts_category_check
  CHECK (category = ANY (ARRAY['otp','reserva_confirmada','recordatorio_tour','agencia_reserva','agencia_cancelacion','agencia_mensaje']));

-- 3. A quien se le avisa -----------------------------------------------------------------------
-- p_tipo: 'reserva' | 'cancelacion' | 'mensaje'. El dueno siempre; el personal solo con el permiso.
CREATE OR REPLACE FUNCTION messaging_private.agency_sms_recipients(p_agency uuid, p_tipo text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT a.user_id FROM public.agencies a WHERE a.id = p_agency
  UNION
  SELECT s.user_id
    FROM public.agency_staff s
    JOIN public.agency_staff_permissions p ON p.staff_id = s.id
   WHERE s.agency_id = p_agency
     AND s.is_active
     AND CASE WHEN p_tipo = 'mensaje' THEN p.can_view_messages ELSE p.can_view_bookings END;
$function$;

-- 4. Encolar -----------------------------------------------------------------------------------
-- p_ref es lo que hace unico el aviso: la reserva (reserva, cancelacion) o el mensaje (mensaje).
-- p_booking solo se guarda en la cola cuando hay reserva.
CREATE OR REPLACE FUNCTION messaging_private.queue_agency_sms(p_user uuid, p_tipo text, p_booking uuid, p_ref uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  s public.platform_settings;
  u public.users;
  v_cat text;
  v_pref boolean;
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

  RETURN public.enqueue_sms_notification(
    u.id, p_booking, u.phone_verified_e164, 'ZZ', v_cat,
    v_cat || ':' || p_ref::text || ':' || u.id::text,
    now(), now() + interval '1 hour');
END
$function$;

-- 5. Disparadores ------------------------------------------------------------------------------
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
        PERFORM messaging_private.queue_agency_sms(r.user_id, 'reserva', NEW.id, NEW.id);
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo una reserva que la agencia ya conocia (confirmada) y que NO cancelo la propia agencia.
    IF OLD.status = 'confirmed' AND NEW.status = 'cancelled'
       AND NEW.cancelled_by_agency_at IS NULL AND NEW.agency_cancellation_id IS NULL THEN
      FOR r IN SELECT x.user_id FROM messaging_private.agency_sms_recipients(NEW.agency_id, 'cancelacion') x LOOP
        PERFORM messaging_private.queue_agency_sms(r.user_id, 'cancelacion', NEW.id, NEW.id);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS agency_booking_sms_event ON public.bookings;
CREATE TRIGGER agency_booking_sms_event
  AFTER INSERT OR UPDATE OF status, payment_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION messaging_private.agency_booking_sms_event();

CREATE OR REPLACE FUNCTION messaging_private.agency_message_sms_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r record;
BEGIN
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
    PERFORM messaging_private.queue_agency_sms(r.user_id, 'mensaje', NULL, NEW.id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS agency_message_sms_event ON public.messages;
CREATE TRIGGER agency_message_sms_event
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION messaging_private.agency_message_sms_event();

-- 6. Validar al despachar ----------------------------------------------------------------------
-- El worker vuelve a comprobar el estado real justo antes de enviar (la preferencia, el telefono, el
-- permiso del personal o la reserva pudieron cambiar entre encolar y despachar).
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

  SELECT t.name INTO v_tour FROM public.tours t WHERE t.id = b.tour_id;
  RETURN jsonb_build_object('allowed', true, 'destination', o.destination_e164,
                            'folio', b.booking_code, 'tour', v_tour);
END
$function$;

-- prepare_sms_notification (la que llama el worker) hoy asume una reserva de VIAJERO. Se le antepone
-- el desvio de las categorias de agencia. Se reescribe a partir de su definicion en la base y falla
-- si el fragmento no esta exactamente una vez, para no dejarla a medio cambiar.
DO $$
DECLARE
  d text;
  rewritten text;
  marker text := ' snap:=messaging_private.booking_sms_snapshot(o.booking_id);';
  veces integer;
BEGIN
  SELECT pg_get_functiondef('public.prepare_sms_notification(uuid,uuid)'::regprocedure) INTO d;
  veces := (length(d) - length(replace(d, marker, ''))) / length(marker);
  IF veces <> 1 THEN
    RAISE EXCEPTION 'prepare_sms_notification cambio: el fragmento aparece % veces, se esperaba 1', veces;
  END IF;
  rewritten := replace(d, marker,
    E' if o.category in (''agencia_reserva'',''agencia_cancelacion'',''agencia_mensaje'') then\n'
    || E'  return messaging_private.prepare_agency_sms(o);\n'
    || E' end if;\n' || marker);
  EXECUTE rewritten;
END $$;

-- 7. Preferencias del usuario ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_agency_sms_preferences()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
           'reserva',     COALESCE(np.agencia_reserva, false),
           'cancelacion', COALESCE(np.agencia_cancelacion, false),
           'mensaje',     COALESCE(np.agencia_mensaje, false))
    FROM (SELECT 1) x
    LEFT JOIN messaging_private.notification_preferences np
      ON np.user_id = auth.uid() AND np.application = 'toursred' AND np.channel = 'sms'
   WHERE auth.uid() IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_agency_sms_preferences(p_reserva boolean, p_cancelacion boolean, p_mensaje boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_reserva IS NULL OR p_cancelacion IS NULL OR p_mensaje IS NULL THEN
    RAISE EXCEPTION 'Sesion requerida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agencies WHERE user_id = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.agency_staff WHERE user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'Solo las agencias y su personal pueden elegir estos avisos' USING ERRCODE = '42501';
  END IF;
  INSERT INTO messaging_private.notification_preferences(user_id, agencia_reserva, agencia_cancelacion, agencia_mensaje)
  VALUES (auth.uid(), p_reserva, p_cancelacion, p_mensaje)
  ON CONFLICT (user_id, application, channel) DO UPDATE
    SET agencia_reserva = EXCLUDED.agencia_reserva,
        agencia_cancelacion = EXCLUDED.agencia_cancelacion,
        agencia_mensaje = EXCLUDED.agencia_mensaje,
        updated_at = now();
END
$function$;

-- 8. Permisos ----------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION messaging_private.agency_sms_recipients(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.queue_agency_sms(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.agency_booking_sms_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.agency_message_sms_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.prepare_agency_sms(messaging_private.notification_outbox) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_my_agency_sms_preferences() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_agency_sms_preferences(boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_agency_sms_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_agency_sms_preferences(boolean, boolean, boolean) TO authenticated;
