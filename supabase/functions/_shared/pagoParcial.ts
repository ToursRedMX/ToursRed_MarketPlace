// Pago de una reserva con «más de un método» (19-oct-2026).
//
// El viajero elige cuánto cobrar AHORA y el resto queda como saldo, que se
// completa después desde «Mis reservas» con cualquier procesador. Lo que hay que
// garantizar en las cinco funciones que abren una pasarela de reserva
// (create-checkout-session, create-paypal-order, create-mercadopago-preference,
// create-conekta-order, create-openpay-checkout):
//
//   1. el monto cobrado es EXACTAMENTE el pedido, mientras no pase del saldo;
//   2. el saldo se mide contra lo ya pagado por TODOS los procesadores. MercadoPago
//      y PayPal lo medían solo contra su propio procesador: con Stripe $350 + PayPal
//      $200, el segundo cobro creía que faltaba todo y dejaba cobrar de más.
//
// Cobros de seguro, extras, suplementos y cuotas del plan no son anticipo: el filtro
// `charge_context = 'booking_deposit'` es el mismo de coberturaDePago.ts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

const aCentavos = (n: number): number => Math.round(n * 100) / 100;

/** Lo que ya entró a la reserva como anticipo, de cualquier procesador. */
export async function pagadoEnProcesadores(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("amount")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .eq("charge_context", "booking_deposit");
  if (error) throw new Error(`No se pudo leer lo ya pagado de la reserva: ${error.message}`);
  return aCentavos((data ?? []).reduce((s: number, t: { amount: number | string | null }) => s + Number(t.amount || 0), 0));
}

export type DecisionDeCobro =
  | { modo: "completo" }
  | { modo: "parcial"; monto: number }
  | { modo: "rechazo"; error: string };

/**
 * Decide qué cobra create-checkout-session. Las otras cuatro funciones ya
 * aceptan «monto pedido <= saldo» por su cuenta; Stripe no, porque siempre
 * cobraba las líneas completas del servidor y solo usaba `amount` para detectar
 * desacuerdo.
 *
 *   - Sin pagos previos y con el monto del cliente igual al total de las líneas:
 *     cobro completo, con su desglose de siempre.
 *   - Cualquier otro caso es un abono: se cobra `montoCliente` tal cual, con tope
 *     en el saldo. Un monto mayor al saldo se rechaza (no se recorta en silencio).
 */
export function decidirCobroStripe(p: {
  montoCliente: number;
  totalLineas: number;
  saldo: number;
  pagadoPrevio: number;
  tolerancia: number;
  minimo: number;
}): DecisionDeCobro {
  const monto = aCentavos(Number(p.montoCliente) || 0);
  if (monto <= 0) return { modo: "rechazo", error: "El monto a cobrar debe ser mayor a cero." };

  if (p.pagadoPrevio <= 0.005 && Math.abs(monto - p.totalLineas) <= p.tolerancia) {
    return { modo: "completo" };
  }
  if (p.saldo <= 0) {
    return { modo: "rechazo", error: "Esta reserva ya está pagada en su totalidad." };
  }
  if (monto > p.saldo + p.tolerancia) {
    return { modo: "rechazo", error: `El monto excede el saldo restante de ${p.saldo.toFixed(2)} MXN.` };
  }
  if (monto < p.minimo) {
    return { modo: "rechazo", error: `El pago mínimo es de ${p.minimo.toFixed(2)} MXN.` };
  }
  return { modo: "parcial", monto: Math.min(monto, aCentavos(p.saldo)) };
}
