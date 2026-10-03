import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isToday, startOfMonth, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Ticket, Users } from 'lucide-react';
import { useAgencyId } from '../../hooks/useAgencyId';
import { loadOperations, errorText } from '../../lib/externalSales';
import { operationKey } from '../../types/externalSales';
import type { Operation } from '../../types/externalSales';
import DepartureDetail from '../../components/agenda/DepartureDetail';
import { OccupancyBar } from '../../components/agenda/shared';
import { dayLabel, parseDay, time5, tone } from '../../components/agenda/helpers';

// AgencyExternalSales importa OriginBadge desde aqui.
export { OriginBadge } from '../../components/agenda/shared';

type View = 'lista' | 'semana' | 'mes';
const VIEWS: { id: View; label: string }[] = [{ id: 'lista', label: 'Próximas' }, { id: 'semana', label: 'Semana' }, { id: 'mes', label: 'Mes' }];
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function DepartureCard({ o, onOpen }: { o: Operation; onOpen: () => void }) {
  const t = tone(o);
  const occupied = o.marketplace + o.external;
  return (
    <button type="button" onClick={onOpen} className={`group block w-full rounded-xl border border-l-4 border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${t.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900 group-hover:text-blue-700">{o.tour_name}</div>
          <div className="text-sm text-slate-500">{time5(o.departure_time)}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.badge}`}>{t.label}</span>
      </div>
      <div className="mt-3"><OccupancyBar o={o} /></div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
        <span><strong className="text-slate-900">{occupied}</strong> / {o.capacity} viajeros</span>
        <span className="font-semibold text-emerald-700">{o.available} disponibles</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{o.marketplace} ToursRed · {o.external} externos{o.blocked > 0 ? ` · ${o.blocked} bloqueados` : ''}</div>
    </button>
  );
}

function CalendarChip({ o, onOpen }: { o: Operation; onOpen: () => void }) {
  const t = tone(o);
  return (
    <button type="button" onClick={onOpen} title={`${o.tour_name} · ${o.marketplace + o.external}/${o.capacity}`} className={`block w-full rounded-md border-l-4 bg-slate-50 px-1.5 py-1 text-left text-[11px] leading-tight hover:bg-blue-50 ${t.border}`}>
      <span className="font-semibold text-slate-900">{time5(o.departure_time)}</span> <span className="text-slate-600">{o.tour_name}</span>
      <span className="block text-slate-500">{o.marketplace + o.external}/{o.capacity} · {o.available} libres</span>
    </button>
  );
}

