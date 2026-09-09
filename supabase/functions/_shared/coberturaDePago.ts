// Segunda mitad de C-1 (auditoria de Edge Functions, 05-sep-2026).
//
// ============================================================================
// QUE ES ESTO Y QUE NO ES
// ============================================================================
//
// La primera mitad de C-1 (`a90237d`) cerro el hueco explotable desde fuera:
// `create-checkout-session` ahora exige identidad, valida saldo y puntos
// contra la base, y cobra SIEMPRE las lineas que arma el servidor. El cliente
// ya no puede fijar el monto.
//
// Esto de aqui es la otra capa: que el webhook no de por confirmada una
// reserva sin mirar cuanto entro. Ya no protege contra un atacante —para
// fabricar la sesion de Stripe haria falta la secret key—, protege contra
// bugs propios, que es exactamente como fallo la primera vez.
//
// ============================================================================
// POR QUE NO SE COPIA LA REGLA DE PAYPAL TAL CUAL
// ============================================================================
//
// `capture-paypal-order` compara `totalPaid < deposit_amount - 0.5` y, si no
// alcanza, deja la reserva en `processing`. El doc de la auditoria propone
// replicarlo. Copiarlo literal ROMPE confirmaciones legitimas:
//
//   - No suma puntos ni ToursRed Cash. En TRG-E5BGCYW29XY el viajero pago
//     4,706.84 con tarjeta y 562.61 en puntos sobre un anticipo de 5,149.50.
//     La regla de PayPal la habria dejado sin confirmar.
//
// Y la regla "obvia" del otro lado —exigir `amount_due_now`— tampoco sirve:
//
//   - `amount_due_now` incluye `membership_cost`, que se cobra por otra via.
//   - Incluye los extras completos, pero el checkout solo cobra los que
//     siguen sin pagar (`unpaidOptionals`).
//
// Medido contra las 26 reservas confirmadas que no son de PayPal (07-jul a
// 05-sep-2026), exigir `amount_due_now` habria bloqueado 2 de las 6 de
// Stripe. De ahi que el piso sea `deposit_amount` corregido por billetera, y
// que la comparacion contra `amount_due_now` solo AVISE.
//
// ============================================================================
// LAS DOS REGLAS
// ============================================================================
//
//   BLOQUEA  pagado + puntos/100 + cash  <  deposit_amount - 0.5
//
//     El anticipo es el piso: por debajo de eso no hay reserva que valga.
//     Se le suma la billetera porque `deposit_amount` es bruto (antes de
//     descuentos) y lo cobrado por el procesador ya viene neto.
//     Simulada contra las 26: solo marca TRG-PZKEAXWBZIV (07-jul), que esta
//     `confirmed` / `succeeded` con CERO transacciones y sin payment_intent.
//     O sea, marca justo lo que se busca.
//
//   AVISA    pagado  <  amount_due_now - membership_cost - 0.5
//
//     Entro menos de lo esperado pero por encima del piso. Se confirma igual
//     —el dinero ya esta— y queda el rastro en `audit_errors`. Simulada
//     contra las 26, marca TRG-84KJF6B7FMJ y TRG-8XEBZDR3CQ1 (26-ago), que
//     pagaron 525 de 550: son el bug de C-1 ocurriendo de verdad, cuando el
//     bloque "Safety" todavia deformaba las lineas para cuadrar con el
//     `amount` del cliente. Ya no puede repetirse, pero el aviso es la red.
//
// TOLERANCIA de 0.5 MXN, la misma que usan `capture-paypal-order` y la
// migracion `20260909030735` de `confirm_booking_paid_with_wallet`, para no
// pelear con redondeos de centavos.

const TOLERANCIA_MXN = 0.5;

export interface Cobertura {
  /** false solo cuando el cobro no llega ni al anticipo. Es lo que bloquea. */
  suficiente: boolean;
  /** true cuando entro menos de lo esperado pero por encima del piso. */
  sospechosa: boolean;
  /** Lo pagado por el procesador (cobros previos + el de este evento). */
  pagado: number;
  /** Pagado + puntos/100 + ToursRed Cash. */
  cubierto: number;
  /** El anticipo, que es el piso. */
  piso: number;
  /** Lo que se esperaba que cobrara el procesador, o null si no se sabe. */
  esperado: number | null;
  /** Para el mensaje y para `audit_errors`. */
  detalle: Record<string, unknown>;
}

