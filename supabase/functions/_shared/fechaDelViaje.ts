// Fecha de un viaje para los correos.
//
// tours.start_date es NULL en los tours receptivos y new Date(null) es el 1 de
// enero de 1970 (visto en el correo de No Show). La fecha buena es la que reservo el
// viajero, bookings.selected_date; la del tour solo es respaldo.
//
// Una fecha sola ('2026-10-17') se lee como medianoche UTC y en Mexico salia un dia
// antes: se ancla al mediodia y se formatea en hora de Mexico.

export const SIN_FECHA = "Por confirmar";

export interface OpcionesFechaViaje {
  weekday?: "long";
  conHora?: boolean;
}

export function formatearFechaViaje(
  fecha: string | null | undefined,
  opciones: OpcionesFechaViaje = {},
): string {
  if (!fecha) return SIN_FECHA;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00Z` : fecha);
  if (Number.isNaN(d.getTime())) return SIN_FECHA;
  return d.toLocaleDateString("es-MX", {
    ...(opciones.weekday ? { weekday: opciones.weekday } : {}),
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Mexico_City",
  });
}

/** La fecha de la reserva, con la del tour de respaldo. */
export function fechaDelViaje(
  reserva: { selected_date?: string | null } | null | undefined,
  tour: { start_date?: string | null } | null | undefined,
): string | null {
  return reserva?.selected_date ?? tour?.start_date ?? null;
}