export default function AgencyAgenda({ embedded = false }: { embedded?: boolean }) {
  const { agencyId, error: agencyError } = useAgencyId();
  const [params, setParams] = useSearchParams();
  const [anchor, setAnchor] = useState(() => iso(new Date()));
  const [view, setView] = useState<View>('lista');
  const [selected, setSelected] = useState('');
  const [tourFilter, setTourFilter] = useState('');

  const date = parseDay(anchor);
  const from = iso(view === 'mes' ? startOfMonth(date) : view === 'semana' ? startOfWeek(date, { weekStartsOn: 1 }) : date);
  const to = iso(view === 'mes' ? endOfMonth(date) : view === 'semana' ? endOfWeek(date, { weekStartsOn: 1 }) : addDays(date, 89));
  const query = useQuery({ queryKey: ['agency-operations', agencyId, from, to], enabled: !!agencyId, queryFn: () => loadOperations(agencyId!, from, to), refetchInterval: 30000 });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const tours = useMemo(() => [...new Map(all.map(o => [o.tour_id, o.tour_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);
  const ops = useMemo(() => all.filter(o => !tourFilter || o.tour_id === tourFilter), [all, tourFilter]);
  const picked = all.find(o => operationKey(o) === selected) ?? all.find(o => o.tour_id === params.get('tour') && o.slot_id === (params.get('slot') || null));

  const stats = useMemo(() => {
    const live = ops.filter(o => o.status === 'activo');
    const people = live.reduce((s, o) => s + o.marketplace + o.external, 0);
    const cap = live.reduce((s, o) => s + o.capacity, 0);
    return { departures: live.length, people, tr: live.reduce((s, o) => s + o.marketplace, 0), ext: live.reduce((s, o) => s + o.external, 0), pct: cap ? Math.round(((cap - live.reduce((s, o) => s + o.available, 0)) / cap) * 100) : 0, free: live.reduce((s, o) => s + o.available, 0) };
  }, [ops]);

  const byDay = useMemo(() => {
    const m = new Map<string, Operation[]>();
    ops.forEach(o => m.set(o.departure_date, [...(m.get(o.departure_date) ?? []), o]));
    return m;
  }, [ops]);

  const days = eachDayOfInterval({ start: parseDay(from), end: parseDay(to) });
  const step = (dir: 1 | -1) => setAnchor(iso(view === 'mes' ? addMonths(date, dir) : addDays(date, (view === 'semana' ? 7 : 90) * dir)));
  const periodLabel = view === 'mes' ? format(date, 'MMMM yyyy', { locale: es }) : `${format(parseDay(from), 'd MMM', { locale: es })} – ${format(parseDay(to), 'd MMM yyyy', { locale: es })}`;

  function close() {
    setSelected('');
    if (params.has('tour') || params.has('slot')) { const next = new URLSearchParams(params); next.delete('tour'); next.delete('slot'); setParams(next, { replace: true }); }
  }
  const open = (o: Operation) => setSelected(operationKey(o));

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

  return (
    <div className={embedded ? 'space-y-5' : 'mx-auto max-w-7xl space-y-5 p-4 md:p-8'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda operativa</h1>
          <p className="text-slate-600">Una salida, todos sus viajeros. Herramienta gratuita.</p>
        </div>
        <Link className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800" to="/agency/external-sales"><Plus className="h-4 w-4" aria-hidden />Registrar venta externa</Link>
      </header>

      <section aria-label="Resumen del periodo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<CalendarDays className="h-4 w-4" aria-hidden />} label="Salidas en el periodo" value={String(stats.departures)} />
        <Kpi icon={<Users className="h-4 w-4" aria-hidden />} label="Viajeros confirmados" value={String(stats.people)} hint={`${stats.tr} ToursRed · ${stats.ext} externos`} />
        <Kpi icon={<span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden />} label="Ocupación" value={`${stats.pct}%`} />
        <Kpi icon={<Ticket className="h-4 w-4" aria-hidden />} label="Lugares disponibles" value={String(stats.free)} hint="Por vender" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-sm" role="group" aria-label="Vista">
          {VIEWS.map(v => <button key={v.id} onClick={() => setView(v.id)} aria-pressed={view === v.id} className={'rounded-md px-3 py-1.5 font-medium ' + (view === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>{v.label}</button>)}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => step(-1)} aria-label="Periodo anterior" className={btn + ' px-2'}><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setAnchor(iso(new Date()))} className={btn}>Hoy</button>
          <button onClick={() => step(1)} aria-label="Periodo siguiente" className={btn + ' px-2'}><ChevronRight className="h-4 w-4" /></button>
        </div>
        <span className="text-sm font-semibold capitalize text-slate-700">{periodLabel}</span>
        <input type="date" aria-label="Ir a la fecha" className="rounded-lg border border-slate-300 px-2 py-2 text-sm" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} />
        <select aria-label="Filtrar por tour" value={tourFilter} onChange={e => setTourFilter(e.target.value)} className="max-w-[16rem] rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">Todos los tours</option>
          {tours.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button onClick={() => void query.refetch()} className={btn + ' ml-auto'} aria-label="Actualizar"><RefreshCw className={'h-4 w-4 ' + (query.isFetching ? 'animate-spin' : '')} /></button>
      </div>

      {(agencyError || query.error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{agencyError ?? errorText(query.error)}</p>}
      {query.isPending && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}</div>}

      {view === 'lista' ? (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day} aria-label={dayLabel(day)}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <span className={isToday(parseDay(day)) ? 'text-blue-700' : ''}>{dayLabel(day)}</span>
                <span className="font-normal normal-case tracking-normal text-slate-400">{format(parseDay(day), "d 'de' MMMM", { locale: es })}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(o => <DepartureCard key={operationKey(o) + day} o={o} onOpen={() => open(o)} />)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[860px] grid-cols-7 gap-1.5">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <div key={d} className="px-2 py-1 text-xs font-semibold uppercase text-slate-500">{d}</div>)}
            {Array.from({ length: (parseDay(from).getDay() + 6) % 7 }, (_, i) => <div key={'blank' + i} />)}
            {days.map(d => {
              const list = byDay.get(iso(d)) ?? [];
              return (
                <div key={iso(d)} className={'min-h-28 space-y-1 rounded-lg border p-1.5 ' + (isToday(d) ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white')}>
                  <div className={'text-xs font-semibold ' + (isToday(d) ? 'text-blue-700' : 'text-slate-500')}>{format(d, 'd')}</div>
                  {list.map(o => <CalendarChip key={operationKey(o)} o={o} onOpen={() => open(o)} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!query.isPending && !query.error && !ops.length && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
          <p className="mt-3 font-semibold text-slate-800">No hay salidas en este periodo</p>
          <p className="text-sm text-slate-500">{tourFilter ? 'Prueba con otro tour o quita el filtro.' : 'Cambia de fechas o publica nuevas salidas de tus tours.'}</p>
        </div>
      )}

      {picked && agencyId && <DepartureDetail key={operationKey(picked)} op={picked} agency={agencyId} onClose={close} onRefresh={() => void query.refetch()} />}
    </div>
  );
}
