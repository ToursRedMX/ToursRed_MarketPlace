// Qué le decimos al viajero cuando vuelve de la pasarela tras pagar solo una parte.
//
// «Quiero pagar con más de un método» cobra, por ejemplo, $350 de un exigible de $550. El cobro
// queda `succeeded`, pero la reserva sigue en `payment_status = 'processing'` hasta que el saldo se
// complete desde «Mis reservas». Las pantallas de regreso solo esperaban `succeeded`: Openpay y
// Conekta sondeaban ~50 s y terminaban en «Pago en proceso» aunque el cobro ya estaba confirmado
// (reportado el 19-oct-2026); PayPal, MercadoPago y Stripe decían «Pago exitoso. Tu reserva ha sido
// confirmada» con la mitad por pagar.
//
// La aritmética es la de `supabase/functions/_shared/exigible.ts` (`exigibleAlProcesador`) y la de
// `pagadoEnProcesadores` (`_shared/pagoParcial.ts`): lo ya pagado es la suma de cobros `succeeded`
// del anticipo (`charge_context = 'booking_deposit'`), de CUALQUIER procesador.

const TOLERANCIA_MXN = 0.5;

const num = (v: unknown): number => Number(v ?? 0) || 0;
const redondear = (n: number): number => Math.round(n * 100) / 100;

export interface DatosDeReservaAbono {
  payment_status?: string | null;
  amount_due_now?: number | string | null;
  membership_cost?: number | string | null;
  deposit_amount?: number | string | null;
  total_price?: number | string | null;
}

export interface CobroDeReserva {
  amount?: number | string | null;
  status?: string | null;
  charge_context?: string | null;
}

export interface EstadoDeAbono {
  /** Lo que los procesadores ya cobraron del anticipo. */
  abonado: number;
  /** Lo que falta para completar el anticipo. */
  saldo: number;
  /** true: hay un abono confirmado y la reserva sigue esperando el resto. */
  hayAbonoPendiente: boolean;
}

/** Mismo techo que `exigibleAlProcesador`: `amount_due_now` ya viene neto de puntos y Cash. */
export function exigibleDeLaReserva(reserva: DatosDeReservaAbono): number {
  if (reserva?.amount_due_now != null) {
    return redondear(Math.max(0, num(reserva.amount_due_now) - num(reserva.membership_cost)));
  }
  return redondear(num(reserva?.deposit_amount) || num(reserva?.total_price));
}

export function estadoDeAbono(reserva: DatosDeReservaAbono, cobros: CobroDeReserva[]): EstadoDeAbono {
  const abonado = redondear(
    (cobros ?? [])
      .filter((c) => c.status === 'succeeded' && c.charge_context === 'booking_deposit')
      .reduce((s, c) => s + num(c.amount), 0),
  );
  const saldo = redondear(Math.max(0, exigibleDeLaReserva(reserva) - abonado));
  return {
    abonado,
    saldo,
    hayAbonoPendiente: reserva?.payment_status === 'processing' && abonado > 0.005 && saldo > TOLERANCIA_MXN,
  };
}

/**
 * Monto del que parte el modal «Completar pago» de Mis reservas, y los puntos que ya vienen restados.
 *
 * Con un abono previo (reserva `processing`) el monto es el SALDO que falta para confirmar, no
 * `user_payment`: solo Openpay y Conekta lo descuentan al cobrar, Stripe, PayPal y MercadoPago no, así que
 * tras un abono de $350 por Stripe el modal seguía diciendo $550 (reportado el 19-oct-2026). El saldo ya es
 * neto de los puntos que se aplicaron al crear la reserva: no se restan otra vez.
 */
export function montoBaseDelPago(
  reserva: { user_payment?: number | string | null; deposit_amount?: number | string | null; points_used?: number | string | null } | null | undefined,
  saldoPendiente: number | null | undefined,
): { monto: number; puntosYaDescontados: number } {
  if (saldoPendiente != null) return { monto: saldoPendiente, puntosYaDescontados: 0 };
  return {
    monto: Number(reserva?.user_payment) || Number(reserva?.deposit_amount) || 0,
    puntosYaDescontados: num(reserva?.points_used) / 100,
  };
}

/** Lo único que se usa del cliente de Supabase. */
export interface ClienteDeLectura {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabla: string): any;
}

/**
 * Lee la reserva y sus cobros. Devuelve null si no se pudo leer (y deja rastro): quien llama conserva
 * entonces su comportamiento de antes en vez de inventar un saldo.
 */
export async function leerEstadoDeAbono(cliente: ClienteDeLectura, bookingId: string): Promise<EstadoDeAbono | null> {
  const [reserva, cobros] = await Promise.all([
    cliente
      .from('bookings')
      .select('payment_status, amount_due_now, membership_cost, deposit_amount, total_price')
      .eq('id', bookingId)
      .maybeSingle(),
    cliente
      .from('payment_transactions')
      .select('amount, status, charge_context')
      .eq('booking_id', bookingId),
  ]);
  if (reserva.error || cobros.error || !reserva.data) {
    console.error('abonoRecibido: no se pudo leer el estado del abono', reserva.error ?? cobros.error);
    return null;
  }
  return estadoDeAbono(reserva.data, cobros.data ?? []);
}
