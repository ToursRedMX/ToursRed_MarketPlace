-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831043944
--   name:    fix_get_unread_notifications_count_overload_self_only
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

-- Sobrecarga con parametro p_user_id: no verificaba que coincidiera con
-- auth.uid(). Confirmado que el frontend SOLO usa la version sin parametro
-- (que ya es segura); esta es codigo muerto pero expuesto a authenticated,
-- permitiendo a cualquier usuario ver el conteo de notificaciones no leidas
-- de otro usuario (bajo impacto -- solo un numero, sin contenido -- pero es
-- una fuga de autorizacion real).
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
unread_count integer;
BEGIN
IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
RETURN 0;
END IF;

SELECT COUNT(*)::integer INTO unread_count
FROM notifications
WHERE user_id = p_user_id
AND is_read = false
AND (expires_at IS NULL OR expires_at > now());
RETURN unread_count;
END;
$function$
;
