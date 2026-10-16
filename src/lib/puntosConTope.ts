// Tope de puntos para suplementos, extras y mensualidades (regla de Axel, 16-oct-2026).
//
// Los puntos cubren como maximo el 50% de un pago y, por ahora, se combinan solo
// con ToursRed Cash. Copia del lado del navegador de
// supabase/functions/_shared/puntosConTope.ts: el servidor vuelve a validar, esto
// solo evita mandar una peticion que se va a rechazar.

export const PUNTOS_POR_PESO = 100;
const TOPE_PUNTOS = 0.5;

/** Maximo de puntos para un pago de `baseMxn`. Igual que maxPuntosPermitidos del servidor. */
export function maxPuntosPermitidos(baseMxn: number): number {
  if (!Number.isFinite(baseMxn) || baseMxn <= 0) return 0;
  // Centavos enteros antes de aplicar el 50%: 250.10 * 100 da 25009.999...
  return Math.floor(Math.round(baseMxn * PUNTOS_POR_PESO) * TOPE_PUNTOS);
}

/** Puntos que se mandan como points_to_use: todos los que alcancen, hasta el tope. */
export function puntosAAplicar(usar: boolean, saldoPuntos: number, baseMxn: number): number {
  if (!usar) return 0;
  return Math.max(0, Math.min(Math.floor(saldoPuntos), maxPuntosPermitidos(baseMxn)));
}
