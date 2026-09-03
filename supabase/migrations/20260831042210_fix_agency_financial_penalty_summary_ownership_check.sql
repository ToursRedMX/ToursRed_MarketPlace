-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831042210
--   name:    fix_agency_financial_penalty_summary_ownership_check
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

-- BUG: ambas devolvian datos financieros reales de la agencia (ingresos,
-- comisiones, ganancias netas, pagos pendientes) sin ninguna verificacion de
-- que quien llama sea el dueño de esa agencia o admin. Cualquier usuario
-- autenticado podia pasar el agency_id de una agencia ajena/competidora y
-- ver su resumen financiero completo.
CREATE OR REPLACE FUNCTION public.get_agency_financial_summary(agency_uuid uuid)
 RETURNS TABLE(total_bookings bigint, total_revenue numeric, total_commissions numeric, net_earnings numeric, pending_payouts numeric)
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
SELECT 1 FROM agencies a WHERE a.id = agency_uuid AND a.user_id = auth.uid()
) OR EXISTS (
SELECT 1 FROM agency_staff s WHERE s.agency_id = agency_uuid AND s.user_id = auth.uid() AND s.is_active = true
) INTO v_belongs_to_agency;

IF NOT v_belongs_to_agency AND COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'No autorizado';
END IF;

RETURN QUERY
SELECT
COUNT(cr.id) as total_bookings,
SUM(cr.total_tour_price) as total_revenue,
SUM(cr.agency_commission_amount) as total_commissions,
SUM(cr.agency_net_amount) as net_earnings,
SUM(CASE WHEN cr.status = 'pending' THEN cr.agency_net_amount ELSE 0 END) as pending_payouts
FROM commission_records cr
WHERE cr.agency_id = agency_uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_penalty_summary(p_agency_id uuid)
 RETURNS TABLE(total_pending numeric, total_processed numeric, pending_count bigint, processed_count bigint)
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
SELECT 1 FROM agencies a WHERE a.id = p_agency_id AND a.user_id = auth.uid()
) OR EXISTS (
SELECT 1 FROM agency_staff s WHERE s.agency_id = p_agency_id AND s.user_id = auth.uid() AND s.is_active = true
) INTO v_belongs_to_agency;

IF NOT v_belongs_to_agency AND COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RAISE EXCEPTION 'No autorizado';
END IF;

RETURN QUERY
SELECT
COALESCE(SUM(CASE WHEN cpr.status = 'pending' THEN cpr.agency_net_amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cpr.status = 'processed' THEN cpr.agency_net_amount ELSE 0 END), 0),
COUNT(CASE WHEN cpr.status = 'pending' THEN 1 END),
COUNT(CASE WHEN cpr.status = 'processed' THEN 1 END)
FROM cancellation_penalty_records cpr
WHERE cpr.agency_id = p_agency_id;
END;
$function$
;
