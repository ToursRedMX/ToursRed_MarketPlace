/**
 * Politica de cancelacion del tour: cuando sale y que porcentaje se devuelve.
 *
 * POR QUE EXISTE
 *
 * Hasta el 25-sep-2026 la cancelacion parcial aplicaba dias fijos (15+ ->
 * 100%, 7-14 -> 50%, <7 -> 0) mientras la total usaba la politica del tour
 * (`flexible_hours` / `moderate_hours`). En un tour receptivo de 48 h,
 * quitar a un viajero 5 dias antes daba 0% y cancelar la reserva completa el
 * mismo dia daba 100%. Axel decidio que las dos usen la del tour; este modulo
 * es esa unica regla, y la usan `process-traveler-cancellation` y
 * `process-partial-cancellation`.
 *
 * `src/lib/supabase.ts` (calculateCancellationPolicy) tiene su propia copia
 * para el modal del front: es de las duplicaciones del desglose de costos que
 * CLAUDE.md pide centralizar, y no se toca aqui.
 */

export interface TourConPolitica {
  tour_type?: string | null;
  start_date?: string | null;
  cancellation_not_allowed?: boolean | null;
  flexible_hours?: number | string | null;
  flexible_refund_percentage?: number | string | null;
  moderate_hours?: number | string | null;
  moderate_refund_percentage?: number | string | null;
}

export interface ReservaConFecha {
  selected_date?: string | null;
  selected_time?: string | null;
}

export type TipoDePolitica = "pending_approval" | "no_refund" | "100_percent" | "50_percent";

/**
 * Fecha y hora de salida. En receptivos manda la fecha elegida por el
 * viajero; si no la hay, la del tour; y si tampoco, manana, para que la
 * cancelacion no se bloquee. `null` si un tour que no es receptivo no tiene
 * fecha: el llamador decide que responder.
 */
export function salidaDelTour(
  tour: TourConPolitica,
  reserva: ReservaConFecha,
  ahora: Date = new Date(),
): { salida: Date; fechaParaRegistro: string } | null {
  if (tour.tour_type === "receptivo") {
    const fecha = reserva.selected_date ?? null;
    const hora = reserva.selected_time || "00:00:00";
    if (fecha) return { salida: new Date(`${fecha}T${hora}`), fechaParaRegistro: fecha };
    if (tour.start_date) return { salida: new Date(tour.start_date), fechaParaRegistro: tour.start_date };
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    return { salida: manana, fechaParaRegistro: manana.toISOString().split("T")[0] };
  }
  if (!tour.start_date) return null;
  return { salida: new Date(tour.start_date), fechaParaRegistro: tour.start_date };
}

/**
 * Porcentaje (0-1) que se devuelve segun las horas que faltan para salir.
 * Defaults: 48 h -> 100%, 24 h -> 50%, menos -> 0.
 */
export function politicaDelTour(
  tour: TourConPolitica,
  horasAntes: number,
  pendienteDeAprobacion = false,
): { policyType: TipoDePolitica; refundPct: number } {
  if (pendienteDeAprobacion) return { policyType: "pending_approval", refundPct: 1 };
  if (tour.cancellation_not_allowed) return { policyType: "no_refund", refundPct: 0 };

  const flexibleHours = Number(tour.flexible_hours ?? 48);
  const flexibleRefundPct = Number(tour.flexible_refund_percentage ?? 100) / 100;
  const moderateHours = Number(tour.moderate_hours ?? 24);
  const moderateRefundPct = Number(tour.moderate_refund_percentage ?? 50) / 100;

  if (horasAntes >= flexibleHours) {
    return { policyType: flexibleRefundPct >= 1 ? "100_percent" : "50_percent", refundPct: flexibleRefundPct };
  }
  if (horasAntes >= moderateHours) {
    return { policyType: moderateRefundPct > 0 ? "50_percent" : "no_refund", refundPct: moderateRefundPct };
  }
  return { policyType: "no_refund", refundPct: 0 };
}
