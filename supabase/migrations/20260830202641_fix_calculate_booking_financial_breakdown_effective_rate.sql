-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830202641
--   name:    fix_calculate_booking_financial_breakdown_effective_rate
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

CREATE OR REPLACE FUNCTION public.calculate_booking_financial_breakdown(p_booking_id uuid)
 RETURNS TABLE(total_tour_price numeric, agency_commission_amount numeric, gross_service_charge numeric, membership_exemption_total numeric, net_service_charge numeric, agency_net_tour numeric, payment_plan_service_charges numeric, payment_plan_membership_exemptions numeric, optional_services_subtotal numeric, optional_services_commission numeric, optional_services_service_charge numeric, optional_services_agency_net numeric, supplements_subtotal numeric, supplements_commission numeric, supplements_service_charge numeric, supplements_agency_net numeric, late_payment_penalty_total numeric, late_payment_penalty_commission numeric, late_payment_penalty_agency_net numeric, platform_total_revenue numeric, agency_payout_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking         record;
v_pp_sc           numeric := 0;
v_pp_exemption    numeric := 0;
v_opt_subtotal    numeric := 0;
v_opt_commission  numeric := 0;
v_opt_sc          numeric := 0;
v_opt_net         numeric := 0;
v_supp_subtotal   numeric := 0;
v_supp_commission numeric := 0;
v_supp_sc         numeric := 0;
v_supp_net        numeric := 0;
v_penalty_total   numeric := 0;
v_penalty_comm    numeric := 0;
v_penalty_net     numeric := 0;
v_effective_rate  numeric;
BEGIN
SELECT
b.total_price,
b.commission_amount,
b.service_charge,
b.membership_service_fee_saved,
b.preventa_comision_descuento,
b.agency_id,
b.tour_id
INTO v_booking
FROM public.bookings b
WHERE b.id = p_booking_id;

IF NOT FOUND THEN
RETURN;
END IF;

total_tour_price := COALESCE(v_booking.total_price, 0);
agency_commission_amount := COALESCE(v_booking.commission_amount, 0);
gross_service_charge := COALESCE(v_booking.service_charge, 0) + COALESCE(v_booking.membership_service_fee_saved, 0);
membership_exemption_total := COALESCE(v_booking.membership_service_fee_saved, 0);
net_service_charge := COALESCE(v_booking.service_charge, 0);
agency_net_tour := total_tour_price - agency_commission_amount;

-- Antes esta tasa se derivaba como agency_commission_amount / total_tour_price.
-- Eso rompe en cuanto hay un codigo de descuento: commission_amount se calcula
-- sobre PRECIO DE LISTA (v_base_tour_price en create_booking_atomic, la
-- comision no se ve afectada por el descuento -- la agencia lo absorbe), pero
-- total_tour_price (bookings.total_price) es el precio YA CON DESCUENTO. La
-- division inflaba la tasa efectiva (ej. $300/$1800=16.67% en vez de 15% real
-- cuando el precio de lista era $2000 con $200 de descuento), y esa tasa
-- inflada se usaba para calcular la comision de penalizaciones por atraso en
-- planes de pago -- quitandole de mas a la agencia en cualquier reserva que
-- combinara descuento + penalizacion. No habia casos en datos reales todavia
-- (por eso paso desapercibido), pero era cuestion de tiempo. Se corrige
-- re-consultando la tasa real via get_effective_commission_rates en vez de
-- derivarla de un cociente que depende del descuento.
SELECT COALESCE(agency_commission_rate, 0.15)
INTO v_effective_rate
FROM public.get_effective_commission_rates(v_booking.agency_id, v_booking.tour_id);

SELECT
COALESCE(SUM(COALESCE(t.service_charge, 0)), 0),
COALESCE(SUM(CASE WHEN t.membership_exemption_used = true THEN COALESCE(t.gross_service_charge, 0) - COALESCE(t.service_charge, 0) ELSE 0 END), 0)
INTO v_pp_sc, v_pp_exemption
FROM public.booking_payment_plan_transactions t
WHERE t.booking_id = p_booking_id AND t.status = 'completed';

payment_plan_service_charges := v_pp_sc;
payment_plan_membership_exemptions := v_pp_exemption;

SELECT
COALESCE(SUM(bos.subtotal), 0),
COALESCE(SUM(bos.agency_commission), 0),
COALESCE(SUM(bos.service_charge), 0)
INTO v_opt_subtotal, v_opt_commission, v_opt_sc
FROM public.booking_optional_services bos
WHERE bos.booking_id = p_booking_id
AND COALESCE(bos.is_cancelled, false) = false
AND bos.paid_at IS NOT NULL;

optional_services_subtotal := v_opt_subtotal;
optional_services_commission := v_opt_commission;
optional_services_service_charge := v_opt_sc;
optional_services_agency_net := v_opt_subtotal - v_opt_commission;

SELECT
COALESCE(SUM(bs.unit_price * bs.quantity), 0),
COALESCE(SUM(bs.supplement_commission), 0),
COALESCE(SUM(bs.service_charge), 0)
INTO v_supp_subtotal, v_supp_commission, v_supp_sc
FROM public.booking_supplements bs
WHERE bs.booking_id = p_booking_id AND bs.status = 'paid';

supplements_subtotal := v_supp_subtotal;
supplements_commission := v_supp_commission;
supplements_service_charge := v_supp_sc;
supplements_agency_net := v_supp_subtotal - v_supp_commission;

-- Late-payment penalty: only count penalty actually collected on fully-paid installments
SELECT COALESCE(SUM(inst.penalty_applied), 0)
INTO v_penalty_total
FROM public.booking_payment_plan_installments inst
WHERE inst.booking_id = p_booking_id
AND inst.status = 'paid'
AND COALESCE(inst.penalty_applied, 0) > 0;

v_penalty_comm := v_penalty_total * v_effective_rate;
v_penalty_net  := v_penalty_total - v_penalty_comm;

late_payment_penalty_total := v_penalty_total;
late_payment_penalty_commission := v_penalty_comm;
late_payment_penalty_agency_net := v_penalty_net;

platform_total_revenue := agency_commission_amount
+ net_service_charge
+ v_pp_sc
+ v_opt_sc
+ v_supp_sc
+ v_penalty_comm;

agency_payout_total := agency_net_tour
+ optional_services_agency_net
+ supplements_agency_net
+ v_penalty_net;

RETURN NEXT;
END;
$function$
;
