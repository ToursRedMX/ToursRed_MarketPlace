-- amount_due_now: una sola fuente de verdad para el monto del primer cobro.
--
-- Los checkouts y los webhooks de confirmacion validaban contra deposit_amount,
-- que es solo el anticipo del tour y deja fuera cargo por servicio, extras, seguro
-- y membresia (y no descuenta puntos ni wallet). Dos consecuencias:
--   1. Checkout bloqueado (reserva dbb377b4: exigible 5,206.84 vs techo 5,149.50).
--   2. Cobro de menos silencioso: los webhooks confirmaban con totalPaid >=
--      deposit_amount, dejando la diferencia sin cobrar.
--
-- No se usa user_payment porque hoy tiene tres semanticas incompatibles, ni
-- booking_payment_plans.pending_balance porque el plan se crea DESPUES del primer
-- pago y no existe cuando el checkout necesita validar.
--
-- amount_due_now = cuanto cobrar en ESTE intento. Lo escribe create_booking_atomic
-- una sola vez y NO se decrementa con los abonos; lo que falta se deriva como
-- amount_due_now - alreadyPaid. El saldo de abonos posteriores sigue en
-- pending_balance, que es GENERATED ALWAYS AS (total_plan_amount - total_amount_paid).
--
-- No puede ser columna generada: depende de puntos y wallet, que no estan en
-- bookings como base de calculo.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS amount_due_now numeric;

COMMENT ON COLUMN public.bookings.amount_due_now IS
  'Monto a cobrar en el primer intento de pago: anticipo + cargo por servicio + extras + seguro + membresia, menos puntos y ToursRed Cash. Lo escribe create_booking_atomic una sola vez y no se decrementa con los abonos; el saldo de abonos posteriores vive en booking_payment_plans.pending_balance.';

-- Backfill solo de reservas pendientes, reconstruyendo el exigible completo.
-- Verificado en BEGIN/ROLLBACK: reproduce user_payment exacto (5,206.84) en las
-- dos reservas pendientes. Una version simplificada (deposit_amount +
-- service_charge) daba 5,664.45 y habria dejado la reserva sin confirmar en el
-- webhook. Las reservas ya pagadas NO se tocan: reescribir su exigible alteraria
-- historia contable.
UPDATE public.bookings b
SET amount_due_now = GREATEST(0, ROUND(
      COALESCE(b.deposit_amount, 0)
    + COALESCE(b.service_charge, 0)
    + COALESCE((SELECT SUM(bo.subtotal) + SUM(bo.service_charge)
                FROM public.booking_optional_services bo
                WHERE bo.booking_id = b.id
                  AND COALESCE(bo.is_cancelled, false) = false), 0)
    + COALESCE(b.travel_insurance_cost, 0)
    + COALESCE(b.membership_cost, 0)
    - COALESCE(b.points_used, 0) / 100.0
    - COALESCE(b.toursred_cash_used, 0)
, 2))
WHERE b.payment_status = 'pending'
  AND b.amount_due_now IS NULL;
