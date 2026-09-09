-- confirm_booking_paid_with_wallet: exigir que lo aportado cubra lo exigible
-- antes de confirmar la reserva.
--
-- ============================================================================
-- EL AGUJERO
-- ============================================================================
--
-- La funcion descontaba condicionalmente y confirmaba INCONDICIONALMENTE:
--
--     IF p_cash_to_use   > 0 THEN ...descontar cash...   END IF;
--     IF p_points_to_use > 0 THEN ...descontar puntos... END IF;
--
--     -- Paso 4, sin ningun IF:
--     UPDATE bookings SET payment_status='succeeded', status='confirmed', ...
--
-- Llamandola con 0 y 0 se saltaba los dos descuentos y confirmaba igual,
-- estampando payment_method = 'toursred_points' porque ese es el valor por
-- defecto de la variable. Y con 1 peso en una reserva de 5,500 tambien
-- confirmaba: nadie comprobaba que lo aportado CUBRIERA el precio.
--
-- Su unico llamador, la Edge Function confirm-booking-wallet-payment, valida
-- sesion y dueno pero pasa `p_points_to_use || 0, p_cash_to_use || 0` directo,
-- y ademas se salta el step-up de MFA justo cuando ambos son cero
-- ("Solo exigir step-up si de verdad se esta gastando wallet o puntos").
--
-- Resultado: cualquier viajero con sesion podia confirmar SU PROPIA reserva
-- pagando cero. Ocurrio una vez en este ambiente: TRG-JKVNKEXK4AD, 31-jul-2026,
-- 5,500 de deposito, confirmada 6 segundos despues de crearse, sin movimiento
-- de puntos, sin movimiento de cash y sin fila en payment_transactions.
--
-- Arrastra ademas: asiento reservado, correo de confirmacion, commission_amount
-- 1,100 y platform_revenue 1,650 asentados, y —desde que se le agrego el bloque
-- de CFDI a la Edge Function— el timbrado de un comprobante fiscal por el monto
-- completo con forma de pago SAT 05.
--
-- HISTORIA. El 22-ago se revoco el EXECUTE a anon/authenticated
-- (20260822034332), que cerraba un bypass DISTINTO: el chequeo interno de dueno
-- ("IF auth.uid() IS NOT NULL AND ...") no se activaba en una llamada anonima.
-- Aquello tapo el acceso directo desde el navegador; este bug de logica quedo
-- intacto y sigue alcanzable por la Edge Function.
--
-- ============================================================================
-- LA REGLA QUE SE IMPONE
-- ============================================================================
--
--     puntos/100 + cash + pagos de pasarela ya registrados  >=  exigible - 0.5
--
-- El exigible se obtiene por dos caminos, en este orden:
--
--   1. amount_due_now + points_used/100 + toursred_cash_used
--      amount_due_now es el numero que la propia create_booking_atomic se
--      comprometio a cobrar (columna creada el 25-ago), y YA viene con puntos y
--      cash restados; volver a sumarlos devuelve el bruto. Se lee ANTES del
--      Paso 4, que es quien sobrescribe esas dos columnas.
--
--   2. Si amount_due_now es null (29 de las 45 reservas de hoy, todas anteriores
--      al 25-ago), se reconstruye por componentes con la misma formula del
--      backfill de aquella migracion:
--        deposito + cargo por servicio + opcionales + seguro + membresia
--
--      Los descuentos NO se restan aqui: create_booking_atomic ya calcula
--      v_deposit_amount y v_base_service_charge sobre el precio YA descontado
--      (v_base_tour_price_discounted), asi que restarlos otra vez seria
--      contarlos dos veces.
--
--      Los opcionales con paid_at NO NULL se excluyen: son extras cobrados por
--      su propia via y contarlos seria cobrarlos dos veces. En el instante en
--      que corre este check los opcionales del checkout tienen paid_at null,
--      asi que si entran, que es lo correcto.
--
-- La tolerancia de 0.5 es la misma que ya usa capture-paypal-order:128.
--
-- POR QUE NO SE RECHAZA "0 y 0" A SECAS. Porque hay un caso legitimo:
-- BookingFlowStep4.tsx:527 usa `isWalletOnly = srvIsFullWallet || srvAmountToCharge === 0`,
-- de modo que una reserva que no cobra nada —un codigo de descuento del 100%,
-- por ejemplo— llama a este mismo endpoint con puntos y cash en cero. Si de
-- verdad no se debe nada, el exigible da 0 y la regla la deja pasar. Rechazar
-- el 0/0 por si mismo habria roto ese flujo.
--
-- ============================================================================
-- VERIFICACION ANTES DE APLICAR
-- ============================================================================
--
-- Se simulo el predicado contra las 5 reservas que existen hoy pagadas por esta
-- via. Las 4 legitimas pasan con sobrante exactamente 0.00; la fraudulenta se
-- bloquea por -6,050.00:
--
--   TRG-R0QF6GNR4C6  24-jul  exigible 3,604.65  cubierto 3,604.65   pasa
--   TRG-8XBODT0ZXAQ  30-jul  exigible   475.00  cubierto   475.00   pasa
--   TRG-JKVNKEXK4AD  31-jul  exigible 6,050.00  cubierto     0.00   BLOQUEA
--   TRG-0DS33SAOP81  25-ago  exigible 5,500.00  cubierto 5,500.00   pasa
--   TRG-DD03QDV8DCH  28-ago  exigible   500.00  cubierto   500.00   pasa
--
-- El cuerpo de abajo se tomo de pg_get_functiondef sobre la base VIVA, no del
-- archivo del repo: la definicion viva trae la logica de v_is_full_wallet del
-- fix del 24-ago (20260824204208) que el archivo original no tenia.
--
-- CREATE OR REPLACE reemplaza TODOS los atributos, incluidas las clausulas SET,
-- por eso `SET search_path TO 'public'` va explicito. Los permisos (postgres y
-- service_role) los conserva CREATE OR REPLACE; NO se vuelve a otorgar a
-- authenticated, que es justo lo que se revoco el 22-ago.

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
  -- Nuevas, para el chequeo de cobertura
  v_amount_due_now numeric;
  v_points_previos integer;
  v_cash_previo numeric;
  v_exigible numeric;
  v_ya_pagado numeric;
  v_cubierto numeric;
