-- Cancelar la reserva COMPLETA devolvia en Cash lo pagado con puntos en los
-- cargos posteriores (extras, seguro y abonos).
--
-- ============================================================================
-- EL HUECO
-- ============================================================================
--
-- process_cancellation_refund separa el reembolso en Cash y puntos con
-- reembolso_por_medio, pero solo conoce bookings.points_used: los puntos que se
-- aplicaron al RESERVAR. Los llamadores (process-traveler-cancellation,
-- process-agency-booking-cancellation, process-tour-cancellation,
-- admin-cancel-booking, process-payment-plan-tour-deadline) suman al monto los
-- extras, el seguro y los abonos completos -incluida la parte que se pago con
-- puntos despues de reservar-, y todo eso salia como Cash.
--
-- Desde 20261016042518 cada cargo posterior guarda sus puntos
-- (booking_optional_services.points_used, booking_payment_plan_transactions.
-- points_used, bookings.travel_insurance_points_used), asi que ya se pueden
-- separar. El 16-oct no hay ninguna fila con puntos en esas columnas: el hueco
-- se cierra antes de que haya un caso real.
--
-- ============================================================================
-- EL ARREGLO
-- ============================================================================
--
-- La funcion no puede deducir sola cuantos puntos van en el monto: cada
-- llamador aplica su propia regla (el viajero devuelve abonos y seguro al
-- porcentaje de la politica y los extras reembolsables al 100%; la agencia todo
-- al 100%; el admin lo que decida). Por eso recibe un parametro nuevo,
-- p_puntos_cargos_posteriores: los puntos que YA ESTAN INCLUIDOS en
-- p_refund_amount, calculados por el llamador con la misma regla que su monto.
--
-- Esos puntos se restan del Cash y se devuelven como puntos en la MISMA
-- transaccion, con reembolsar_saldo_y_puntos. La referencia es
-- 'post_booking_extra' y no 'booking' a proposito: el trigger que devuelve los
-- puntos de la reserva (refund_points_for_cancellation) usa como guardia de
-- idempotencia un 'refund' con reference_type 'booking'; si este movimiento lo
-- usara, el trigger creeria que ya devolvio y se saltaria los de la reserva.
--
-- Copiada de pg_get_functiondef el 16-oct-2026. Cambia solo lo marcado con
-- "cargos posteriores". Con un parametro nuevo, CREATE OR REPLACE crearia una
-- segunda funcion y las llamadas sin el serian ambiguas: DROP y CREATE, y se
-- reponen los permisos (solo service_role, como estaba).

DROP FUNCTION IF EXISTS public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric, numeric, boolean);

