-- Los administradores no podian leer NI UNA fila de payment_transactions.
--
-- La unica politica SELECT de la tabla cubria al viajero dueno de la reserva y a
-- la agencia; no habia clausula de admin. Como get_booking_total_paid es
-- SECURITY INVOKER y suma
--     transacciones + toursred_cash_used + points_used/100,
-- llamada por un admin devolvia 0 en el primer termino y solo sumaba monedero y
-- puntos.
--
-- Sintoma visible: en /admin/bookings, el detalle de la reserva
-- TRG-OQ13VAWCIKL mostraba "Total pagado: $562.61" (solo los 56,261 puntos)
-- en vez de $5,769.45. La aritmetica lo delata:
--     5769.45 - 5206.84 (transacciones) = 562.61
--
-- Lo grave no era ese tile sino AdminBookings.tsx:1440, que ya usaba el mismo
-- RPC desde antes para sugerir el monto de reembolso al cancelar una reserva:
--     totalPaid = realTotalPaid; setRefundAmount(totalPaid + insurance);
-- Es decir, el reembolso sugerido omitia todo lo cobrado con tarjeta. Aplica a
-- las reservas sin plan de pagos (25 de 32); las que tienen plan toman otra
-- rama que suma las parcialidades.
--
-- Se agrega una politica NUEVA en vez de modificar la existente: ambas son
-- permissive, asi que se combinan con OR y el acceso de viajeros y agencias
-- queda intacto.
--
-- Para "es admin" se reusa public.is_admin_user() en lugar de leer users.role
-- en linea. Es SECURITY DEFINER, que es justamente lo que hace falta dentro de
-- una politica: leer public.users sin volver a pasar por el RLS de esa tabla.
-- (170 de las 445 politicas del esquema leen users en linea; esa duplicacion es
-- deuda aparte, pero no se le agrega un caso mas aqui.)
--
-- Verificado en ROLLBACK contra la BD real, simulando cada rol con
-- SET LOCAL ROLE authenticated + request.jwt.claims:
--   admin antes    = 562.61     (reproduce el bug)
--   admin despues  = 5769.45    (corregido)
--   viajero dueno  = 5769.45    (sin cambio)
--   tercero        = 0          (sin fuga)

CREATE POLICY "Admins can read payment transactions"
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user());
