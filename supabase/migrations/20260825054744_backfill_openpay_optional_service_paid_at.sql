-- openpay-webhook solo marcaba paid_at en extras comprados por separado
-- (chargeContext = 'optional_service'), no en los que venian en el pago inicial.
-- Resultado: extras cobrados al viajero pero con paid_at NULL, lo que dejaba fuera
--   - el CFDI (generate-booking-cfdi filtra por paid_at IS NOT NULL)
--   - el pago a la agencia (calculate_booking_financial_breakdown, mismo filtro)
--
-- Stripe 5/5 y PayPal 1/1 marcaban bien; Openpay 0/4.
--
-- Este backfill corrige SOLO la reserva con payment_status = 'succeeded'.
-- Los otros 3 extras de Openpay pertenecen a reservas pending/processing: marcarlos
-- afirmaria un cobro que no ocurrio. Se marcaran solos al pagarse, ya con el webhook
-- corregido.
--
-- Se usa b.paid_at (no now()) para que la fecha refleje el cobro real.
-- El trigger refresh_commission_on_optional_service recalcula commission_records:
-- verificado en BEGIN/ROLLBACK, agency_net_amount 8,754.15 -> 8,854.15 (+100 del
-- extra) y platform_total_revenue 2,059.80 -> 2,064.80 (+5 del cargo por servicio).

UPDATE public.booking_optional_services o
SET paid_at = b.paid_at,
    payment_method = 'openpay',
    updated_at = now()
FROM public.bookings b
WHERE b.id = o.booking_id
  AND b.payment_provider = 'openpay'
  AND b.payment_status = 'succeeded'
  AND o.is_cancelled = false
  AND o.paid_at IS NULL;
