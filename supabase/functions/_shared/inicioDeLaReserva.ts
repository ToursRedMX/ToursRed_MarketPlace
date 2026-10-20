// Cuándo empieza el servicio de UNA reserva, para el QR de check-in.
//
// POR QUÉ EXISTE (19-oct-2026): `generate-booking-qr-token` leía solo `tours.start_date`. Los tours
// receptivos (salidas por horario, `tour_slots`) no tienen `start_date`: su fecha vive en la reserva
// (`selected_date`) y en el horario (`slot_date` + `departure_time`). Resultado: la función respondía 422
// «El tour no tiene fecha de inicio», no se creaba ningún token y el correo de confirmación salía sin QR.
// Medido ese día: 2 tours sin `start_date`, 60 reservas en ellos, 21 confirmadas sin token.
//
// REGLA
//   1. Si el tour tiene `start_date`, se usa tal cual (comportamiento de siempre, sin cambios).
//   2. Si no, la fecha del horario de la reserva (`slot_date`) con su `departure_time`; sin horario,
//      `selected_date` y por último `booking_date`, a las 00:00.
//   Las fechas sin zona son hora de Ciudad de México, UTC-6 todo el año (México no tiene horario de
//   verano desde 2022). El QR vence 24 h después de ese inicio: cubre todo el día del servicio.

export interface DatosDeInicio {
  tourStart?: string | null;
  slotDate?: string | null;
  departureTime?: string | null;
  selectedDate?: string | null;
  bookingDate?: string | null;
}

const UNA_HORA_MS = 60 * 60 * 1000;
export const VIGENCIA_QR_MS = 24 * UNA_HORA_MS;
const ZONA_CDMX = "-06:00";

const valida = (d: Date): boolean => !Number.isNaN(d.getTime());
const soloFecha = (v: string): string => v.slice(0, 10);

/** null si no hay de dónde sacar una fecha válida. */
export function inicioDeLaReserva(d: DatosDeInicio): Date | null {
  if (d.tourStart) {
    const inicio = new Date(d.tourStart);
    return valida(inicio) ? inicio : null;
  }

  const fecha = d.slotDate || d.selectedDate || d.bookingDate;
  if (!fecha) return null;

  // La hora del horario solo vale si la fecha es la del horario: con `selected_date` suelto no hay hora.
  const hora = d.slotDate && d.departureTime ? d.departureTime.slice(0, 5) : "00:00";
  const inicio = new Date(`${soloFecha(fecha)}T${hora}:00${ZONA_CDMX}`);
  return valida(inicio) ? inicio : null;
}

export function vencimientoDelQr(inicio: Date): Date {
  return new Date(inicio.getTime() + VIGENCIA_QR_MS);
}

/**
 * Fechas para MOSTRAR en la pantalla de check-in: las del tour si las tiene; si no, el día del horario
 * de la reserva (inicio y fin pueden ser el mismo día). Devuelve `null` en lo que no pueda determinar.
 */
export function fechasParaMostrar(
  tour: { start_date: string | null; end_date: string | null } | null,
  d: { slotDate?: string | null; slotEndDate?: string | null; selectedDate?: string | null; bookingDate?: string | null },
): { start_date: string | null; end_date: string | null } {
  const dia = d.slotDate || d.selectedDate || d.bookingDate || null;
  const inicio = tour?.start_date ?? dia;
  const fin = tour?.end_date ?? d.slotEndDate ?? dia;
  return { start_date: inicio ?? null, end_date: fin ?? null };
}
