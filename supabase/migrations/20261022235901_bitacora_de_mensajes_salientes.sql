-- Bitacora de mensajes salientes (SMS y WhatsApp) para el admin.
--
-- Pedido de Axel (22-oct-2026): un panel como el de los correos donde el admin vea CADA mensaje que salio por la
-- plataforma: por que canal y proveedor, el texto, a quien y a que telefono, si el proveedor aviso entrega o lectura
-- (o un rechazo) y cuanto costo.
--
-- LO QUE YA ESTABA: notification_attempts (un renglon por intento: proveedor, canal, categoria, estado, segmentos, costo
-- real si el proveedor lo informo, codigos de error) y notification_events (la linea de tiempo que avisa el proveedor).
--
-- LO QUE FALTABA, y que esta migracion agrega al INTENTO (no a la cola, que se limpia):
--   * message_text      el texto enviado. El codigo de un OTP NUNCA se guarda: lo tacha quien envia (Edge Function) y,
--                       como defensa en profundidad, esta misma funcion lo vuelve a tachar si la categoria es 'otp'.
--   * destination_e164  el telefono. Antes un OTP lo perdia a las 24 h: phone_verifications se purga y el FK del intento
--                       queda en NULL, asi que un WhatsApp de verificacion de ayer ya no decia a quien fue.
--   * user_id           a quien se le mando, por el mismo motivo.
--   Los intentos anteriores a esta migracion no tienen texto (no se guardaba); los de reserva/recordatorio conservan el
--   telefono y el usuario mientras su fila de la cola exista (90 dias).
--
-- Todo se borra junto con el intento a los 90 dias (purge_sms_private_data ya borra los intentos). Solo lo lee un
-- administrador con permiso de configuracion (y MFA si esta exigido), por funciones; las tablas siguen sin acceso directo.
--
-- COSTO por mensaje:
--   * costo real: lo que informo el proveedor (hoy vacio en todos los envios de Twilio; ver el pendiente anotado).
--   * costo estimado (MXN): con la tarifa configurada en tarifas_mensajeria, aplicada como en el cierre mensual: se acumulan
--     los segmentos del mes (hora de Ciudad de Mexico) por proveedor y canal, y cada mensaje cuesta solo la parte de sus
--     segmentos que cae POR ENCIMA de lo incluido. Por eso los primeros mensajes del mes salen en cero.

-- 1. Lo que se guarda en el intento ------------------------------------------------------------------------
ALTER TABLE messaging_private.notification_attempts
  ADD COLUMN IF NOT EXISTS message_text     text,
  ADD COLUMN IF NOT EXISTS destination_e164 text,
  ADD COLUMN IF NOT EXISTS user_id          uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE messaging_private.notification_attempts
  ADD CONSTRAINT notification_attempts_message_text_check CHECK (message_text IS NULL OR length(message_text) <= 1000),
  ADD CONSTRAINT notification_attempts_destination_check CHECK (destination_e164 IS NULL OR destination_e164 ~ '^\+[1-9][0-9]{7,14}$');

COMMENT ON COLUMN messaging_private.notification_attempts.message_text IS
  'Texto enviado, para la bitacora del admin. En los OTP el codigo va tachado (nunca se guarda). Nulo en los intentos anteriores al 23-oct-2026.';

CREATE INDEX IF NOT EXISTS notification_attempts_created_at_idx
  ON messaging_private.notification_attempts (created_at DESC);

