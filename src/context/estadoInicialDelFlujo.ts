import { BookingFlowState, INITIAL_FLOW_STATE } from '../types/booking-flow';
import type { Tour } from '../types/index';

/**
 * Estado con el que arranca el flujo.
 *
 * El tour sale SIEMPRE del recien cargado, no del guardado. Hasta el
 * 25-sep-2026 el guardado ganaba entero: `resetFlow()` (al terminar una
 * reserva con wallet, SPEI o pendiente de aprobacion) deja `tour: null`, eso
 * se guardaba, y la siguiente vez que se abria el mismo tour en la pestana el
 * Paso 1 no pintaba nada (`if (!tour) return null`) debajo de un «Cambiaste
 * la fecha de tu tour» que el propio reset habia disparado.
 *
 * El aviso tampoco se restaura: es de un momento, no de la sesion.
 */
export function estadoInicialDelFlujo(
  guardado: BookingFlowState | null,
  tourSlug: string,
  tourCargado: Tour | null | undefined,
): BookingFlowState {
  const base = guardado ?? { ...INITIAL_FLOW_STATE, tourSlug };
  const tour = tourCargado ?? base.tour;
  return {
    ...base,
    tourSlug,
    tour,
    tourId: tour?.id ?? base.tourId,
    pendingRedirectMessage: null,
  };
}
