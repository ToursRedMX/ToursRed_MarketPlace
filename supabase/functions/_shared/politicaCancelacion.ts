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
  tour_destinations?: { destinations?: { time_zone?: string | null } | null }[] | null;
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

const ZONA_POR_OMISION = "America/Mexico_City";

/**
 * Zona horaria del tour: la de sus destinos cuando todos coinciden (misma regla
 * que el SMS de recordatorio, `booking_sms_snapshot`); si no hay destinos, hay
 * zonas distintas o la zona no es valida, Ciudad de Mexico.
 */
export function zonaDelTour(tour: TourConPolitica): string {
  const zonas = new Set<string>();
  for (const td of tour.tour_destinations ?? []) {
    const z = td?.destinations?.time_zone;
    if (z) zonas.add(z);
  }
  if (zonas.size !== 1) return ZONA_POR_OMISION;
  const zona = [...zonas][0];
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return zona;
  } catch {
    return ZONA_POR_OMISION;
  }
}

/** Milisegundos que `zona` va por delante de UTC en el instante `t`. */
function desfaseDeZona(zona: string, t: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(t / 1000) * 1000;
}

/**
 * El instante en que el reloj de `zona` marca `fecha` (YYYY-MM-DD) y `hora`
 * (HH:MM o HH:MM:SS). Antes la salida se armaba sin zona y el servidor la leia
 * como UTC: un tour a las 08:00 de Ciudad de Mexico contaba como 08:00 UTC,
 * 6 horas despues de la real, y los bordes de 24 y 48 h salian corridos.
 */
export function instanteLocal(fecha: string, hora: string, zona: string): Date {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const [h, mi, s] = hora.split(":").map(Number);
  const nominal = Date.UTC(a, m - 1, d, h || 0, mi || 0, s || 0);
  let t = nominal - desfaseDeZona(zona, nominal);
  t = nominal - desfaseDeZona(zona, t); // segunda pasada: el desfase puede cambiar justo en el borde
  return new Date(t);
}

/**
 * Fecha y hora de salida, en la zona horaria del tour. En receptivos manda la
 * fecha elegida por el viajero; si no la hay, la del tour; y si tampoco,
 * manana, para que la cancelacion no se bloquee. `null` si un tour que no es
 * receptivo no tiene fecha: el llamador decide que responder.
 * `tours.start_date` es una fecha sin hora: cuenta como las 00:00 locales.
 */
export function salidaDelTour(
  tour: TourConPolitica,
  reserva: ReservaConFecha,
  ahora: Date = new Date(),
): { salida: Date; fechaParaRegistro: string } | null {
  const zona = zonaDelTour(tour);
  if (tour.tour_type === "receptivo") {
    const fecha = reserva.selected_date ?? null;
    const hora = reserva.selected_time || "00:00:00";
    if (fecha) return { salida: instanteLocal(fecha, hora, zona), fechaParaRegistro: fecha };
    if (tour.start_date) return { salida: instanteLocal(tour.start_date, "00:00:00", zona), fechaParaRegistro: tour.start_date };
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    return { salida: manana, fechaParaRegistro: manana.toISOString().split("T")[0] };
  }
  if (!tour.start_date) return null;
  return { salida: instanteLocal(tour.start_date, "00:00:00", zona), fechaParaRegistro: tour.start_date };
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
