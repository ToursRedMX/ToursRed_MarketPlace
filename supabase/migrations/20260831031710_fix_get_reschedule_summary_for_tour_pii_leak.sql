-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831031710
--   name:    fix_get_reschedule_summary_for_tour_pii_leak
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

-- BUG: devolvia email + nombre completo de todos los viajeros afectados por
-- una reprogramacion, sin ninguna verificacion de que quien llama pertenezca
-- a la agencia dueña del tour reprogramado o sea admin. Cualquier usuario
-- autenticado podia pasar cualquier tour_reschedule_id y obtener PII de
-- viajeros ajenos.
CREATE OR REPLACE FUNCTION public.get_reschedule_summary_for_tour(p_tour_reschedule_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_result JSON;
v_caller_role text;
v_belongs_to_agency boolean;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();

SELECT EXISTS (
SELECT 1 FROM tour_reschedules tr
JOIN agencies a ON a.id = tr.agency_id
WHERE tr.id = p_tour_reschedule_id AND a.user_id = auth.uid()
) OR EXISTS (
SELECT 1 FROM tour_reschedules tr
JOIN agency_staff s ON s.agency_id = tr.agency_id
WHERE tr.id = p_tour_reschedule_id AND s.user_id = auth.uid() AND s.is_active = true
) INTO v_belongs_to_agency;

IF NOT v_belongs_to_agency AND COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'No autorizado';
END IF;

SELECT json_build_object(
'total', COUNT(*),
'pending', COUNT(*) FILTER (WHERE response = 'pending'),
'accepted', COUNT(*) FILTER (WHERE response = 'accepted'),
'rejected', COUNT(*) FILTER (WHERE response = 'rejected'),
'auto_accepted', COUNT(*) FILTER (WHERE response = 'auto_accepted'),
'responses', json_agg(
json_build_object(
'booking_id', brr.booking_id, 'booking_code', b.booking_code,
'user_name', u.first_name || ' ' || u.last_name,
'user_email', u.email, 'response', brr.response, 'responded_at', brr.responded_at
) ORDER BY brr.created_at
)
) INTO v_result
FROM booking_reschedule_responses brr
INNER JOIN bookings b ON brr.booking_id = b.id
INNER JOIN users u ON brr.user_id = u.id
WHERE brr.tour_reschedule_id = p_tour_reschedule_id;
RETURN v_result;
END;
$function$
;
