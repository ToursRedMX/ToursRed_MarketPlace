-- Mensajeria: a quien se le puede escribir desde "Nuevo" (Nueva conversacion).
--
-- BUG (21-oct-2026, reportado por Axel con captura): el modal listaba "No se encontraron usuarios"
-- para un viajero. CreateConversationModal leia public.users directo, y la politica de SELECT de
-- users solo deja ver la propia fila (mas, para una agencia, a los viajeros con reserva en ella),
-- asi que un viajero nunca veia a nadie: no podia iniciar una conversacion desde ahi.
--
-- Esta funcion devuelve la lista de contactos ya filtrada por rol, sin abrir la tabla users:
--   * admin / super_admin: todos los usuarios activos menos el propio.
--   * agencia (dueno o personal activo): los viajeros con reserva en esa agencia, igual que
--     antes pero tambien para el personal, que no los veia.
--   * viajero (y cualquier otro rol): las agencias donde tiene al menos una reserva. Se devuelve
--     el nombre de la AGENCIA y NO el correo del dueno: un viajero no necesita ni debe ver el
--     correo personal de quien administra la agencia.
-- Pasa por el mismo candado de telefono que crear conversaciones (enforce_phone_operation), para
-- que un usuario sin telefono verificado vea el motivo en vez de una lista vacia.

CREATE OR REPLACE FUNCTION public.get_contactos_mensajeria()
RETURNS TABLE(id uuid, first_name text, last_name text, email text, role text, agency_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_agency uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesion requerida';
  END IF;
  PERFORM messaging_private.enforce_phone_operation('account');

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;

  IF v_role IN ('admin', 'super_admin') THEN
    RETURN QUERY
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, a.name
        FROM public.users u
        LEFT JOIN public.agencies a ON a.user_id = u.id
       WHERE u.id <> v_uid AND COALESCE(u.is_active, false)
       ORDER BY u.first_name, u.last_name;
    RETURN;
  END IF;

  SELECT a.id INTO v_agency FROM public.agencies a WHERE a.user_id = v_uid;
  IF v_agency IS NULL THEN
    SELECT s.agency_id INTO v_agency
      FROM public.agency_staff s
     WHERE s.user_id = v_uid AND s.is_active
     LIMIT 1;
  END IF;

  IF v_agency IS NOT NULL THEN
    RETURN QUERY
      SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.role, NULL::text
        FROM public.bookings b
        JOIN public.users u ON u.id = b.user_id
       WHERE b.agency_id = v_agency AND u.id <> v_uid AND COALESCE(u.is_active, false);
    RETURN;
  END IF;

  RETURN QUERY
    SELECT DISTINCT a.user_id, a.name, NULL::text, NULL::text, 'agency'::text, a.name
      FROM public.bookings b
      JOIN public.agencies a ON a.id = b.agency_id
      JOIN public.users u ON u.id = a.user_id
     WHERE b.user_id = v_uid AND a.user_id <> v_uid AND COALESCE(u.is_active, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_contactos_mensajeria() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contactos_mensajeria() TO authenticated;
