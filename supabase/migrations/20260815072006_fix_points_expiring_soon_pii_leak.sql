-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260815072006
--   name:    fix_points_expiring_soon_pii_leak
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

-- New finding (TR-WPR-007): get_points_expiring_soon had EXECUTE granted to
-- 'authenticated' with no caller-role check, so any logged-in traveler could
-- call it and see email+name of every user with expiring points (PII leak).
-- Fix follows the same pattern already used in get_audit_logs_sensitive:
-- require admin/super_admin, SECURITY DEFINER so the check itself is trusted.
CREATE OR REPLACE FUNCTION public.get_points_expiring_soon(days_threshold integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, email text, nombre text, points_expiring integer, earliest_expiration timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
BEGIN
  SELECT u.role INTO v_caller_role
  FROM public.users u
  WHERE u.id = v_caller_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'permission_denied: solo administradores pueden consultar este reporte';
  END IF;

  RETURN QUERY
  SELECT
  u.id, u.email, u.nombre,
  SUM(t.amount)::integer,
  MIN(t.expires_at)
  FROM toursred_points_transactions t
  JOIN users u ON u.id = t.user_id
  WHERE t.type = 'earned'
  AND t.expires_at IS NOT NULL
  AND t.expires_at > now()
  AND t.expires_at <= now() + make_interval(days => days_threshold)
  AND t.amount > 0
  GROUP BY u.id, u.email, u.nombre
  HAVING SUM(t.amount) > 0
  ORDER BY MIN(t.expires_at) ASC;
END;
$function$
;