CREATE FUNCTION public.process_cancellation_refund(p_booking_id uuid, p_refund_amount numeric DEFAULT 0, p_reference_type text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_new_status text DEFAULT 'cancelled'::text, p_set_cancelled_at boolean DEFAULT true, p_cancellation_type text DEFAULT NULL::text, p_cancellation_refund_amount numeric DEFAULT NULL::numeric, p_porcentaje_puntos numeric DEFAULT 1, p_monto_incluye_puntos boolean DEFAULT true, p_puntos_cargos_posteriores integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking_id uuid;
v_current_status text;
v_cancelled_at timestamptz;
v_user_id uuid;
v_points_used integer;
v_pct numeric := least(1, greatest(0, coalesce(p_porcentaje_puntos, 1)));
v_reparto record;
v_consumido record;
v_bruto numeric;
v_cash numeric;
v_wallet_id uuid;
v_wallet_result json;
v_transaction_id uuid;
-- cargos posteriores: puntos incluidos en p_refund_amount que regresan como puntos
v_puntos_post integer := CASE WHEN p_monto_incluye_puntos
  THEN greatest(0, coalesce(p_puntos_cargos_posteriores, 0)) ELSE 0 END;
BEGIN
-- Step 1: Lock the booking row FOR UPDATE (held for the entire transaction)
SELECT id, status, cancelled_at, user_id, points_used
INTO v_booking_id, v_current_status, v_cancelled_at, v_user_id, v_points_used
FROM public.bookings
WHERE id = p_booking_id
FOR UPDATE;

IF v_booking_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
END IF;

-- Step 2: Reject only terminal states — allow 'cancellation_processing' to advance
IF v_current_status = 'cancelled' OR v_cancelled_at IS NOT NULL THEN
RAISE EXCEPTION 'La reserva ya fue cancelada';
END IF;

-- Step 2b: cada medio en su moneda. El Cash pierde la parte que se pago con
-- puntos (al mismo porcentaje); esos puntos los devuelve el trigger de
-- bookings leyendo cancellation_points_refund_pct (Step 4).
-- Step 2c: lo que ya consumieron las cancelaciones parciales no se vuelve a
-- devolver. El monto de los llamadores sale de deposit_amount, que la parcial
-- no reduce: se le resta el principal consumido al mismo porcentaje, y los
-- puntos consumidos salen de points_used.
-- Step 2d (cargos posteriores): los puntos de extras, seguro y abonos que el
-- llamador ya incluyo en el monto salen del Cash antes del reparto.
v_consumido := public.consumido_por_parciales(p_booking_id);
v_points_used := greatest(0, coalesce(v_points_used, 0) - v_consumido.puntos);
v_bruto := CASE WHEN p_monto_incluye_puntos
  THEN greatest(0, coalesce(p_refund_amount, 0) - v_pct * v_consumido.principal - v_puntos_post / 100.0)
  ELSE p_refund_amount END;

v_reparto := public.reembolso_por_medio(v_bruto, v_points_used, v_pct, p_monto_incluye_puntos);
v_cash := v_reparto.cash;

-- Step 3: Process wallet refund if amount > 0
IF v_cash > 0 AND v_user_id IS NOT NULL THEN
-- Ensure wallet exists (create if missing, same as edge function logic)
SELECT id INTO v_wallet_id
FROM public.toursred_cash_wallets
WHERE user_id = v_user_id AND is_active = true
LIMIT 1;

IF v_wallet_id IS NULL THEN
INSERT INTO public.toursred_cash_wallets (user_id, balance, currency, is_active)
VALUES (v_user_id, 0, 'MXN', true)
ON CONFLICT (user_id) DO NOTHING
RETURNING id INTO v_wallet_id;

IF v_wallet_id IS NULL THEN
SELECT id INTO v_wallet_id
FROM public.toursred_cash_wallets
WHERE user_id = v_user_id AND is_active = true
LIMIT 1;
END IF;
END IF;

IF v_wallet_id IS NULL THEN
RAISE EXCEPTION 'No se pudo obtener ni crear el wallet del usuario';
END IF;

-- Nested call to update_wallet_balance (same transaction, same row lock scope)
-- Idempotency key prevents double-refund if the edge function is retried
v_wallet_result := public.update_wallet_balance(
p_user_id := v_user_id,
p_amount := v_cash,
p_type := 'refund'::toursred_cash_transaction_type,
p_description := p_description,
p_reference_id := p_booking_id,
p_reference_type := p_reference_type,
p_idempotency_key := p_booking_id || '_refund_' || COALESCE(p_reference_type, 'cancellation')
);

v_transaction_id := (v_wallet_result ->> 'transaction_id')::uuid;
END IF;

-- Step 3b (cargos posteriores): sus puntos regresan como puntos, en esta
-- misma transaccion.
IF v_puntos_post > 0 AND v_user_id IS NOT NULL THEN
PERFORM public.reembolsar_saldo_y_puntos(
  v_user_id, 0, v_puntos_post, 0, p_booking_id,
  'post_booking_extra', NULL,
  COALESCE(p_description, 'Cancelación de reserva') || ' (extras, seguro y abonos pagados con puntos)',
  NULL
);
END IF;

-- Step 4: Update booking status. El porcentaje va en el MISMO update: el
-- trigger AFTER UPDATE que devuelve los puntos lo lee de NEW.
UPDATE public.bookings
SET
status = p_new_status,
cancelled_at = CASE WHEN p_set_cancelled_at THEN now() ELSE NULL END,
cancellation_type = p_cancellation_type,
cancellation_points_refund_pct = v_pct,
cancellation_refund_amount = CASE
  WHEN p_cancellation_refund_amount IS NULL THEN NULL
  ELSE (public.reembolso_por_medio(
    CASE WHEN p_monto_incluye_puntos
      THEN greatest(0, p_cancellation_refund_amount - v_pct * v_consumido.principal - v_puntos_post / 100.0)
      ELSE p_cancellation_refund_amount END,
    v_points_used, v_pct, p_monto_incluye_puntos)).cash
END
WHERE id = p_booking_id;

-- Step 5: Return result
RETURN json_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_status', v_current_status,
'cash_refunded', v_cash,
'points_refunded', v_reparto.puntos,
'points_post_booking_refunded', v_puntos_post,
'principal_consumido_por_parciales', v_consumido.principal
);
END;
$function$;

REVOKE ALL ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric, numeric, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric, numeric, boolean, integer) TO service_role;
