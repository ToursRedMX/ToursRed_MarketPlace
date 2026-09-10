// Cuanto le queda por cobrar al procesador, y cuanto hace falta para confirmar.
//
// ============================================================================
// POR QUE ESTE MODULO EXISTE
// ============================================================================
//
// El 09-sep-2026 el commit `9dd296b` metio esta expresion en CINCO sitios
// (create-paypal-order, create-conekta-order, create-openpay-checkout,
// capture-paypal-order y conekta-webhook):
//
//     Math.max(deposit_amount, amount_due_now - membership_cost)
//
// Y esta mal en los cinco, por el mismo motivo: **`deposit_amount` es BRUTO**
// —antes de puntos y ToursRed Cash— y **`amount_due_now` es NETO**, ya con la
// billetera descontada. Tomar el maximo de los dos anula el descuento.
//
// Medido contra las reservas reales el 10-sep-2026:
//
//   c5614bdc  pago 100% con ToursRed Cash. Debe 0. deposit_amount = 500.
//             Con el maximo, el techo de cobro sube a 500: se le puede cobrar
//             500 a quien no debe nada.
//
//   31db95c4  (TRG-E5BGCYW29XY) debe 4,706.84 y pago 562.61 en puntos sobre un
//             anticipo de 5,149.50. Con el maximo, el techo sube a 5,149.50:
//             442.66 de mas.
//
// 10 de 45 reservas usaron puntos o Cash, asi que no es un caso de laboratorio.
//
// Y en la direccion de CONFIRMAR, la misma expresion hace el dano simetrico:
// se vuelve un piso que quien pago con billetera nunca alcanza, y la reserva
// —ya pagada— se queda en `processing`.
//
// ============================================================================
// LAS DOS REGLAS, QUE SON DISTINTAS A PROPOSITO
// ============================================================================
//
// COBRAR   techo = amount_due_now - membership_cost   (o deposit_amount si es null)
//
//   `amount_due_now` es lo que calculo `create_booking_atomic` para el primer
//   cobro: anticipo + cargo por servicio + extras + seguro + membresia - puntos
//   - cash. Ya viene neto, asi que es exactamente lo que el viajero debe.
//   Se le resta `membership_cost` porque la membresia se cobra por otra via
//   (suscripcion de Stripe); dejarla dentro la cobraria dos veces.
//
// CONFIRMAR   piso = deposit_amount,  contra  pagado + puntos/100 + cash
//
//   Aqui el piso es BRUTO a proposito, y por eso hay que sumarle la billetera
//   a lo pagado. Es la misma regla que `_shared/coberturaDePago.ts` usa en el
//   webhook de Stripe, con sus 13 casos de prueba. No se replica el helper
//   entero porque estos dos llamadores ya traen sus propios totales, pero la
//   aritmetica es la de alli.
//
// Si algun dia hay que cambiar una de las dos, que sea aqui y no en cinco
// archivos que se van separando en silencio.

export interface DatosDeReserva {
  deposit_amount?: number | string | null;
  amount_due_now?: number | string | null;
  membership_cost?: number | string | null;
  points_used?: number | string | null;
  toursred_cash_used?: number | string | null;
  total_price?: number | string | null;
}

/** Tolerancia compartida con capture-paypal-order y coberturaDePago. */
export const TOLERANCIA_MXN = 0.5;

const num = (v: unknown): number => Number(v ?? 0) || 0;
const redondear = (n: number): number => Math.round(n * 100) / 100;

/**
 * Techo de un cobro nuevo: lo que el procesador todavia puede cobrar.
 *
 * NO incluye la billetera porque `amount_due_now` ya la descontó. Si viene
 * null —reservas viejas, o las que se pagaron enteras con Cash— se cae a
 * `deposit_amount`, y si tampoco esta, a `total_price`.
 */
export function exigibleAlProcesador(reserva: DatosDeReserva): number {
  if (reserva?.amount_due_now != null) {
    return redondear(Math.max(0, num(reserva.amount_due_now) - num(reserva.membership_cost)));
  }
  return redondear(num(reserva.deposit_amount) || num(reserva.total_price));
}

/** Lo que aporto la billetera, en pesos. 100 puntos = 1 peso. */
export function billeteraDeLaReserva(reserva: DatosDeReserva): number {
  return redondear(num(reserva.points_used) / 100 + num(reserva.toursred_cash_used));
}

/**
 * Piso para confirmar: el anticipo bruto, cubierto por lo que cobro el
 * procesador MAS lo que puso la billetera.
 *
 * Devuelve el desglose y no solo un booleano para que el llamador pueda
 * registrar por que no confirmo, que es la mitad del valor de este chequeo.
 */
export function cubreElAnticipo(
  reserva: DatosDeReserva,
  pagadoPorProcesadores: number,
): { suficiente: boolean; piso: number; cubierto: number; billetera: number; faltante: number } {
  const billetera = billeteraDeLaReserva(reserva);
  const cubierto = redondear(num(pagadoPorProcesadores) + billetera);
  const piso = redondear(num(reserva.deposit_amount) || num(reserva.total_price));
  return {
    suficiente: cubierto >= piso - TOLERANCIA_MXN,
    piso,
    cubierto,
    billetera,
    faltante: redondear(Math.max(0, piso - cubierto)),
  };
}
