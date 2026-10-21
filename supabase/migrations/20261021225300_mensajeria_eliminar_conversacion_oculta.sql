-- Mensajeria: "eliminar conversacion" = ocultarla SOLO para quien la borra.
--
-- Pedido de Axel (21-oct-2026): el boton no existia ni en la pantalla ni en la base. Decision: la
-- conversacion se oculta unicamente para quien la elimina; la otra parte y los admins la conservan y
-- reaparece si llega un mensaje nuevo (no se destruye historial).
--
-- Se usa message_participants.is_active, que ya existia y nada escribia en false (comprobado el
-- 21-oct: las 4 filas estan en true). El front la apaga con un UPDATE de su propia fila, que la
-- politica "Users can update their own participation status" ya permite.
--
-- 1. _get_user_conversations_internal (la lista de la pantalla) deja de mostrar las conversaciones
--    donde el usuario esta oculto. Un admin que NO participa sigue viendolas todas, como antes.
--    La funcion se reescribe a partir de su definicion en la base y falla si el fragmento no se
--    encuentra, para no dejarla a medio cambiar.
-- 2. Un mensaje nuevo vuelve a activar a los participantes ocultos de esa conversacion.

DO $$
DECLARE d text; rewritten text;
  viejo text := 'WHERE v_is_admin OR mp_user.user_id IS NOT NULL';
  nuevo text := 'WHERE (v_is_admin AND mp_user.user_id IS NULL) OR (mp_user.user_id IS NOT NULL AND mp_user.is_active IS NOT FALSE)';
BEGIN
  SELECT pg_get_functiondef('public._get_user_conversations_internal(uuid)'::regprocedure) INTO d;
  rewritten := replace(d, viejo, nuevo);
  IF rewritten = d THEN
    RAISE EXCEPTION 'No se encontro el filtro de la lista de conversaciones; la funcion cambio';
  END IF;
  EXECUTE rewritten;
END $$;

CREATE OR REPLACE FUNCTION public.reactivar_participantes_al_recibir_mensaje()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.message_participants
     SET is_active = true
   WHERE conversation_id = NEW.conversation_id
     AND is_active = false;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reactivar_participantes_al_recibir_mensaje_trigger ON public.messages;
CREATE TRIGGER reactivar_participantes_al_recibir_mensaje_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.reactivar_participantes_al_recibir_mensaje();