BEGIN
-- Validate caller owns this booking
SELECT user_id, total_price, service_charge, user_payment,
       amount_due_now, COALESCE(points_used, 0), COALESCE(toursred_cash_used, 0)
INTO v_user_id, v_total_price, v_service_charge, v_user_payment,
     v_amount_due_now, v_points_previos, v_cash_previo
FROM public.bookings WHERE id = p_booking_id;

IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;

IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

-- Step 0: lo aportado tiene que cubrir lo exigible.
--
-- Va ANTES de los descuentos a proposito. El bloque EXCEPTION de abajo revierte
-- todo lo hecho en el cuerpo, asi que validar despues tambien seria correcto,
-- pero rechazar antes de tocar el monedero es mas barato y mas facil de leer.
IF v_amount_due_now IS NOT NULL THEN
  v_exigible := ROUND(v_amount_due_now + v_points_previos / 100.0 + v_cash_previo, 2);
ELSE
  SELECT ROUND(
           COALESCE(b.deposit_amount, 0)
         + COALESCE(b.service_charge, 0)
         + COALESCE((SELECT SUM(bo.subtotal) + SUM(bo.service_charge)
                       FROM public.booking_optional_services bo
                      WHERE bo.booking_id = p_booking_id
                        AND COALESCE(bo.is_cancelled, false) = false
                        AND bo.paid_at IS NULL), 0)
         + COALESCE(b.travel_insurance_cost, 0)
         + COALESCE(b.membership_cost, 0), 2)
    INTO v_exigible
    FROM public.bookings b WHERE b.id = p_booking_id;
END IF;

SELECT COALESCE(SUM(t.amount), 0) INTO v_ya_pagado
FROM public.payment_transactions t
WHERE t.booking_id = p_booking_id AND t.status = 'succeeded';

v_cubierto := ROUND(COALESCE(p_points_to_use, 0) / 100.0
                  + COALESCE(p_cash_to_use, 0)
                  + v_ya_pagado, 2);

IF v_cubierto < v_exigible - 0.5 THEN
RAISE EXCEPTION 'Pago insuficiente: se aportaron % de % exigidos', v_cubierto, v_exigible;
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
-- Pago 100% con wallet: el cargo por servicio se exento por pagar con ToursRed Cash,
-- no por la membresia. No se consume el tope mensual del socio ni se marca el
-- beneficio de membresia. Equivale a BookingForm.tsx:1025-1029 del flujo anterior.
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
