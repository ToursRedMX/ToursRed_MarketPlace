-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831012030
--   name:    fully_null_safe_get_booking_payment_details
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

CREATE OR REPLACE FUNCTION public.get_booking_payment_details(p_booking_id uuid)
 RETURNS TABLE(booking_id uuid, total_price numeric, deposit_amount numeric, service_charge numeric, user_payment numeric, payment_status text, payment_method text, paid_at timestamp with time zone, agency_commission numeric, agency_net_amount numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_id uuid;
v_booking_user_id uuid;
v_agency_user_id uuid;
v_user_role text;
BEGIN
v_user_id := auth.uid();

IF v_user_id IS NULL THEN
RAISE EXCEPTION 'No autenticado';
END IF;

SELECT role INTO v_user_role FROM users WHERE id = v_user_id;
SELECT b.user_id INTO v_booking_user_id FROM bookings b WHERE b.id = p_booking_id;
SELECT agencies.user_id INTO v_agency_user_id
FROM bookings JOIN agencies ON bookings.agency_id = agencies.id
WHERE bookings.id = p_booking_id;

-- IS DISTINCT FROM en vez de != : inmune a NULL en cualquiera de los tres
-- lados (booking sin agencia, booking inexistente, o rol sin fila en users).
-- El != original evaluaba a NULL (no TRUE) en esos casos y el IF nunca
-- disparaba la excepcion, dejando pasar la consulta sin verificar permiso.
IF v_user_id IS DISTINCT FROM v_booking_user_id
   AND v_user_id IS DISTINCT FROM v_agency_user_id
   AND COALESCE(v_user_role, '') != 'admin' THEN
RAISE EXCEPTION 'No tienes permiso para ver los detalles de esta reserva';
END IF;

RETURN QUERY
SELECT
b.id, b.total_price, b.deposit_amount, b.service_charge, b.user_payment,
b.payment_status, b.payment_method, b.paid_at, b.commission_amount,
COALESCE(cr.agency_net_amount, b.deposit_amount - b.commission_amount)
FROM bookings b
LEFT JOIN commission_records cr ON b.id = cr.booking_id
WHERE b.id = p_booking_id;
END;
$function$
;