/**
 * Comprueba si lo cobrado alcanza para confirmar la reserva.
 *
 * `montoDeEsteCobro` es lo que reporta el evento de Stripe (`amount_total` o
 * `amount_received`, ya en pesos), porque cuando el webhook confirma todavia
 * NO se ha insertado la fila en `payment_transactions` — eso pasa despues, al
 * final del case.
 *
 * Si no se puede leer la reserva, devuelve `suficiente: true`. Es a proposito:
 * el cobro ya se hizo y negarse a confirmar por un parpadeo de la base dejaria
 * una reserva pagada sin confirmar, que es peor. El fallo queda anotado en
 * `detalle.noVerificable` para que el llamador lo registre.
 */
export async function verificarCoberturaDePago(
  supabase: any,
  bookingId: string,
  montoDeEsteCobro: number,
  /**
   * El payment_intent de ESTE cobro, para no contarlo dos veces.
   *
   * Stripe reintenta los webhooks. Sin esto, en el reintento la fila que dejo
   * el intento anterior ya esta en `payment_transactions` y se sumaria ademas
   * de `montoDeEsteCobro`: el doble. Un cobro corto pasaria a la segunda.
   */
  paymentIntentIdDeEsteCobro?: string | null,
): Promise<Cobertura> {
  const monto = Number(montoDeEsteCobro) || 0;

  const { data: reserva, error: errorReserva } = await supabase
    .from("bookings")
    .select("deposit_amount, amount_due_now, membership_cost, points_used, toursred_cash_used")
    .eq("id", bookingId)
    .maybeSingle();

  if (errorReserva || !reserva) {
    return {
      suficiente: true,
      sospechosa: false,
      pagado: monto,
      cubierto: monto,
      piso: 0,
      esperado: null,
      detalle: {
        noVerificable: true,
        motivo: errorReserva?.message ?? "reserva no encontrada",
        bookingId,
      },
    };
  }

  const { data: previos, error: errorPrevios } = await supabase
    .from("payment_transactions")
    .select("amount, stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .eq("charge_context", "booking_deposit");

  // Un error aqui subestima lo ya pagado, o sea que empuja hacia BLOQUEAR una
  // reserva que quiza si esta cubierta. Como el bloqueo no pierde el dinero
  // (queda en `processing` y se resuelve a mano), se prefiere eso a confirmar
  // a ciegas; pero se anota para poder distinguir un caso del otro.
  // El filtro va en JS y no con `.neq()` a proposito: en PostgREST, `neq`
  // sobre una columna NULL descarta la fila, y los cobros de OpenPay,
  // MercadoPago o Conekta tienen `stripe_payment_intent_id` en NULL. Con
  // `.neq()` se perderian y el total quedaria por debajo de lo real, que es
  // justo la direccion que bloquea reservas legitimas.
  const pagadoPrevio = (previos ?? [])
    .filter((fila: any) =>
      !paymentIntentIdDeEsteCobro ||
      fila?.stripe_payment_intent_id !== paymentIntentIdDeEsteCobro
    )
    .reduce((suma: number, fila: any) => suma + (Number(fila?.amount) || 0), 0);

  const pagado = redondear(pagadoPrevio + monto);
  const billetera = redondear((Number(reserva.points_used) || 0) / 100 + (Number(reserva.toursred_cash_used) || 0));
  const cubierto = redondear(pagado + billetera);
  const piso = redondear(Number(reserva.deposit_amount) || 0);

  const amountDueNow = reserva.amount_due_now == null ? null : Number(reserva.amount_due_now);
  const membresia = Number(reserva.membership_cost) || 0;
  const esperado = amountDueNow == null ? null : redondear(amountDueNow - membresia);

  const suficiente = cubierto >= piso - TOLERANCIA_MXN;
  const sospechosa = suficiente && esperado != null && pagado < esperado - TOLERANCIA_MXN;

  return {
    suficiente,
    sospechosa,
    pagado,
    cubierto,
    piso,
    esperado,
    detalle: {
      bookingId,
      montoDeEsteCobro: monto,
      pagadoPrevio: redondear(pagadoPrevio),
      billetera,
      pagado,
      cubierto,
      piso,
      esperado,
      faltante: redondear(Math.max(0, piso - cubierto)),
      ...(errorPrevios ? { errorLeyendoPagosPrevios: errorPrevios.message } : {}),
    },
  };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
