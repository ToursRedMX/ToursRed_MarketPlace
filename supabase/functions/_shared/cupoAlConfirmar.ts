// ¿Se puede confirmar una reserva que YA se cobro? Devuelve null si si, o el
// motivo si no.
//
// Hasta el 02-oct-2026 stripe-webhook decidia con get_tour_availability(tour),
// que no sabe de horarios: capacidad de UN viaje del tour menos las reservas de
// TODAS sus fechas, contando a la propia reserva (pending + approved). En
// Teotihuacan daba 0 con 34 reservas acumuladas y el horario a 5 de 20, y el
// webhook dejaba la reserva en pending despues de cobrar $589.
//
// Con horario, create_booking_atomic ya sumo esta reserva a
// tour_slots.booked_count al crearla: el lugar esta apartado. Lo unico que
// impide confirmar es que el horario haya quedado SOBREVENDIDO. Sin horario
// (reservas anteriores al flujo por horarios; la ultima del 26-ago-2026) se
// conserva el chequeo por tour.
export interface DatosDeCupo {
  slotId: string | null;
  viajeros: number;
  horario?: { capacity: number | string | null; booked_count: number | string | null } | null;
  errorHorario?: string | null;
  disponibleEnTour?: number | null;
  errorTour?: string | null;
}

export function motivoParaNoConfirmar(d: DatosDeCupo): string | null {
  if (d.slotId) {
    if (d.errorHorario || !d.horario) {
      return `no se pudo leer el horario ${d.slotId}: ${d.errorHorario ?? "no existe"}`;
    }
    const capacidad = Number(d.horario.capacity);
    const ocupados = Number(d.horario.booked_count);
    if (!Number.isFinite(capacidad) || !Number.isFinite(ocupados)) {
      return `horario ${d.slotId} con capacidad u ocupacion ilegible`;
    }
    return ocupados > capacidad ? `horario ${d.slotId} sobrevendido: ${ocupados} de ${capacidad}` : null;
  }

  if (d.errorTour || d.disponibleEnTour == null) {
    return `no se pudo leer la disponibilidad del tour: ${d.errorTour ?? "sin filas"}`;
  }
  return d.disponibleEnTour < d.viajeros
    ? `tour sin cupo: ${d.disponibleEnTour} libres, se requieren ${d.viajeros}`
    : null;
}
