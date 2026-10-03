import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Armchair, ChevronDown, CircleCheck, FileSpreadsheet, FileText, MessageCircle, Phone, QrCode, X } from 'lucide-react';
import { assignExternalSeats, loadDepartureReservations, loadDepartureSeats, loadManifest, checkinExternal, errorText } from '../../lib/externalSales';
import { useAuth } from '../../context/AuthContext';
import { pendingExternalQr } from '../../lib/externalQrSession';
import { downloadExcel } from '../../utils/excelExport';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { CHANNELS } from '../../types/externalSales';
import type { DepartureReservation, DepartureSeat, ManifestRow, Operation } from '../../types/externalSales';
import AgendaSeatMap from './AgendaSeatMap';
import { BOOKING_COLORS, EXTERNAL_COLOR, useHasSeatMap } from './seatMapData';
import type { SeatOwner } from './seatMapData';
import DepartureFinance from './DepartureFinance';
import { canSeeMoney } from './financeMath';
import { OccupancyBar, OriginBadge } from './shared';
import { longDay, time5, tone } from './helpers';

const REFRESH_MS = 30_000;
const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Completada', active: 'Confirmada' };
const TYPE_LABEL: Record<string, string> = { adulto: 'Adulto', nino: 'Niño', infante: 'Infante', adulto_mayor: 'Adulto mayor', mascota: 'Mascota' };

// wa.me exige lada de pais: un numero de 10 digitos es mexicano.
const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 10 ? '52' + d : d; };

type Props = { op: Operation; agency: string; onClose: () => void; onRefresh: () => void };

