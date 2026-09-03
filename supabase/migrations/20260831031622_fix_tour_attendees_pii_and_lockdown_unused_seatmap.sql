-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831031622
--   name:    fix_tour_attendees_pii_and_lockdown_unused_seatmap
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- get_tour_confirmed_attendees: devuelve email + nombre completo de los
-- viajeros confirmados de CUALQUIER tour, sin ninguna verificacion de que
-- quien llama sea la agencia dueña del tour o admin. Usada legitimamente
-- solo desde TourMassMessageModal.tsx (mensajeria masiva de agencia a sus
-- propios asistentes), pero al no haber chequeo server-side, cualquier
-- usuario autenticado podia llamar el RPC directo con cualquier tour_id y
-- obtener el PII (email, nombre) de los viajeros de un tour ajeno.
CREATE OR REPLACE FUNCTION public.get_tour_confirmed_attendees(p_tour_id uuid, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_id uuid, user_id uuid, email text, first_name text, last_name text, travelers_count integer, selected_date date, selected_time time without time zone, booking_code character varying)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_role text;
v_belongs_to_agency boolean;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();

SELECT EXISTS (
SELECT 1 FROM tours t JOIN agencies a ON a.id = t.agency_id
WHERE t.id = p_tour_id AND a.user_id = auth.uid()
) OR EXISTS (
SELECT 1 FROM tours t JOIN agency_staff s ON s.agency_id = t.agency_id
WHERE t.id = p_tour_id AND s.user_id = auth.uid() AND s.is_active = true
) INTO v_belongs_to_agency;

IF NOT v_belongs_to_agency AND COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'No autorizado';
END IF;

RETURN QUERY
SELECT
b.id, b.user_id, u.email, u.first_name, u.last_name,
b.travelers_count, b.selected_date, b.selected_time, b.booking_code
FROM bookings b
JOIN users u ON u.id = b.user_id
WHERE b.tour_id = p_tour_id
AND b.status = 'confirmed'
AND (p_slot_id IS NULL OR b.slot_id = p_slot_id);
END;
$function$;

-- get_seat_map_availability: 0 referencias en el codigo actual (codigo
-- muerto), pero seguia otorgada a anon (sin login) y devuelve el nombre del
-- viajero de cada asiento ocupado. Se revoca el acceso publico ya que nada
-- legitimo depende de que sea publicamente invocable.
REVOKE EXECUTE ON FUNCTION public.get_seat_map_availability(uuid, uuid) FROM PUBLIC, anon, authenticated
;
