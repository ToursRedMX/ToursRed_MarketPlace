// Puntos con que se pago un cargo posterior a la reserva (extra, seguro, abono
// o suplemento), para devolverlos como PUNTOS al cancelar la reserva completa
// (16-oct-2026).
//
// process_cancellation_refund recibe p_puntos_cargos_posteriores: los puntos ya
// incluidos en el monto que se devuelve. Cada llamador los calcula con la MISMA
// regla que su monto (el viajero devuelve abonos y seguro al porcentaje de la
// politica y los extras reembolsables al 100%; la agencia, todo al 100%).
//
// Desde 20261016042518 cada cargo guarda points_used. Los cargos anteriores
// pagados 100% con puntos (payment_method / payment_provider "points", sin
// points_used) se cuentan enteros: su valor completo fue puntos.

export const PUNTOS_POR_PESO = 100;

export interface CargoConPuntos {
  points_used?: number | string | null;
  /** payment_method (extras, suplementos) o payment_provider (abonos). */
  metodo?: string | null;
  /** El valor completo del cargo: total_paid, o amount en un abono. */
  total?: number | string | null;
}

/** Puntos con que se pago el cargo completo. */
export function puntosDelCargo(c: CargoConPuntos): number {
  const usados = Math.floor(Number(c.points_used) || 0);
  if (c.metodo === "points" && usados <= 0) {
    return Math.max(0, Math.round((Number(c.total) || 0) * PUNTOS_POR_PESO));
  }
  return Math.max(0, usados);
}

/** Los puntos que corresponden a devolver `porcentaje` (0..1) del cargo. */
export function puntosAlPorcentaje(puntos: number, porcentaje: number): number {
  const pct = Math.min(1, Math.max(0, Number.isFinite(porcentaje) ? porcentaje : 0));
  return Math.floor(puntos * pct);
}