export default function DepartureDetail({ op, agency, onClose, onRefresh }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [origin, setOrigin] = useState<'Todos' | 'ToursRed' | 'Externa'>('Todos');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [token, setToken] = useState(pendingExternalQr);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Viajero externo al que se le esta eligiendo asiento en el mapa.
  const [assigning, setAssigning] = useState<{ saleId: string; travelerId: string; name: string } | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);
  const [seatMsg, setSeatMsg] = useState('');
  const mapRef = useRef<HTMLElement>(null);
  const { isAgencyStaff, staffInfo } = useAuth();
  // Mismo criterio que la base (external_sale_access 'manage'): dueño, o staff con ambos permisos.
  const canAssign = !isAgencyStaff || (!!staffInfo?.permissions.canManageTours && !!staffInfo?.permissions.canViewFinancials);

  const keyBase = [agency, op.tour_id, op.slot_id];
  const manifest = useQuery({ queryKey: ['operational-manifest', ...keyBase], queryFn: () => loadManifest(op.tour_id, op.slot_id), refetchInterval: REFRESH_MS });
  const reservations = useQuery({ queryKey: ['departure-reservations', ...keyBase], queryFn: () => loadDepartureReservations(op.tour_id, op.slot_id), refetchInterval: REFRESH_MS });
  const { hasMap } = useHasSeatMap(op.tour_id);
  const seats = useQuery({ queryKey: ['departure-seats', ...keyBase], enabled: hasMap, queryFn: () => loadDepartureSeats(op.tour_id, op.slot_id), refetchInterval: REFRESH_MS });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const rows: DepartureReservation[] = useMemo(() => reservations.data ?? [], [reservations.data]);
  const money = canSeeMoney(rows);

  // Reservas ToursRed con color propio; las ventas externas comparten uno.
  const bookings = useMemo(() => {
    const m = new Map<string, { holder: string; code: string | null; people: number; color: string }>();
    rows.filter(r => r.origin === 'ToursRed').forEach((r, i) => m.set(r.reservation_id, { holder: r.holder_name, code: r.reservation_code, people: r.people, color: BOOKING_COLORS[i % BOOKING_COLORS.length] }));
    return m;
  }, [rows]);
  // Viajero externo -> su venta, para saber de quien es cada asiento del mapa.
  const externalOf = useMemo(() => {
    const m = new Map<string, { saleId: string; name: string }>();
    (manifest.data ?? []).forEach(t => { if (t.origin === 'Externa' && t.traveler_id) m.set(t.traveler_id, { saleId: t.reservation_id, name: t.traveler_name }); });
    return m;
  }, [manifest.data]);
  // Asientos por reserva (ToursRed por booking_id, externas por el viajero) y el asiento de cada viajero externo.
  const { seatsOf, seatOfTraveler } = useMemo(() => {
    const byRes = new Map<string, number[]>();
    const byTraveler = new Map<string, number>();
    (seats.data ?? []).forEach(st => {
      if (st.status !== 'reservado_online') return;
      let res: string | undefined;
      if (st.booking_id) res = st.booking_id;
      else if (st.external_traveler_id) { res = externalOf.get(st.external_traveler_id)?.saleId; byTraveler.set(st.external_traveler_id, st.seat_number); }
      if (res) byRes.set(res, [...(byRes.get(res) ?? []), st.seat_number]);
    });
    return { seatsOf: byRes, seatOfTraveler: byTraveler };
  }, [seats.data, externalOf]);
  const resolveSeat = (st: DepartureSeat): SeatOwner | null => {
    if (st.booking_id) {
      const b = bookings.get(st.booking_id);
      return b ? { groupId: st.booking_id, color: b.color, label: `${b.holder}${b.code ? ` (${b.code})` : ''} · ${b.people} ${b.people === 1 ? 'viajero' : 'viajeros'}` } : null;
    }
    if (st.external_traveler_id) {
      const e = externalOf.get(st.external_traveler_id);
      return e ? { groupId: e.saleId, color: EXTERNAL_COLOR, label: `${e.name} · venta externa` } : { groupId: st.external_traveler_id, color: EXTERNAL_COLOR, label: 'Venta externa' };
    }
    return null;
  };
  const seatedExternal = [...seatOfTraveler.keys()].filter(id => externalOf.has(id)).length;
  const unseatedExternal = Math.max(0, externalOf.size - seatedExternal);

  async function saveSeat(saleId: string, travelerId: string, seat: number | null) {
    setSeatBusy(true); setSeatMsg('');
    try {
      await assignExternalSeats(saleId, [{ traveler_id: travelerId, seat_number: seat }]);
      await seats.refetch();
      setAssigning(null);
    } catch (e) { setSeatMsg(errorText(e)); await seats.refetch(); } finally { setSeatBusy(false); }
  }
  function startAssign(saleId: string, travelerId: string, name: string) {
    setAssigning({ saleId, travelerId, name }); setSeatMsg(''); setActive(null);
  }
  // Al empezar a elegir asiento, lleva el mapa a la vista.
  const assigningId = assigning?.travelerId;
  useEffect(() => { if (assigningId) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [assigningId]);

  const travelersOf = useMemo(() => {
    const m = new Map<string, ManifestRow[]>();
    (manifest.data ?? []).forEach(t => m.set(t.reservation_id, [...(m.get(t.reservation_id) ?? []), t]));
    return m;
  }, [manifest.data]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(r => (origin === 'Todos' || r.origin === origin) && (!q
    || r.holder_name.toLowerCase().includes(q) || (r.reservation_code ?? '').toLowerCase().includes(q)
    || (travelersOf.get(r.reservation_id) ?? []).some(t => t.traveler_name.toLowerCase().includes(q))));

  const attendees = manifest.data ?? [];
  const checkedIn = attendees.filter(t => t.checked_in_at).reduce((s, t) => s + t.people, 0);
  const totalPeople = attendees.reduce((s, t) => s + t.people, 0);
  const t = tone(op);

  // Un viajero por renglon. ToursRed guarda los asientos por reserva; las ventas externas, por persona.
  const exportRows = (list: ManifestRow[]) => list.map(r => [
    r.traveler_name, r.origin, bookings.get(r.reservation_id)?.code ?? '', r.people, TYPE_LABEL[r.traveler_type] ?? r.traveler_type,
    r.origin === 'Externa' ? String((r.traveler_id && seatOfTraveler.get(r.traveler_id)) || '') : [...(seatsOf.get(r.reservation_id) ?? [])].sort((a, b) => a - b).join(', '), STATUS_LABEL[r.status] ?? r.status, r.checked_in_at ? 'Realizado' : 'Pendiente', r.phone ?? '',
  ]);
  const headers = ['Viajero', 'Origen', 'Reserva', 'Personas', 'Tipo', 'Asiento(s)', 'Estado', 'Check-in', 'Teléfono'];
  const exportList = attendees.filter(r => origin === 'Todos' || r.origin === origin);
  const title = `${op.tour_name} · ${op.departure_date} ${time5(op.departure_time)}`;
  async function exportExcel() {
    try { await downloadExcel([{ sheet: 'Asistentes', data: [[title], headers, ...exportRows(exportList)] }], 'asistentes.xlsx'); } catch (e) { setMessage(errorText(e)); }
  }
  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.text(title, 14, 16);
    autoTable(doc, { startY: 24, head: [headers], body: exportRows(exportList).map(r => r.map(String)), styles: { fontSize: 8 } });
    doc.save('lista-de-abordar.pdf');
  }

  async function checkin() {
    setBusy(true); setMessage('');
    try {
      let raw = token.trim();
      if (raw.includes('#')) raw = new URLSearchParams(raw.split('#')[1]).get('external-qr') ?? '';
      const result = await checkinExternal(raw, agency, op);
      setMessage(result.already_checked_in ? 'El check-in ya fue realizado.' : 'Check-in registrado: ' + result.checked_in + ' viajeros.');
      await manifest.refetch(); onRefresh();
    } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  }

  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={'Detalle de la salida: ' + title} className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-slate-50 shadow-2xl">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-bold text-slate-900">{op.tour_name}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.badge}`}>{t.label}</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600 first-letter:uppercase">{longDay(op.departure_date)} · {time5(op.departure_time)}</p>
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="Cerrar detalle" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-3">
            <OccupancyBar o={op} className="h-3" />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />{op.marketplace} ToursRed</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />{op.external} externos</span>
              {op.blocked > 0 && <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />{op.blocked} bloqueados</span>}
              {op.held > 0 && <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-300" />{op.held} apartados</span>}
              <span className="font-semibold text-emerald-700">{op.available} disponibles de {op.capacity}</span>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-5">
          {reservations.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errorText(reservations.error)}</p>}

          {money && <DepartureFinance rows={rows} />}

          {hasMap && (
            <section ref={mapRef} aria-label="Mapa de asientos" className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-base font-semibold text-slate-900">Mapa de asientos</h3>
              {seats.error
                ? <p role="alert" className="text-sm text-red-700">No se pudo cargar la ocupación de asientos; el mapa no se muestra para no enseñar lugares libres que no lo son. {errorText(seats.error)}</p>
                : <AgendaSeatMap
                    tourId={op.tour_id} seats={seats.data ?? []} resolve={resolveSeat} activeGroupId={active} onSelectGroup={setActive}
                    pick={assigning ? { prompt: `Elige un asiento libre para ${assigning.name}`, busy: seatBusy, onPick: n => void saveSeat(assigning.saleId, assigning.travelerId, n), onCancel: () => setAssigning(null) } : null} />}
              {seatMsg && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-sm text-red-800">{seatMsg}</p>}
              {unseatedExternal > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">{unseatedExternal} viajero(s) de ventas externas ocupan lugar en la salida pero aún no tienen asiento. {canAssign ? 'Asígnalos desde su reserva, más abajo.' : 'Quien administre la agencia puede asignárselos.'} Mientras tanto, los lugares libres del mapa pueden ser más que los disponibles reales ({op.available}).</p>}
            </section>
          )}

          <section aria-label="Reservas y viajeros" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Viajeros <span className="text-sm font-normal text-slate-500">· {checkedIn}/{totalPeople} con check-in</span></h3>
              <div className="flex gap-2">
                <button onClick={() => void exportExcel()} disabled={!manifest.data} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" aria-hidden />Excel</button>
                <button onClick={exportPdf} disabled={!manifest.data} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileText className="h-4 w-4" aria-hidden />Lista de abordar</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar viajero o código…" aria-label="Buscar viajero o código" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-sm" role="group" aria-label="Filtrar por origen">
                {(['Todos', 'ToursRed', 'Externa'] as const).map(o => <button key={o} onClick={() => setOrigin(o)} aria-pressed={origin === o} className={'rounded-md px-3 py-1.5 font-medium ' + (origin === o ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>{o === 'Externa' ? 'Externas' : o}</button>)}
              </div>
            </div>

            {(reservations.isPending || manifest.isPending) && <div className="h-24 animate-pulse rounded-xl bg-slate-100" />}
            {manifest.error && <p role="alert" className="text-sm text-red-700">{errorText(manifest.error)}</p>}
            {!reservations.isPending && !visible.length && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{rows.length ? 'Ningún viajero coincide con el filtro.' : 'Todavía no hay reservas en esta salida.'}</p>}

            <ul className="space-y-2">
              {visible.map(r => {
                const b = bookings.get(r.reservation_id);
                const mySeats = [...(seatsOf.get(r.reservation_id) ?? [])].sort((a, c) => a - c);
                const people = travelersOf.get(r.reservation_id) ?? [];
                const expanded = open.has(r.reservation_id);
                const isActive = active === r.reservation_id;
                return (
                  <li key={r.origin + r.reservation_id} className={'rounded-xl border bg-white ' + (isActive ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200')}>
                    <div className="flex items-start gap-3 p-3">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: b?.color ?? EXTERNAL_COLOR }} aria-hidden />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { toggle(r.reservation_id); if (mySeats.length) setActive(isActive ? null : r.reservation_id); }} aria-expanded={expanded}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{r.holder_name || 'Sin nombre'}</span>
                          <OriginBadge origin={r.origin} />
                          {r.reservation_code && <span className="font-mono text-xs text-slate-500">{r.reservation_code}</span>}
                          {r.channel && <span className="text-xs text-slate-500">{CHANNELS[r.channel] ?? r.channel}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                          <span>{r.people} {r.people === 1 ? 'viajero' : 'viajeros'}</span>
                          <span>{STATUS_LABEL[r.status] ?? r.status}</span>
                          {hasMap && (mySeats.length
                            ? <span className={'rounded px-1.5 py-0.5 text-xs font-semibold ' + (r.origin === 'Externa' ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-800')}>{mySeats.length === 1 ? 'Asiento' : 'Asientos'} {mySeats.join(', ')}</span>
                            : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">Sin asiento asignado</span>)}
                        </div>
                        {r.total_amount !== null && (
                          <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs tabular-nums text-slate-600">
                            <span>Total {formatCurrencyMXN(r.total_amount)}</span>
                            <span className="text-emerald-700">Cobrado {formatCurrencyMXN(r.collected_amount ?? 0)}</span>
                            <span className={(r.pending_amount ?? 0) > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}>{(r.pending_amount ?? 0) > 0 ? 'Falta ' + formatCurrencyMXN(r.pending_amount ?? 0) : 'Liquidada'}</span>
                          </div>
                        )}
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {r.holder_phone && <>
                          <a href={'https://wa.me/' + waNumber(r.holder_phone)} target="_blank" rel="noopener noreferrer" aria-label={'WhatsApp a ' + r.holder_name} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50"><MessageCircle className="h-4 w-4" /></a>
                          <a href={'tel:' + r.holder_phone} aria-label={'Llamar a ' + r.holder_name} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><Phone className="h-4 w-4" /></a>
                        </>}
                        <ChevronDown className={'h-4 w-4 text-slate-400 transition-transform ' + (expanded ? 'rotate-180' : '')} aria-hidden />
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                        {people.length ? (
                          <ul className="divide-y divide-slate-100 text-sm">
                            {people.map((p, i) => (
                              <li key={(p.traveler_id ?? 'x') + i} className="flex items-center justify-between gap-2 py-1.5">
                                <span className="text-slate-800">{p.traveler_name}<span className="ml-2 text-xs text-slate-500">{TYPE_LABEL[p.traveler_type] ?? p.traveler_type}</span></span>
                                <span className="flex items-center gap-3">
                                  {hasMap && r.origin === 'Externa' && p.traveler_id && (() => {
                                    const seat = seatOfTraveler.get(p.traveler_id);
                                    const picking = assigning?.travelerId === p.traveler_id;
                                    return (
                                      <span className="flex items-center gap-1.5">
                                        {seat !== undefined && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Asiento {seat}</span>}
                                        {canAssign && !p.checked_in_at && (
                                          <>
                                            <button type="button" disabled={seatBusy} onClick={() => picking ? setAssigning(null) : startAssign(r.reservation_id, p.traveler_id!, p.traveler_name)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Armchair className="h-3 w-3" aria-hidden />{picking ? 'Cancelar' : seat !== undefined ? 'Cambiar' : 'Asignar asiento'}</button>
                                            {seat !== undefined && !picking && <button type="button" disabled={seatBusy} onClick={() => void saveSeat(r.reservation_id, p.traveler_id!, null)} className="text-xs text-red-700 underline disabled:opacity-50">Quitar</button>}
                                          </>
                                        )}
                                      </span>
                                    );
                                  })()}
                                  {p.checked_in_at ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CircleCheck className="h-3.5 w-3.5" aria-hidden />Check-in</span> : <span className="text-xs text-slate-400">Pendiente</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="py-1 text-sm text-slate-500">No hay nombres capturados para esta reserva.</p>}
                        {r.holder_email && <p className="mt-1 text-xs text-slate-500">{r.holder_email}</p>}
                        {r.notes && <p className="mt-1 text-xs italic text-slate-600">Nota: {r.notes}</p>}
                        {r.has_payment_plan && <p className="mt-1 text-xs text-amber-800">Reserva con plan de pagos.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <details className="rounded-2xl border border-slate-200 bg-white p-4" open={!!token}>
            <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-900"><QrCode className="h-4 w-4 text-blue-600" aria-hidden />Check-in de venta externa</summary>
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-600">Confirma que estás en la salida correcta. Escanea el QR con la cámara de tu dispositivo para abrir esta agenda, o pega el enlace/token aquí.</p>
              <label className="block text-sm font-medium text-slate-700">QR / token
                <input className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
              </label>
              <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !token} onClick={() => void checkin()}>{busy ? 'Validando…' : 'Confirmar check-in externo'}</button>
              <p role="status" className="text-sm text-slate-700">{message}</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <Link className="text-blue-700 underline" to="/agency/bookings">Check-in y reservas ToursRed</Link>
                <Link className="text-blue-700 underline" to={'/agency/external-sales?tour=' + op.tour_id + (op.slot_id ? '&slot=' + op.slot_id : '')}>Ver ventas externas</Link>
              </div>
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}
