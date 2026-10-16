// Tope de puntos para suplementos, extras y mensualidades (regla de Axel, 16-oct-2026).
//
// Los puntos ToursRed cubren como maximo el 50% de CUALQUIER pago; en una
// mensualidad, el 50% de cada abono. La reserva ya lo aplicaba en
// create_booking_atomic (v_max_points_allowed); aqui vive la misma regla para
// los cobros que no pasan por ahi.
//
// Consecuencias:
//   - "points" deja de ser una forma de pago: pagar 100% con puntos rompe el
//     tope. Los puntos viajan en `points_to_use` junto con el metodo que paga
//     el resto.
//   - Por ahora el resto solo puede ser ToursRed Cash. Puntos + pasarela
//     necesita que cada procesador descuente los puntos al confirmar el cobro,
//     y eso es el siguiente PR.
//
// 100 puntos = $1 MXN, la misma conversion que deduct_points_for_booking.

export const PUNTOS_POR_PESO = 100;
export const TOPE_PUNTOS = 0.5;

/** Maximo de puntos que puede cubrir un pago de `baseMxn` pesos. */
export function maxPuntosPermitidos(baseMxn: number): number {
  if (!Number.isFinite(baseMxn) || baseMxn <= 0) return 0;
  // Centavos enteros antes de aplicar el 50%: 250.10 * 100 da 25009.999...
  return Math.floor(Math.round(baseMxn * PUNTOS_POR_PESO) * TOPE_PUNTOS);
}

export type PuntosValidados =
  | { ok: true; puntos: number; pesos: number }
  | { ok: false; error: string };

/**
 * Lo que se puede revisar sin conocer el monto: que "points" no venga sola, que
 * points_to_use sea un entero y que acompane a ToursRed Cash. Va ANTES del
 * codigo MFA de gasto, para no gastarle un codigo de un solo uso al viajero en
 * una peticion que se iba a rechazar de todos modos.
 *
 * @param metodo         payment_method de la peticion
 * @param puntosPedidos  points_to_use de la peticion (ausente = 0)
 */
export function validarFormaDePuntos(metodo: string, puntosPedidos: unknown): PuntosValidados {
  if (metodo === "points") {
    return {
      ok: false,
      error: "Los puntos ToursRed cubren como máximo el 50% del pago. Combínalos con ToursRed Cash.",
    };
  }

  const puntos = puntosPedidos === undefined || puntosPedidos === null ? 0 : Number(puntosPedidos);
  if (!Number.isInteger(puntos) || puntos < 0) {
    return { ok: false, error: "points_to_use debe ser un número entero de puntos, cero o mayor." };
  }
  if (puntos === 0) return { ok: true, puntos: 0, pesos: 0 };

  if (metodo !== "toursred_cash") {
    return { ok: false, error: "Por ahora los puntos solo se pueden combinar con ToursRed Cash." };
  }

  return { ok: true, puntos, pesos: puntos / PUNTOS_POR_PESO };
}

/**
 * validarFormaDePuntos mas el tope del 50%.
 *
 * @param baseMxn  lo que se puede pagar con puntos: el subtotal o el abono, sin
 *                 cargo por servicio (que con Cash es cero de todos modos)
 */
export function validarPuntos(metodo: string, puntosPedidos: unknown, baseMxn: number): PuntosValidados {
  const forma = validarFormaDePuntos(metodo, puntosPedidos);
  if (!forma.ok || forma.puntos === 0) return forma;
  const puntos = forma.puntos;

  const max = maxPuntosPermitidos(baseMxn);
  if (puntos > max) {
    return {
      ok: false,
      error: `Puedes usar hasta ${max.toLocaleString("es-MX")} puntos en este pago (el 50% de $${baseMxn.toFixed(2)}).`,
    };
  }

  return { ok: true, puntos, pesos: puntos / PUNTOS_POR_PESO };
}

/**
 * Puntos ganados por un pago sin pasarela: el Cash va doble y lo pagado con
 * puntos sencillo (los puntos no son monedero). Misma formula que
 * award_points_for_booking y allocate_payment_plan_installment.
 */
export function puntosGanadosSinPasarela(totalMxn: number, pesosEnPuntos: number): number {
  return Math.floor((totalMxn - pesosEnPuntos) * 2 + pesosEnPuntos);
}
