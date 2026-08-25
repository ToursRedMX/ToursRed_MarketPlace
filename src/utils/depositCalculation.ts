import type { InstallmentDefinition, Tour } from '../types';

/**
 * Anticipo efectivo de un tour.
 *
 * ALCANCE: solo el porcentaje/monto de anticipo. NO es el desglose de costos
 * de la reserva (cargo por servicio, extras, seguro, puntos, wallet), que sigue
 * viviendo donde estaba. Este modulo existe para que ningun paso del wizard
 * muestre un anticipo distinto al de otro paso para el mismo tour.
 *
 * Debe mantenerse en paridad con create_booking_atomic (seccion 8), que es la
 * fuente de verdad del lado servidor:
 *   - full_upfront                -> 100%
 *   - payment_plan + installments -> suma de las parcialidades YA VENCIDAS,
 *                                    incluidas las de specific_date ya pasada
 *   - resto (standard, free_form) -> deposit_percentage del tour
 */

export const DEFAULT_DEPOSIT_PCT = 50;

/** Campos del tour que intervienen en el calculo. */
type DepositTourFields = Pick<Tour, 'deposit_percentage' | 'start_date'> &
  Partial<Pick<Tour, 'payment_option' | 'payment_plan_mode' | 'installment_definitions'>>;

/**
 * Fecha de vencimiento de una parcialidad, o null si no se puede determinar.
 * Los tres formatos son mutuamente excluyentes y se evaluan en el mismo orden
 * que la funcion de BD.
 */
function installmentDueDate(
  def: InstallmentDefinition,
  today: Date,
  departure: Date | null
): Date | null {
  if (def.days_after_booking != null) {
    const d = new Date(today);
    d.setDate(d.getDate() + Number(def.days_after_booking));
    return d;
  }
  if (def.days_before_departure != null && departure) {
    const d = new Date(departure);
    d.setDate(d.getDate() - Number(def.days_before_departure));
    return d;
  }
  if (def.specific_date) {
    return new Date(def.specific_date + 'T00:00:00');
  }
  return null;
}

/**
 * Porcentaje de anticipo que aplica hoy para este tour.
 *
 * @param selectedDate Fecha elegida por el viajero (tours receptivos con slots).
 *                     Si no se pasa, se usa tour.start_date como salida.
 */
export function getEffectiveDepositPct(
  tour: DepositTourFields | null | undefined,
  selectedDate?: string | null
): number {
  if (!tour) return DEFAULT_DEPOSIT_PCT;
  if (tour.payment_option === 'full_upfront') return 100;

  const genericPct = tour.deposit_percentage || DEFAULT_DEPOSIT_PCT;
  if (tour.payment_option !== 'payment_plan') return genericPct;
  if ((tour.payment_plan_mode || 'installments') !== 'installments') return genericPct;

  const defs = tour.installment_definitions;
  if (!Array.isArray(defs) || defs.length === 0) return genericPct;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const departureSrc = selectedDate || tour.start_date;
  const departure = departureSrc ? new Date(departureSrc + 'T00:00:00') : null;

  let pct = 0;
  for (const def of defs) {
    const due = installmentDueDate(def, today, departure);
    if (due && due.getTime() <= today.getTime()) {
      pct += Number(def.pct_of_total) || 0;
    }
  }

  return pct > 0 ? Math.min(100, pct) : genericPct;
}

/**
 * Monto del anticipo sobre un precio BRUTO de tour (sin cargo por servicio,
 * extras ni seguro: esos se suman aparte donde corresponda).
 */
export function getDepositAmount(
  grossTourPrice: number,
  tour: DepositTourFields | null | undefined,
  selectedDate?: string | null
): number {
  const pct = getEffectiveDepositPct(tour, selectedDate);
  return Math.round(grossTourPrice * (pct / 100) * 100) / 100;
}
