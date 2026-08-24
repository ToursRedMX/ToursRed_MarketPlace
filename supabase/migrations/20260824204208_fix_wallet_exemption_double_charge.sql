/*
# Fix: pago 100% wallet ya no consume la exención mensual de ToursRed+

## Problema
`confirm_booking_paid_with_wallet` deriva la exención de membresía restando el cargo
por servicio guardado al cargo completo:

    v_full_service_charge := total_price * service_charge_percentage / 100;
    v_exemption_amount    := v_full_service_charge - COALESCE(service_charge, 0);

Desde que el wizard restauró la exención de cargo por servicio por pagar 100% con
ToursRed Cash (BookingFlowStep4), esas reservas se guardan con `service_charge = 0`.
La resta da entonces el cargo COMPLETO, y el RPC:

  - suma ese monto a `memberships.service_fee_exemption_used` (quema el tope mensual
    de $500 del socio), y
  - marca `used_membership_benefit = true` + `membership_service_fee_saved`,

atribuyendo a la membresía un beneficio que en realidad vino del saldo ToursRed Cash.
El formulario anterior evitaba justo esto (BookingForm.tsx:1025-1029 ponía
`exemptionUsed = 0` en full wallet), pero nunca llamaba a este RPC.

## Solución
Detectar el pago 100% wallet dentro del RPC y saltarse el bloque de exención.
El discriminador es la propia reserva: `user_payment = 0` (nada que cobrar a un
procesador) junto con saldo o puntos efectivamente aplicados.

## Por qué NO se usa `service_charge = 0` como disparador
`service_charge` llega en 0 por dos causas distintas:
  a) exención por pagar 100% con ToursRed Cash  -> NO debe consumir el tope mensual
  b) la exención de la membresía cubrió el cargo -> SÍ debe consumirlo
Disparar con `service_charge = 0` colapsaría ambas y le daría al socio exención
ilimitada, que es peor que el bug original. Por eso el corte es `user_payment = 0`.

## Alcance
Solo cambia el Step 3 del RPC (cálculo de exención). Los pasos 1, 2 y 4
(débito de wallet, descuento de puntos, confirmación y `payment_method`) quedan
byte a byte iguales. Sin cambios de firma ni de tablas.

## Reservas históricas
No corrige filas ya existentes. Al 2026-08-24 no hay ninguna reserva afectada:
las que tienen `toursred_cash_used > 0` se crearon con el flujo previo, que sí
guardaba el cargo por servicio. Si aparece alguna, se corrige aparte.
*/

CREATE OR REPLACE FUNCTION public.confirm_booking_paid_with_wallet(
  p_booking_id uuid,
  p_points_to_use integer,
  p_cash_to_use numeric,
  p_idempotency_key text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_user_id uuid;
v_total_price numeric;
v_service_charge numeric;
v_user_payment numeric;
v_is_full_wallet boolean;
v_membership_id uuid;
v_exemption_used numeric;
v_full_service_charge numeric;
v_actual_service_charge numeric;
v_exemption_amount numeric;
v_wallet_result json;
v_points_ok boolean;
v_payment_method text;
BEGIN
-- Validate caller owns this booking
SELECT user_id, total_price, service_charge, user_payment
INTO v_user_id, v_total_price, v_service_charge, v_user_payment
FROM public.bookings WHERE id = p_booking_id;

IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;

IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

-- Step 1: Debit ToursRed Cash if applicable
IF p_cash_to_use > 0 THEN
SELECT * INTO v_wallet_result FROM public.update_wallet_balance(
v_user_id,
-p_cash_to_use,
'debit',
'Pago de reserva',
p_booking_id,
'booking',
p_idempotency_key
);

IF v_wallet_result IS NULL OR (v_wallet_result->>'success')::boolean IS NOT TRUE THEN
RAISE EXCEPTION 'Error al descontar ToursRed Cash: %', COALESCE(v_wallet_result->>'error', 'resultado nulo');
END IF;
END IF;

-- Step 2: Deduct points if applicable (deduct_points_for_booking has its own idempotency guard)
IF p_points_to_use > 0 THEN
SELECT public.deduct_points_for_booking(p_booking_id, p_points_to_use) INTO v_points_ok;

IF v_points_ok IS NOT TRUE THEN
RAISE EXCEPTION 'Error al descontar puntos de la reserva';
END IF;
END IF;

-- Step 3: Calculate and apply membership service-fee exemption
--
-- Pago 100% con wallet: el cargo por servicio se exentó por pagar con ToursRed Cash,
-- no por la membresía. No se consume el tope mensual del socio ni se marca el
-- beneficio de membresía. Equivale a BookingForm.tsx:1025-1029 del flujo anterior.
v_is_full_wallet := COALESCE(v_user_payment, 0) = 0
                    AND (COALESCE(p_cash_to_use, 0) > 0 OR COALESCE(p_points_to_use, 0) > 0);

v_exemption_amount := 0;

IF NOT v_is_full_wallet THEN
SELECT id INTO v_membership_id
FROM public.memberships
WHERE user_id = v_user_id
AND status = 'active'
AND current_period_end > now()
LIMIT 1;

IF v_membership_id IS NOT NULL AND v_service_charge IS NOT NULL AND v_total_price IS NOT NULL THEN
SELECT service_fee_exemption_used INTO v_exemption_used
FROM public.memberships WHERE id = v_membership_id;

v_full_service_charge := (v_total_price * COALESCE(
(SELECT service_charge_percentage FROM public.platform_settings LIMIT 1), 5
)) / 100.0;
v_actual_service_charge := COALESCE(v_service_charge, 0);
v_exemption_amount := v_full_service_charge - v_actual_service_charge;

IF v_exemption_amount > 0 THEN
UPDATE public.memberships
SET service_fee_exemption_used = COALESCE(service_fee_exemption_used, 0) + v_exemption_amount
WHERE id = v_membership_id;
END IF;
END IF;
END IF;

-- Step 4: Confirm the booking
v_payment_method := 'toursred_points';
IF p_points_to_use > 0 AND p_cash_to_use > 0 THEN
v_payment_method := 'toursred_points_cash';
ELSIF p_cash_to_use > 0 THEN
v_payment_method := 'toursred_cash';
END IF;

UPDATE public.bookings
SET payment_status = 'succeeded',
status = 'confirmed',
payment_method = v_payment_method,
paid_at = now(),
updated_at = now(),
points_used = p_points_to_use,
toursred_cash_used = p_cash_to_use,
membership_service_fee_saved = CASE WHEN v_exemption_amount > 0 THEN v_exemption_amount ELSE membership_service_fee_saved END,
used_membership_benefit = CASE WHEN v_exemption_amount > 0 THEN true ELSE used_membership_benefit END
WHERE id = p_booking_id;

RETURN json_build_object('success', true);
EXCEPTION
WHEN OTHERS THEN
RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;
