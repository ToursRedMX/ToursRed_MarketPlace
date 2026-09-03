-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831043041
--   name:    fix_get_staff_with_permissions_self_only
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

-- BUG: aceptaba cualquier p_user_id sin verificar que coincidiera con
-- auth.uid(). Uso legitimo confirmado (AuthContext.tsx) siempre es
-- auto-consulta con el propio ID de sesion. Cualquier usuario autenticado
-- podia pasar el user_id de otro y ver en que agencia trabaja, su puesto, y
-- sus permisos exactos (ver financieros, gestionar tours, etc.) -- fuga
-- menor de informacion organizacional.
CREATE OR REPLACE FUNCTION public.get_staff_with_permissions(p_user_id uuid)
 RETURNS TABLE(staff_id uuid, agency_id uuid, agency_name text, title text, is_active boolean, can_scan_checkin boolean, can_view_bookings boolean, can_view_tours boolean, can_edit_tours boolean, can_manage_tours boolean, can_view_financials boolean, can_view_reports boolean, can_manage_discount_codes boolean, can_view_messages boolean, can_manage_destinations boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT
s.id, s.agency_id, a.name, s.title, s.is_active,
COALESCE(p.can_scan_checkin, false),
COALESCE(p.can_view_bookings, false),
COALESCE(p.can_view_tours, false),
COALESCE(p.can_edit_tours, false),
COALESCE(p.can_manage_tours, false),
COALESCE(p.can_view_financials, false),
COALESCE(p.can_view_reports, false),
COALESCE(p.can_manage_discount_codes, false),
COALESCE(p.can_view_messages, false),
COALESCE(p.can_manage_destinations, false)
FROM agency_staff s
JOIN agencies a ON a.id = s.agency_id
LEFT JOIN agency_staff_permissions p ON p.staff_id = s.id
WHERE s.user_id = p_user_id
AND s.is_active = true
AND p_user_id = auth.uid()
ORDER BY s.linked_at ASC;
$function$
;
