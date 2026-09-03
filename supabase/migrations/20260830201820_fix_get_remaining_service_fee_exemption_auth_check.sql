-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830201820
--   name:    fix_get_remaining_service_fee_exemption_auth_check
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

CREATE OR REPLACE FUNCTION public.get_remaining_service_fee_exemption(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_exemption_used decimal;
v_reset_date timestamptz;
v_monthly_limit numeric;
v_remaining numeric;
BEGIN
-- Antes esta funcion no validaba que el llamante fuera el propio usuario:
-- cualquier usuario autenticado (o incluso anon, si tuviera el nombre exacto
-- de la funcion) podia pasar el UUID de otra persona y ver cuanto de su
-- exencion mensual de membresia ya uso / le queda. No mueve dinero, pero es
-- una fuga de informacion horizontal real y trivial de cerrar.
IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RETURN jsonb_build_object('error', 'No autorizado', 'remaining', 0, 'monthly_limit', 0);
END IF;

SELECT COALESCE(membership_service_fee_exemption_monthly_limit, 500)
INTO v_monthly_limit
FROM public.platform_settings
LIMIT 1;

IF v_monthly_limit IS NULL THEN
v_monthly_limit := 500;
END IF;

SELECT
service_fee_exemption_used,
service_fee_exemption_reset_date
INTO
v_exemption_used,
v_reset_date
FROM public.memberships
WHERE user_id = p_user_id
AND status <> 'expired'
AND current_period_end > now()
ORDER BY current_period_end DESC
LIMIT 1;

IF NOT FOUND THEN
RETURN jsonb_build_object('remaining', 0, 'monthly_limit', v_monthly_limit);
END IF;

IF now() >= v_reset_date THEN
v_remaining := v_monthly_limit;
ELSE
v_remaining := GREATEST(0, v_monthly_limit - v_exemption_used);
END IF;

RETURN jsonb_build_object('remaining', v_remaining, 'monthly_limit', v_monthly_limit);
END;
$function$
;
