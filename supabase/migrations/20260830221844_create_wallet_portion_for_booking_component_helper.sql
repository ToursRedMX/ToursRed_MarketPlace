-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830221844
--   name:    create_wallet_portion_for_booking_component_helper
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

-- Funcion compartida de prorrateo: cuando una reserva se pago parcial o
-- totalmente con saldo de ToursRed Cash (bookings.toursred_cash_used), ese
-- monto es UNICO y cubre el total combinado (deposito+cargo de servicio +
-- extras de reserva + seguro) sin desglose por concepto. Cada funcion de
-- asiento contable (booking, seguro, extras) necesita saber cuanto de SU
-- propio concepto vino de monedero para no debitar Bancos por dinero que
-- nunca entro. Formula: proporcional al peso de cada concepto dentro del
-- total elegible para wallet (deposito+SC+extras+seguro). La membresia se
-- excluye del pool porque, verificado el 30-ago-2026, solo puede pagarse via
-- suscripcion real de Stripe (nunca con wallet), incluso en compra conjunta
-- con una reserva.
CREATE OR REPLACE FUNCTION public.get_wallet_portion_for_booking_component(
  p_booking_id uuid,
  p_component_amount numeric
) RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_extras_subtotal numeric := 0;
v_total_wallet_eligible numeric;
v_wallet_used numeric;
BEGIN
IF COALESCE(p_component_amount, 0) <= 0 THEN
  RETURN 0;
END IF;

SELECT deposit_amount, service_charge, travel_insurance_cost, toursred_cash_used
INTO v_booking
FROM bookings
WHERE id = p_booking_id;

IF NOT FOUND THEN
  RETURN 0;
END IF;

-- Extras capturados al momento de la reserva (payment_method IS NULL = no
-- tienen su propio metodo de pago registrado por separado, a diferencia de
-- los extras post-reserva comprados via purchase-post-booking-extras, que
-- si tienen payment_method propio y no necesitan prorrateo).
SELECT COALESCE(SUM(total_paid), 0)
INTO v_extras_subtotal
FROM booking_optional_services
WHERE booking_id = p_booking_id
AND payment_method IS NULL
AND paid_at IS NOT NULL
AND COALESCE(is_cancelled, false) = false;

v_total_wallet_eligible := COALESCE(v_booking.deposit_amount, 0)
+ COALESCE(v_booking.service_charge, 0)
+ v_extras_subtotal
+ COALESCE(v_booking.travel_insurance_cost, 0);

IF v_total_wallet_eligible <= 0 THEN
  RETURN 0;
END IF;

v_wallet_used := LEAST(COALESCE(v_booking.toursred_cash_used, 0), v_total_wallet_eligible);

IF v_wallet_used <= 0 THEN
  RETURN 0;
END IF;

RETURN LEAST(
  p_component_amount,
  ROUND(p_component_amount * (v_wallet_used / v_total_wallet_eligible), 2)
);
END;
$function$
;
