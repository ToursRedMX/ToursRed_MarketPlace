-- SMS al VIAJERO: elegir CUALES avisos recibe (confirmacion de reserva, cancelacion de reserva, recordatorio del tour) y el aviso de
-- cancelacion, que no existia.
--
-- Pedido de Axel (23-oct-2026): la seccion «Mensajes operativos» del perfil era UN solo interruptor (confirmacion + recordatorio) y se
-- veia aunque el viajero no estuviera cubierto por el cobro. Ahora son tres avisos que se eligen por separado, y la seccion solo sale
-- si el viajero esta cubierto (ToursRed Plus, suscripcion, gracia o cobro apagado).
--
--   1. notification_preferences gana viajero_confirmacion / viajero_cancelacion / viajero_recordatorio (apagadas por defecto).
--      Quien ya tenia el interruptor encendido conserva confirmacion y recordatorio; la cancelacion es nueva y queda apagada
--      (un aviso nuevo no se activa solo).
--   2. Los puntos de control del SMS del viajero (queue_booking_sms y prepare_sms_notification) miran la preferencia DE SU TIPO.
--   3. Aviso NUEVO de cancelacion de reserva: categoria reserva_cancelada, con el mismo control de cobertura que los demas. Se encola
--      cuando una reserva CONFIRMADA pasa a cancelada (la cancele el viajero o la agencia).
--   4. get/set_my_traveler_sms_preferences (los tres valores). Las RPC de un solo interruptor siguen existiendo y mueven los tres.
--
-- El codigo de verificacion (OTP) NO entra: no pasa por nada de esto.

-- 1. Preferencias por tipo ------------------------------------------------------------------------------------------
ALTER TABLE messaging_private.notification_preferences
  ADD COLUMN IF NOT EXISTS viajero_confirmacion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viajero_cancelacion  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viajero_recordatorio boolean NOT NULL DEFAULT false;

-- Quien ya habia elegido recibir avisos de reserva sigue recibiendo los dos que existian.
UPDATE messaging_private.notification_preferences
   SET viajero_confirmacion = transactional_enabled,
       viajero_recordatorio = transactional_enabled
 WHERE application = 'toursred' AND channel = 'sms' AND transactional_enabled;

