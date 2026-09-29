-- ============================================================================
-- "Not authorized to create notification for this user" al crear una reserva
-- de aprobacion manual desde el flujo de 4 pasos.
--
-- create_notification() (20260814192237) tiene una guardia de defensa en
-- profundidad: si auth.uid() no es NULL y el destinatario (p_user_id) no es
-- el propio llamador, exige rol admin. Pensada contra alguien llamando la
-- RPC directo para spamear notificaciones a otros usuarios -aunque el
-- REVOKE de esa migracion ya se los impide: EXECUTE solo esta concedido a
-- service_role/postgres-.
--
-- Lo que no contemplaba: handle_booking_approval_notification() -trigger
-- AFTER INSERT en bookings, tambien SECURITY DEFINER- llama
-- create_notification(agency_owner_id, ...) para avisarle a la AGENCIA de
-- una solicitud nueva. auth.uid() no cambia dentro de un SECURITY DEFINER
-- -sigue siendo el JWT de quien inicio la cadena, el viajero-, asi que la
-- guardia ve "un viajero intentando notificar a alguien mas" y lo bloquea,
-- aunque sea el propio trigger del sistema el que decide a quien avisar, no
-- el usuario.
--
-- Antes de 20260929010000/92bef95 esto nunca se disparaba: el flujo de 4
-- pasos creaba TODA reserva con approval_status='approved' (nadie entraba
-- por la rama 'pending' via INSERT), y el flujo viejo (BookingForm.tsx)
-- crea todo en status='draft', que el propio trigger salta
-- (`IF TG_OP='INSERT' AND NEW.status='draft' THEN RETURN;`). Conectar la
-- aprobacion manual al flujo nuevo -crear directo en 'pending', sin pasar
-- por 'draft'- fue la primera vez que se ejercito esta combinacion.
--
-- MISMO patron ya resuelto en insert_audit_log (20260910190000, ver
-- claude.md): pg_trigger_depth() > 0 solo es cierto DENTRO de un trigger,
-- donde el destinatario lo decide la tabla/el trigger, no el usuario que
-- llamo. Se agrega la misma excepcion aqui.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  notification_id uuid;
  v_caller_role text;
BEGIN
  -- Defense-in-depth: si se llama via API como usuario autenticado (no
  -- service_role) Y fuera de un trigger, verificar que tenga permiso para
  -- notificar a este destinatario. pg_trigger_depth() = 0 excluye las
  -- llamadas que hace un trigger del sistema en nombre de la tabla -ahi el
  -- destinatario no lo eligio el usuario.
  IF auth.uid() IS NOT NULL AND pg_trigger_depth() = 0 THEN
    IF p_user_id = auth.uid() THEN
      -- Self-notification is allowed
      NULL;
    ELSE
      -- Check if caller is an admin
      SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
      IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Not authorized to create notification for this user';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, expires_at)
  VALUES (p_user_id, p_type, p_title, p_message, p_data, p_expires_at)
  RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$function$;

-- Re-apply the REVOKE to maintain lockdown
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz)
  FROM PUBLIC, authenticated;

-- Grant only to service_role and postgres (for triggers and internal use)
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz)
  TO service_role, postgres;
