-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831011501
--   name:    fix_create_commission_records_for_receptivo_slot_tour_override
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

CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_slot_record    record;
v_booking_record record;
v_breakdown      record;
v_created_count  integer := 0;
v_skipped_count  integer := 0;
v_rates          record;
BEGIN
-- Authorization: only admin
IF NOT public.is_admin_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

SELECT
ts.id, ts.slot_date, ts.departure_time, ts.tour_id,
t.name AS tour_name, t.agency_id, t.tour_type
INTO v_slot_record
FROM public.tour_slots ts
INNER JOIN public.tours t ON t.id = ts.tour_id
WHERE ts.id = p_slot_id
AND ts.slot_date < CURRENT_DATE
AND t.tour_type = 'receptivo';

IF NOT FOUND THEN
RETURN json_build_object(
'success', false,
'message', 'Slot no encontrado, no pertenece a un tour receptivo, o su fecha aun no ha pasado',
'created_count', 0, 'skipped_count', 0
);
END IF;

-- Mismo fix que create_commission_records_for_tour: usar la version de DOS
-- argumentos para respetar un override de tasa especifico del tour.
SELECT * INTO v_rates
FROM public.get_effective_commission_rates(v_slot_record.agency_id, v_slot_record.tour_id);

FOR v_booking_record IN
SELECT
b.id AS booking_id, b.agency_id, b.total_price,
b.commission_amount, b.service_charge, b.platform_revenue,
b.membership_service_fee_saved, b.preventa_comision_descuento,
b.travel_insurance_cost
FROM public.bookings b
WHERE b.slot_id = p_slot_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
LOOP
SELECT * INTO v_breakdown
FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

INSERT INTO public.commission_records (
booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
agency_commission_rate, agency_commission_amount,
service_charge_rate, service_charge_amount,
gross_service_charge_amount, membership_exemption_total,
preventa_comision_descuento,
payment_plan_service_charges, payment_plan_membership_exemptions,
optional_services_subtotal, optional_services_commission,
optional_services_service_charge, optional_services_agency_net,
supplements_subtotal, supplements_commission,
supplements_service_charge, supplements_agency_net,
platform_total_revenue, agency_net_amount, status, created_at
) VALUES (
v_booking_record.booking_id, v_booking_record.agency_id,
v_slot_record.tour_id, v_slot_record.slot_date, v_booking_record.total_price,
v_rates.agency_commission_rate, v_booking_record.commission_amount,
v_rates.service_charge_rate, v_booking_record.service_charge,
v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
COALESCE(v_booking_record.preventa_comision_descuento, 0),
v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
'pending', now()
)
ON CONFLICT (booking_id) DO UPDATE SET
total_tour_price = EXCLUDED.total_tour_price,
agency_commission_amount = EXCLUDED.agency_commission_amount,
service_charge_amount = EXCLUDED.service_charge_amount,
gross_service_charge_amount = EXCLUDED.gross_service_charge_amount,
membership_exemption_total = EXCLUDED.membership_exemption_total,
preventa_comision_descuento = EXCLUDED.preventa_comision_descuento,
payment_plan_service_charges = EXCLUDED.payment_plan_service_charges,
payment_plan_membership_exemptions = EXCLUDED.payment_plan_membership_exemptions,
optional_services_subtotal = EXCLUDED.optional_services_subtotal,
optional_services_commission = EXCLUDED.optional_services_commission,
optional_services_service_charge = EXCLUDED.optional_services_service_charge,
optional_services_agency_net = EXCLUDED.optional_services_agency_net,
supplements_subtotal = EXCLUDED.supplements_subtotal,
supplements_commission = EXCLUDED.supplements_commission,
supplements_service_charge = EXCLUDED.supplements_service_charge,
supplements_agency_net = EXCLUDED.supplements_agency_net,
platform_total_revenue = EXCLUDED.platform_total_revenue,
agency_net_amount = EXCLUDED.agency_net_amount,
updated_at = now();

v_created_count := v_created_count + 1;
END LOOP;

SELECT COUNT(*) INTO v_skipped_count
FROM public.bookings b
WHERE b.slot_id = p_slot_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
AND NOT EXISTS (
SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
);

RETURN json_build_object(
'success', true,
'message', 'Commission records creados/actualizados exitosamente',
'created_count', v_created_count,
'skipped_count', v_skipped_count
);
END;
$function$
;