-- 2. La categoria nueva en la cola -------------------------------------------------------------------------------------
DO $$
DECLARE
  def text;
  veces integer;
  viejo text := '''recordatorio_tour''::text,';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c WHERE c.conrelid = 'messaging_private.notification_outbox'::regclass AND c.conname = 'notification_outbox_category_check';
  veces := (length(def) - length(replace(def, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'notification_outbox_category_check cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  ALTER TABLE messaging_private.notification_outbox DROP CONSTRAINT notification_outbox_category_check;
  EXECUTE 'ALTER TABLE messaging_private.notification_outbox ADD CONSTRAINT notification_outbox_category_check '
          || replace(def, viejo, viejo || ' ''reserva_cancelada''::text,');
END $$;

-- 3. Puntos de control del viajero: la preferencia de SU tipo -----------------------------------------------------------
-- Se reescriben a partir de su definicion en la base y fallan si un fragmento no esta EXACTAMENTE una vez.
DO $$
DECLARE
  d text;
  veces integer;
  viejo text;
  nuevo text;
BEGIN
  -- queue_booking_sms: confirmacion o recordatorio segun la categoria.
  SELECT pg_get_functiondef('public.queue_booking_sms(uuid,text)'::regprocedure) INTO d;
  viejo := 'and application=''toursred'' and channel=''sms'' and transactional_enabled)';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'queue_booking_sms cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := 'and application=''toursred'' and channel=''sms'' and case p_category when ''recordatorio_tour'' then viajero_recordatorio else viajero_confirmacion end)';
  EXECUTE replace(d, viejo, nuevo);

  -- prepare_sms_notification: la misma comprobacion justo antes de enviar, y el desvio de la cancelacion a su propia funcion.
  SELECT pg_get_functiondef('public.prepare_sms_notification(uuid,uuid)'::regprocedure) INTO d;
  viejo := 'and channel=''sms'' and application=''toursred'' and transactional_enabled)';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'prepare_sms_notification cambio (preferencia): el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := 'and channel=''sms'' and application=''toursred'' and case o.category when ''recordatorio_tour'' then viajero_recordatorio else viajero_confirmacion end)';
  d := replace(d, viejo, nuevo);

  viejo := 'if o.category in (''agencia_reserva'',''agencia_cancelacion'',''agencia_mensaje'') then';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'prepare_sms_notification cambio (desvio): el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := 'if o.category = ''reserva_cancelada'' then return messaging_private.prepare_traveler_cancel_sms(o); end if;' || E'\n ' || viejo;
  EXECUTE replace(d, viejo, nuevo);
END $$;

-- 4. El aviso de cancelacion ---------------------------------------------------------------------------------------------
-- Encolar: reserva cancelada, viajero con telefono verificado que eligio este aviso y esta cubierto por el cobro.
CREATE OR REPLACE FUNCTION messaging_private.queue_traveler_cancel_sms(p_booking uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  s public.platform_settings;
  b public.bookings;
  u public.users;
BEGIN
  SELECT * INTO STRICT s FROM public.platform_settings;
  IF NOT s.sms_habilitado THEN RETURN NULL; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = p_booking;
  IF b.id IS NULL OR b.status <> 'cancelled' OR b.user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO u FROM public.users WHERE id = b.user_id;
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false) OR u.phone_verified_at IS NULL OR u.phone_verified_e164 IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM messaging_private.notification_preferences np
                  WHERE np.user_id = u.id AND np.application = 'toursred' AND np.channel = 'sms' AND np.viajero_cancelacion) THEN
    RETURN NULL;
  END IF;
  -- Cobro: con el cobro apagado siempre pasa; encendido, solo si esta cubierto.
  IF messaging_private.cobertura_notificaciones('viajero', u.id, NULL) IS NULL THEN RETURN NULL; END IF;

  RETURN public.enqueue_sms_notification(
    u.id, b.id, u.phone_verified_e164, 'ZZ', 'reserva_cancelada',
    'reserva_cancelada:' || b.id::text, now(), now() + interval '1 hour');
END
$function$;

-- Despachar: se vuelve a comprobar todo justo antes de enviar (la preferencia o la cobertura pudieron cambiar).
CREATE OR REPLACE FUNCTION messaging_private.prepare_traveler_cancel_sms(o messaging_private.notification_outbox)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  u public.users;
  b public.bookings;
  v_tour text;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = o.user_id;
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false) OR u.phone_verified_at IS NULL
     OR u.phone_verified_e164 IS DISTINCT FROM o.destination_e164 THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM messaging_private.notification_preferences np
                  WHERE np.user_id = u.id AND np.application = 'toursred' AND np.channel = 'sms' AND np.viajero_cancelacion) THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;
  IF messaging_private.cobertura_notificaciones('viajero', u.id, NULL) IS NULL THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = o.booking_id;
  IF b.id IS NULL OR b.status <> 'cancelled' OR b.user_id IS DISTINCT FROM u.id THEN RETURN jsonb_build_object('allowed', false); END IF;

  SELECT t.name INTO v_tour FROM public.tours t WHERE t.id = b.tour_id;
  RETURN jsonb_build_object('allowed', true, 'destination', o.destination_e164, 'folio', b.booking_code, 'tour', v_tour);
END
$function$;

REVOKE ALL ON FUNCTION messaging_private.queue_traveler_cancel_sms(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.prepare_traveler_cancel_sms(messaging_private.notification_outbox) FROM PUBLIC, anon, authenticated;

-- El disparador de la reserva: confirmar encola la confirmacion; cancelar una reserva CONFIRMADA encola el aviso de cancelacion
-- y, como siempre, cancela lo que siga pendiente de la reserva (menos el aviso de cancelacion mismo).
-- Un fallo de notificacion NUNCA deshace el pago, la reserva ni el correo: se avisa con una alerta y se sigue.
CREATE OR REPLACE FUNCTION messaging_private.booking_sms_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'confirmed' AND NEW.payment_status = 'succeeded' THEN
    PERFORM public.queue_booking_sms(NEW.id, 'reserva_confirmada');
  ELSIF NEW.status <> 'confirmed' THEN
    UPDATE messaging_private.notification_outbox
       SET status = 'cancelado', updated_at = now()
     WHERE booking_id = NEW.id AND status = 'pendiente' AND category <> 'reserva_cancelada';
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
        PERFORM messaging_private.queue_traveler_cancel_sms(NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

-- 5. Las RPC del perfil ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_traveler_sms_preferences()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
           'confirmacion', COALESCE((SELECT np.viajero_confirmacion FROM messaging_private.notification_preferences np WHERE np.user_id = auth.uid() AND np.application = 'toursred' AND np.channel = 'sms'), false),
           'cancelacion',  COALESCE((SELECT np.viajero_cancelacion  FROM messaging_private.notification_preferences np WHERE np.user_id = auth.uid() AND np.application = 'toursred' AND np.channel = 'sms'), false),
           'recordatorio', COALESCE((SELECT np.viajero_recordatorio FROM messaging_private.notification_preferences np WHERE np.user_id = auth.uid() AND np.application = 'toursred' AND np.channel = 'sms'), false))
   WHERE auth.uid() IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_traveler_sms_preferences(p_confirmacion boolean, p_cancelacion boolean, p_recordatorio boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_confirmacion IS NULL OR p_cancelacion IS NULL OR p_recordatorio IS NULL THEN
    RAISE EXCEPTION 'Sesion requerida';
  END IF;
  -- transactional_enabled queda como reflejo de «alguno encendido» para quien aun lo lea; ya no decide nada.
  INSERT INTO messaging_private.notification_preferences(user_id, transactional_enabled, viajero_confirmacion, viajero_cancelacion, viajero_recordatorio)
  VALUES (auth.uid(), p_confirmacion OR p_cancelacion OR p_recordatorio, p_confirmacion, p_cancelacion, p_recordatorio)
  ON CONFLICT (user_id, application, channel) DO UPDATE
    SET transactional_enabled = excluded.transactional_enabled,
        viajero_confirmacion  = excluded.viajero_confirmacion,
        viajero_cancelacion   = excluded.viajero_cancelacion,
        viajero_recordatorio  = excluded.viajero_recordatorio,
        updated_at = now();
END
$function$;

-- Las de un solo interruptor siguen funcionando (la pantalla de verificar telefono pudo cachearlas): mueven los tres.
CREATE OR REPLACE FUNCTION public.set_my_sms_preferences(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'Sesion requerida'; END IF;
  PERFORM public.set_my_traveler_sms_preferences(p_enabled, p_enabled, p_enabled);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_my_sms_preferences()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT np.viajero_confirmacion OR np.viajero_cancelacion OR np.viajero_recordatorio
                     FROM messaging_private.notification_preferences np
                    WHERE np.user_id = auth.uid() AND np.application = 'toursred' AND np.channel = 'sms'), false)
   WHERE auth.uid() IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_my_traveler_sms_preferences() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_traveler_sms_preferences(boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_traveler_sms_preferences() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_traveler_sms_preferences(boolean, boolean, boolean) TO authenticated, service_role;

-- 6. El reinicio del cobro tambien apaga (y respalda) los avisos por tipo del viajero --------------------------------------------
-- aplicar_inicio_cobro_notificaciones (fase 1) solo conocia transactional_enabled y agencia_*. Con las columnas nuevas, SIN esto el
-- reinicio no habria apagado los avisos del viajero que no esta cubierto: seguirian activos aunque el cobro ya hubiera empezado.
ALTER TABLE messaging_private.notification_preferences_respaldo
  ADD COLUMN IF NOT EXISTS viajero_confirmacion boolean,
  ADD COLUMN IF NOT EXISTS viajero_cancelacion  boolean,
  ADD COLUMN IF NOT EXISTS viajero_recordatorio boolean;

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

  -- Apagado: no toca preferencias, y limpia la marca para que un nuevo inicio vuelva a reiniciar.
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
       AND (np.transactional_enabled OR np.viajero_confirmacion OR np.viajero_cancelacion OR np.viajero_recordatorio
            OR np.agencia_reserva OR np.agencia_cancelacion OR np.agencia_mensaje)
     FOR UPDATE
  LOOP
    -- Quien esta cubierto (ToursRed Plus, o una suscripcion que ya existiera) conserva sus preferencias.
    v_viajero := (r.transactional_enabled OR r.viajero_confirmacion OR r.viajero_cancelacion OR r.viajero_recordatorio)
                 AND messaging_private.cobertura_notificaciones('viajero', r.user_id, NULL) IS NULL;
    v_agencia := (r.agencia_reserva OR r.agencia_cancelacion OR r.agencia_mensaje)
                 AND messaging_private.cobertura_notificaciones('agencia', r.user_id, messaging_private.agencia_de_usuario(r.user_id)) IS NULL;
    IF v_viajero OR v_agencia THEN
      -- Respaldo ANTES de apagar: para volver a dejarlas como estaban si hace falta.
      INSERT INTO messaging_private.notification_preferences_respaldo
        (user_id, application, channel, transactional_enabled, viajero_confirmacion, viajero_cancelacion, viajero_recordatorio,
         agencia_reserva, agencia_cancelacion, agencia_mensaje, motivo)
      VALUES
        (r.user_id, r.application, r.channel, r.transactional_enabled, r.viajero_confirmacion, r.viajero_cancelacion, r.viajero_recordatorio,
         r.agencia_reserva, r.agencia_cancelacion, r.agencia_mensaje, 'inicio del cobro de notificaciones');
      UPDATE messaging_private.notification_preferences
         SET transactional_enabled = CASE WHEN v_viajero THEN false ELSE transactional_enabled END,
             viajero_confirmacion  = CASE WHEN v_viajero THEN false ELSE viajero_confirmacion END,
             viajero_cancelacion   = CASE WHEN v_viajero THEN false ELSE viajero_cancelacion END,
             viajero_recordatorio  = CASE WHEN v_viajero THEN false ELSE viajero_recordatorio END,
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