-- 2. Guardar texto, destino y usuario de un intento ------------------------------------------------------------
-- La llama la Edge Function justo despues de abrir el intento y ANTES de hablar con el proveedor, con el texto ya tachado si
-- es un OTP. Mejor esfuerzo: si falla, el envio sigue (la bitacora nunca debe impedir un mensaje).
CREATE OR REPLACE FUNCTION public.record_sms_text(p_attempt uuid, p_text text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  a messaging_private.notification_attempts;
  v_user uuid;
  v_dest text;
  v_text text;
BEGIN
  SELECT * INTO a FROM messaging_private.notification_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL THEN RETURN; END IF;
  -- Idempotente: un reintento de la misma llamada no pisa lo ya guardado.
  IF a.message_text IS NOT NULL THEN RETURN; END IF;

  IF a.outbox_id IS NOT NULL THEN
    SELECT o.user_id, o.destination_e164 INTO v_user, v_dest
      FROM messaging_private.notification_outbox o WHERE o.id = a.outbox_id;
  ELSIF a.verification_id IS NOT NULL THEN
    SELECT pv.user_id, pv.phone_e164 INTO v_user, v_dest
      FROM messaging_private.phone_verifications pv WHERE pv.id = a.verification_id;
  END IF;

  v_text := left(COALESCE(p_text, ''), 1000);
  IF a.category = 'otp' THEN
    -- Defensa en profundidad: aunque quien llama olvide tachar el codigo, aqui nunca se guarda una racha de 4 o mas digitos.
    v_text := regexp_replace(v_text, '[0-9]{4,}', '••••••', 'g');
  END IF;

  UPDATE messaging_private.notification_attempts
     SET message_text = v_text,
         destination_e164 = v_dest,
         user_id = v_user
   WHERE id = a.id;
END
$function$;

-- 3. Listado para la pantalla ------------------------------------------------------------------------------------
-- Un renglon por INTENTO (como la bitacora de correo): el principal y, si lo hubo, el de respaldo o el reintento.
CREATE OR REPLACE FUNCTION public.listar_mensajes_salientes(
  p_desde timestamptz DEFAULT NULL,
  p_hasta timestamptz DEFAULT NULL,
  p_canal text DEFAULT NULL,
  p_proveedor text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_busqueda text DEFAULT NULL,
  p_limite integer DEFAULT 25,
  p_desplazamiento integer DEFAULT 0)
RETURNS TABLE(
  intento_id uuid, creado_en timestamptz, canal text, proveedor text, categoria text, estado text,
  es_respaldo boolean, numero_intento smallint, simulado boolean,
  usuario_id uuid, usuario_nombre text, usuario_email text, telefono text, texto text,
  segmentos smallint, costo_real numeric, moneda_costo text, costo_estimado_mxn numeric,
  codigo_error text, clase_fallo text, id_proveedor text, correlacion text, eventos jsonb, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_limite integer;
  v_desplaza integer;
  v_desde_calculo timestamptz;
  v_busqueda text;
  v_digitos text;
BEGIN
  PERFORM messaging_private.require_settings_admin();
  v_limite := greatest(1, least(COALESCE(p_limite, 25), 100));
  v_desplaza := greatest(0, COALESCE(p_desplazamiento, 0));
  v_busqueda := lower(nullif(btrim(COALESCE(p_busqueda, '')), ''));
  v_digitos := nullif(regexp_replace(COALESCE(p_busqueda, ''), '[^0-9]', '', 'g'), '');

  -- La acumulacion del mes para el costo estimado tiene que empezar en el 1 del mes mas antiguo que se consulta.
  v_desde_calculo := date_trunc('month', COALESCE(p_desde, now() - interval '30 days') AT TIME ZONE 'America/Mexico_City')
                     AT TIME ZONE 'America/Mexico_City';

  RETURN QUERY
  WITH base AS (
    SELECT a.id, a.created_at, a.channel, a.provider, a.category, a.status, a.routing_reason, a.attempt_number,
           a.is_simulated, a.segments, a.cost, a.cost_unit, a.error_code, a.failure_class,
           a.provider_message_id, a.correlation_id, a.message_text,
           COALESCE(a.user_id, o.user_id, pv.user_id) AS uid,
           COALESCE(a.destination_e164, o.destination_e164, pv.phone_e164) AS dest,
           CASE WHEN NOT a.is_simulated AND a.provider_message_id IS NOT NULL THEN
             sum(a.segments) OVER (
               PARTITION BY a.provider, a.channel, date_trunc('month', a.created_at AT TIME ZONE 'America/Mexico_City')
               ORDER BY a.created_at, a.id)
           END AS acumulado
      FROM messaging_private.notification_attempts a
      LEFT JOIN messaging_private.notification_outbox o ON o.id = a.outbox_id
      LEFT JOIN messaging_private.phone_verifications pv ON pv.id = a.verification_id
     WHERE a.created_at >= v_desde_calculo
  ),
  costeado AS (
    SELECT b.*,
           CASE WHEN b.acumulado IS NULL OR t.proveedor IS NULL THEN NULL
                ELSE round((greatest(0, b.acumulado - t.incluidos_al_mes)
                          - greatest(0, b.acumulado - b.segments - t.incluidos_al_mes)) * t.costo_unitario_mxn, 4)
           END AS costo_est
      FROM base b
      LEFT JOIN public.tarifas_mensajeria t
        ON t.proveedor = b.provider AND t.canal = b.channel AND t.activo
  ),
  filtrado AS (
    SELECT c.*, u.first_name, u.last_name, u.email
      FROM costeado c
      LEFT JOIN public.users u ON u.id = c.uid
     WHERE (p_desde IS NULL OR c.created_at >= p_desde)
       AND (p_hasta IS NULL OR c.created_at <= p_hasta)
       AND (p_canal IS NULL OR c.channel = p_canal)
       AND (p_proveedor IS NULL OR c.provider = p_proveedor)
       AND (p_estado IS NULL OR c.status = p_estado)
       AND (p_categoria IS NULL OR c.category = p_categoria)
       AND (v_busqueda IS NULL
            OR (v_digitos IS NOT NULL AND length(v_digitos) >= 3 AND position(v_digitos in COALESCE(c.dest, '')) > 0)
            OR position(v_busqueda in lower(COALESCE(u.email, ''))) > 0
            OR position(v_busqueda in lower(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) > 0
            OR position(v_busqueda in lower(COALESCE(c.message_text, ''))) > 0)
  )
  SELECT f.id, f.created_at, f.channel, f.provider, f.category, f.status,
         (f.routing_reason = 'fallback_confirmado'), f.attempt_number, f.is_simulated,
         f.uid, btrim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), f.email, f.dest, f.message_text,
         f.segments, f.cost, f.cost_unit, f.costo_est,
         f.error_code, f.failure_class, f.provider_message_id, f.correlation_id,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', e.event_type, 'codigo', e.provider_code, 'cuando', e.occurred_at)
                                    ORDER BY e.occurred_at, e.id), '[]'::jsonb)
            FROM messaging_private.notification_events e WHERE e.attempt_id = f.id),
         count(*) OVER ()
    FROM filtrado f
   ORDER BY f.created_at DESC, f.id
   LIMIT v_limite OFFSET v_desplaza;
END
$function$;

-- 4. Conteos para las tarjetas de la pantalla ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resumen_mensajes_salientes(p_desde timestamptz DEFAULT NULL)
RETURNS TABLE(canal text, proveedor text, estado text, total bigint, segmentos bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.require_settings_admin();
  RETURN QUERY
    SELECT a.channel, a.provider, a.status, count(*)::bigint, COALESCE(sum(a.segments), 0)::bigint
      FROM messaging_private.notification_attempts a
     WHERE a.created_at >= COALESCE(p_desde, now() - interval '24 hours')
       AND NOT a.is_simulated
     GROUP BY a.channel, a.provider, a.status
     ORDER BY a.channel, a.provider, a.status;
END
$function$;

-- 5. Permisos --------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_sms_text(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sms_text(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.listar_mensajes_salientes(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_mensajes_salientes(timestamptz, timestamptz, text, text, text, text, text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.resumen_mensajes_salientes(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resumen_mensajes_salientes(timestamptz) TO authenticated;
