// Monto que se manda a la pasarela en el paso 4 de la reserva.
//
// `create_booking_atomic` devuelve `amount_to_charge`: el exigible COMPLETO del
// primer cobro (anticipo + cargo + extras - puntos - Cash). No conoce el pago
// parcial («Quiero pagar con más de un método»), que es solo una decisión del
// viajero sobre cuánto cobrar ahora. Desde el 24-ago-2026 el paso 4 mandaba ese
// total a las cinco pasarelas y el parcial se ignoraba: la pantalla decía
// «Pagar $350» y Openpay cobraba $550 (reportado el 19-oct-2026).
//
// El tope sigue siendo el del servidor: nunca se cobra más que `amount_to_charge`.

const redondear = (n: number): number => Math.round(n * 100) / 100;

export function montoDelCobroAhora(
  amountToChargeServidor: number,
  pagoParcial: number | null | undefined,
): number {
  const total = redondear(Number(amountToChargeServidor) || 0);
  const parcial = redondear(Number(pagoParcial) || 0);
  if (total <= 0 || parcial <= 0) return total;
  return Math.min(parcial, total);
}
