-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831012007
--   name:    fix_null_bypass_delete_destination_and_booking_payment_details
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

CREATE OR REPLACE FUNCTION public.delete_destination(destination_uuid uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  tour_count integer;
  current_user_role text;
BEGIN
  SELECT role INTO current_user_role
  FROM public.users
  WHERE id = auth.uid();

  IF COALESCE(current_user_role, '') != 'admin' THEN
    RETURN QUERY SELECT false, 'Solo los administradores pueden eliminar destinos';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO tour_count
  FROM public.tour_destinations
  WHERE destination_id = destination_uuid;

  IF tour_count > 0 THEN
    RETURN QUERY SELECT false, 'No se puede eliminar el destino porque tiene tours asociados';
    RETURN;
  END IF;

  DELETE FROM public.destination_images
  WHERE destination_id = destination_uuid;

  DELETE FROM public.destinations
  WHERE id = destination_uuid;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Destino no encontrado';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Destino eliminado correctamente';
END;
$function$;

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

IF v_user_id != v_booking_user_id AND v_user_id != v_agency_user_id AND COALESCE(v_user_role, '') != 'admin' THEN
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
