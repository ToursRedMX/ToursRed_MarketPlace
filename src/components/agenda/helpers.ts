import { format, isToday, isTomorrow } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Operation } from '../../types/externalSales';

export const parseDay = (d: string) => new Date(d + 'T12:00:00');

/** "Hoy", "Mañana" o "sáb 4 oct". */
export function dayLabel(d: string): string {
  const date = parseDay(d);
  if (isToday(date)) return 'Hoy';
  if (isTomorrow(date)) return 'Mañana';
  return format(date, 'EEE d MMM', { locale: es });
}

export const longDay = (d: string) => format(parseDay(d), "EEEE d 'de' MMMM yyyy", { locale: es });

export type Tone = { label: string; badge: string; border: string };

/** Estado comercial de la salida a partir de su inventario. */
export function tone(o: Operation): Tone {
  if (o.status !== 'activo') return { label: o.status === 'cancelado' ? 'Cancelada' : o.status, badge: 'bg-slate-100 text-slate-700', border: 'border-l-slate-300' };
  const occupied = o.capacity - o.available;
  if (o.available <= 0) return { label: 'Llena', badge: 'bg-emerald-100 text-emerald-800', border: 'border-l-emerald-500' };
  if (o.capacity > 0 && occupied / o.capacity >= 0.8) return { label: 'Casi llena', badge: 'bg-amber-100 text-amber-800', border: 'border-l-amber-500' };
  if (o.marketplace + o.external === 0) return { label: 'Sin ventas', badge: 'bg-slate-100 text-slate-600', border: 'border-l-slate-300' };
  return { label: 'Con ventas', badge: 'bg-blue-100 text-blue-800', border: 'border-l-blue-500' };
}

export const time5 = (t: string | null) => t?.slice(0, 5) ?? 'Sin horario';
