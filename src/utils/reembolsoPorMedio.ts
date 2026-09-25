/**
 * Reparte un reembolso por medio de pago: los puntos vuelven como puntos y
 * el dinero como ToursRed Cash, cada uno al mismo porcentaje de la politica.
 *
 * ES LA MISMA REGLA QUE `public.reembolso_por_medio()` en SQL (migracion
 * 20260925230000), que es la que de verdad mueve el dinero. Esta copia solo
 * sirve para que el modal de cancelacion diga lo que va a pasar;
 * `scripts/test-reembolso-por-medio.mjs` comprueba que las dos cumplan los
 * mismos vectores.
 *
 * Hasta el 25-sep-2026 el modal decia «te devolveremos $500 a tu ToursRed
 * Cash» en una reserva pagada con $250 en Cash y 25,000 puntos, y el servidor
 * hacia justo eso, y ademas devolvia los puntos.
 */

/** 100 pts = $1 MXN, misma conversion que deduct_points_for_booking. */
export const PUNTOS_POR_PESO = 100;

export interface ReembolsoPorMedio {
  /** Lo que vuelve a ToursRed Cash. */
  cash: number;
  /** Los ToursRed Points que vuelven. */
  puntos: number;
}

export function reembolsoPorMedio(
  monto: number,
  puntosUsados: number | null | undefined,
  porcentaje: number | null | undefined,
  montoIncluyePuntos = true,
): ReembolsoPorMedio {
  const pct = Math.min(1, Math.max(0, porcentaje ?? 1));
  const pts = Math.max(0, puntosUsados ?? 0);
  const puntos = Math.floor(pts * pct);
  const bruto = montoIncluyePuntos ? (monto ?? 0) - (pct * pts) / PUNTOS_POR_PESO : (monto ?? 0);
  // Mismo redondeo que round(x, 2) de Postgres: a centavos, mitades hacia arriba.
  const cash = Math.max(0, Math.round(bruto * 100 + Number.EPSILON) / 100);
  return { cash, puntos };
}
