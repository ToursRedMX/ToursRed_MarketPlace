-- El personal de la agencia puede leer y responder los mensajes de la agencia (y por eso recibir
-- su aviso por SMS) SI EL DUENO LE DA el permiso "Ver Mensajes".
--
-- Pedido de Axel (22-oct-2026). Hallazgo al revisarlo: agency_staff_permissions.can_view_messages
-- ya existia, el dueno lo podia activar en la pantalla de personal, y NO HACIA NADA: ninguna
-- politica ni funcion lo leia. El personal solo veia conversaciones donde era participante, y
-- nunca lo era (las consultas de un tour solo agregan al dueno). Esta migracion conecta el
-- permiso con el acceso real:
--
--   * "Conversacion de la agencia" = una conversacion donde participa el dueno y que esta ligada a un
--     tour o a una reserva DE ESA AGENCIA, y que no es de soporte. Las demas conversaciones del dueno
--     (soporte con ToursRed, charlas sin tour ni reserva) NO se comparten con el personal.
--   * Con el permiso, el personal activo es participante de esas conversaciones: las ve, responde y
--     recibe el SMS de mensaje nuevo (el disparador de agency_message_sms_event ya avisa a los
--     participantes con can_view_messages). Al darle el permiso se le agregan las existentes (con
--     last_read_at = ahora, para que no vea cientos de "sin leer" de historial) y, desde ahi, cada
--     conversacion nueva en cuanto entra el dueno.
--   * Al quitarle el permiso, o al desactivarlo / desvincularlo, se le quita de esas conversaciones.
--
-- Los disparadores de ACCESO no capturan errores a proposito: si fallara quitar un acceso, es mejor
-- que falle la operacion del dueno (y lo vea) a que el personal conserve en silencio acceso a
-- mensajes que el dueno ya le retiro. Solo el de "entra el dueno a una conversacion nueva", que
-- unicamente AGREGA acceso, es tolerante a fallos para no tumbar la creacion de la conversacion.
-- Nunca se lee OLD/registro dentro de un AND/OR (patron 12 de CLAUDE.md).

-- 1. A que agencia pertenece una conversacion ------------------------------------------------------
CREATE OR REPLACE FUNCTION messaging_private.conversation_agency(p_conversation uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT t.agency_id
       FROM public.conversations c
       JOIN public.tours t ON t.id = c.tour_id
      WHERE c.id = p_conversation AND c.type <> 'support'),
    (SELECT b.agency_id
       FROM public.conversations c
       JOIN public.bookings b ON b.id = c.booking_id
      WHERE c.id = p_conversation AND c.type <> 'support'));
$function$;

-- 2. Poner al dia las conversaciones de UNA persona del personal -----------------------------------
CREATE OR REPLACE FUNCTION messaging_private.sync_staff_conversations(p_staff uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_user uuid;
  v_agency uuid;
  v_activo boolean;
  v_owner uuid;
  v_permiso boolean;
BEGIN
  SELECT st.user_id, st.agency_id, st.is_active INTO v_user, v_agency, v_activo
    FROM public.agency_staff st WHERE st.id = p_staff;
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT a.user_id INTO v_owner FROM public.agencies a WHERE a.id = v_agency;
  IF v_owner IS NULL THEN RETURN; END IF;

  SELECT p.can_view_messages INTO v_permiso
    FROM public.agency_staff_permissions p WHERE p.staff_id = p_staff;

  IF COALESCE(v_activo, false) AND COALESCE(v_permiso, false) THEN
    INSERT INTO public.message_participants(conversation_id, user_id, role, is_active, last_read_at)
    SELECT c.id, v_user, 'participant', true, now()
      FROM public.conversations c
      JOIN public.message_participants mo ON mo.conversation_id = c.id AND mo.user_id = v_owner
     WHERE messaging_private.conversation_agency(c.id) = v_agency
       AND v_user <> v_owner
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  ELSE
    -- Se le retira de las conversaciones de la agencia, salvo las que abrio el o donde es el viajero
    -- de la reserva (una persona del personal tambien puede ser cliente de la agencia).
    DELETE FROM public.message_participants mp
     USING public.conversations c
     WHERE mp.user_id = v_user
       AND mp.conversation_id = c.id
       AND c.created_by IS DISTINCT FROM v_user
       AND messaging_private.conversation_agency(c.id) = v_agency
       AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = c.booking_id AND b.user_id = v_user);
  END IF;
END
$function$;

-- 3. El permiso o el estado del personal cambian ---------------------------------------------------
CREATE OR REPLACE FUNCTION messaging_private.staff_permissions_conversations_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.sync_staff_conversations(NEW.staff_id);
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS staff_permissions_conversations_event ON public.agency_staff_permissions;
CREATE TRIGGER staff_permissions_conversations_event
  AFTER INSERT OR UPDATE OF can_view_messages ON public.agency_staff_permissions
  FOR EACH ROW EXECUTE FUNCTION messaging_private.staff_permissions_conversations_event();

CREATE OR REPLACE FUNCTION messaging_private.staff_active_conversations_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.sync_staff_conversations(NEW.id);
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS staff_active_conversations_event ON public.agency_staff;
CREATE TRIGGER staff_active_conversations_event
  AFTER INSERT OR UPDATE OF is_active ON public.agency_staff
  FOR EACH ROW EXECUTE FUNCTION messaging_private.staff_active_conversations_event();

-- 4. Entra el dueno a una conversacion de su agencia: se suma el personal con permiso ---------------
CREATE OR REPLACE FUNCTION messaging_private.owner_joins_conversation_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_agency uuid;
BEGIN
  v_agency := messaging_private.conversation_agency(NEW.conversation_id);
  IF v_agency IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agencies a WHERE a.id = v_agency AND a.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.message_participants(conversation_id, user_id, role, is_active, last_read_at)
  SELECT NEW.conversation_id, st.user_id, 'participant', true, now()
    FROM public.agency_staff st
    JOIN public.agency_staff_permissions p ON p.staff_id = st.id
   WHERE st.agency_id = v_agency
     AND st.is_active
     AND p.can_view_messages
     AND st.user_id <> NEW.user_id
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Solo agrega acceso: si falla, el personal no ve la conversacion, pero la conversacion se crea.
  BEGIN PERFORM messaging_private.alert('queue_error'); EXCEPTION WHEN others THEN NULL; END;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS owner_joins_conversation_event ON public.message_participants;
CREATE TRIGGER owner_joins_conversation_event
  AFTER INSERT ON public.message_participants
  FOR EACH ROW EXECUTE FUNCTION messaging_private.owner_joins_conversation_event();

-- 5. Permisos de las funciones ----------------------------------------------------------------------
REVOKE ALL ON FUNCTION messaging_private.conversation_agency(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.sync_staff_conversations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.staff_permissions_conversations_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.staff_active_conversations_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.owner_joins_conversation_event() FROM PUBLIC, anon, authenticated;

-- 6. Poner al dia al personal que YA tiene el permiso -----------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT st.id
      FROM public.agency_staff st
      JOIN public.agency_staff_permissions p ON p.staff_id = st.id
     WHERE st.is_active AND p.can_view_messages
  LOOP
    PERFORM messaging_private.sync_staff_conversations(r.id);
  END LOOP;
END $$;
