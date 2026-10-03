import type { Operation } from '../../types/externalSales';

export function OriginBadge({ origin }: { origin: string }) {
  return <span className={'inline-block rounded-full px-2 py-1 text-xs font-medium ' + (origin === 'Externa' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900')}>{origin}</span>;
}

/** Barra segmentada: ToursRed, externas, bloqueados, apartados y libres. */
export function OccupancyBar({ o, className = 'h-2' }: { o: Operation; className?: string }) {
  const cap = Math.max(o.capacity, 1);
  const seg = (n: number, color: string, title: string) => n > 0 ? <div className={color} style={{ width: `${(n / cap) * 100}%` }} title={`${title}: ${n}`} /> : null;
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${className}`} role="img" aria-label={`${o.marketplace} ToursRed, ${o.external} externos, ${o.available} disponibles de ${o.capacity}`}>
      {seg(o.marketplace, 'bg-blue-600', 'ToursRed')}
      {seg(o.external, 'bg-amber-500', 'Externos')}
      {seg(o.blocked, 'bg-slate-400', 'Bloqueados')}
      {seg(o.held, 'bg-violet-300', 'Apartados')}
    </div>
  );
}

