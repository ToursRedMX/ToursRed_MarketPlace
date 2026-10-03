import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { QRCodeSVG } from 'qrcode.react';
import { Banknote, CalendarDays, ClipboardList, FilterX, HandCoins, Info, Mail, Pencil, Plus, QrCode, Users, Wallet, XCircle } from 'lucide-react';
import { useAgencyId } from '../../hooks/useAgencyId';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { loadExternalSales, loadOperations, cancelExternalSale, generateExternalQr, externalQrUrl, errorText } from '../../lib/externalSales';
import { CHANNELS, EXTERNAL_NOTICE } from '../../types/externalSales';
import type { ExternalSale } from '../../types/externalSales';
import ExternalSaleForm from '../../components/external-sales/ExternalSaleForm';
import { OriginBadge } from './AgencyAgenda';
import { parseDay, time5 } from '../../components/agenda/helpers';

const money = (n: number, c: string) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: c }).format(n);
const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';
const actionBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

function Kpi({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, tone = 'text-slate-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export default function AgencyExternalSales() {
  const { agencyId } = useAgencyId();
  const { isAgencyStaff, staffInfo } = useAuth();
  const [params] = useSearchParams();
  const canManage = !isAgencyStaff || !!(staffInfo?.permissions.canManageTours && staffInfo.permissions.canViewFinancials);
  const [from, setFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => format(addDays(new Date(), 90), 'yyyy-MM-dd'));
  const [tour, setTour] = useState(params.get('tour') ?? '');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const [form, setForm] = useState<ExternalSale | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ url: string; sale: ExternalSale } | null>(null);
  const sales = useQuery({ queryKey: ['external-sales', agencyId, from, to], enabled: !!agencyId && !!from && !!to, queryFn: () => loadExternalSales(agencyId!, from, to) });
  const operations = useQuery({ queryKey: ['external-sale-options', agencyId], enabled: !!agencyId, queryFn: () => loadOperations(agencyId!, format(new Date(), 'yyyy-MM-dd'), format(addDays(new Date(), 365), 'yyyy-MM-dd')) });

  const slotParam = params.get('slot');
  // Misma lógica de filtros de siempre; solo se ordena por fecha de salida para que se lea como agenda.
  const filtered = (sales.data ?? [])
    .filter(s => (!tour || s.tour_id === tour) && (!slotParam || s.slot_id === slotParam) && (!channel || s.source === channel) && (!status || s.status === status)
      && (!payment || (payment === 'pending' ? Number(s.external_sale_financials?.amount_pending) > 0 : Number(s.external_sale_financials?.amount_pending) === 0)))
    .sort((a, b) => (a.departure_date + (a.departure_time ?? '')).localeCompare(b.departure_date + (b.departure_time ?? '')));
  const active = filtered.filter(s => s.status === 'active');
  const totals = new Map<string, { total: number; paid: number; pending: number }>();
  for (const s of active) {
    const f = s.external_sale_financials;
    if (f) {
      const t = totals.get(f.currency) ?? { total: 0, paid: 0, pending: 0 };
      t.total += Number(f.total_sale_amount); t.paid += Number(f.amount_paid); t.pending += Number(f.amount_pending);
      totals.set(f.currency, t);
    }
  }
  const names = new Map<string, string>((operations.data ?? []).map(o => [o.tour_id, o.tour_name]));
  for (const s of sales.data ?? []) if (s.tours?.name) names.set(s.tour_id, s.tours.name);
  const channelCounts = Object.entries(CHANNELS).map(([k, v]) => [k, v, filtered.filter(s => s.source === k).length] as const).filter(([, , n]) => n > 0);
  const hasFilters = !!(tour || channel || status || payment);
  const travelersActive = active.reduce((n, s) => n + s.travelers_count, 0);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); await Promise.all([sales.refetch(), operations.refetch()]); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  }
  async function showQr(s: ExternalSale) { const token = await generateExternalQr(s.id); setQr({ url: externalQrUrl(s, token), sale: s }); }
  async function sendQr(s: ExternalSale) {
    if (!s.operational_email_authorized) throw new Error('Registra primero la autorización de correo operativo.');
    const { data, error } = await supabase.functions.invoke('send-external-sale-qr', { body: { external_sale_id: s.id } });
    if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? 'No se pudo enviar el correo');
    setMessage('QR enviado con la marca de tu agencia.'); setQr(null);
  }
  function clearFilters() { setTour(''); setChannel(''); setStatus(''); setPayment(''); }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ventas externas</h1>
          <p className="text-slate-600">Control privado de tu agencia · Gratuito</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/agency/agenda" className={actionBtn}><CalendarDays className="h-4 w-4" aria-hidden />Agenda</Link>
          {canManage && <button className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800" onClick={() => setForm('new')}><Plus className="h-4 w-4" aria-hidden />Registrar venta externa</button>}
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{EXTERNAL_NOTICE}</p>

      <section aria-label="Resumen" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={<ClipboardList className="h-4 w-4" aria-hidden />} label="Ventas registradas" value={String(filtered.length)} hint={`${active.length} activas`} />
          <Kpi icon={<Users className="h-4 w-4" aria-hidden />} label="Viajeros externos" value={String(travelersActive)} hint="En ventas activas" />
          {[...totals].slice(0, 1).map(([c, t]) => <Kpi key={c} icon={<Banknote className="h-4 w-4" aria-hidden />} label={`Vendido (${c})`} value={money(t.total, c)} />)}
          {[...totals].slice(0, 1).map(([c, t]) => <Kpi key={c + 'p'} icon={<HandCoins className="h-4 w-4" aria-hidden />} label={`Por cobrar (${c})`} value={money(t.pending, c)} hint={`Cobrado ${money(t.paid, c)}`} />)}
          {!totals.size && <Kpi icon={<Wallet className="h-4 w-4" aria-hidden />} label="Importes" value="—" hint="Sin ventas con importe" />}
        </div>
        {[...totals].map(([c, t]) => {
          const pct = t.total > 0 ? Math.min(100, Math.round((t.paid / t.total) * 100)) : 0;
          return (
            <div key={c} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-800">{c}</span>
                <span className="text-slate-600">Total <strong className="tabular-nums text-slate-900">{money(t.total, c)}</strong> · Cobrado <strong className="tabular-nums text-emerald-700">{money(t.paid, c)}</strong> · Pendiente <strong className="tabular-nums text-amber-700">{money(t.pending, c)}</strong></span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${pct}% cobrado`}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1 text-xs text-slate-500">{pct}% cobrado · importes de ventas activas dentro del filtro; cada moneda por separado</div>
            </div>
          );
        })}
        {channelCounts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">{channelCounts.map(([k, v, n]) => <span key={k} className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">{v} <strong className="text-slate-900">{n}</strong></span>)}</div>
        )}
      </section>

      <section aria-label="Filtros" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs font-medium text-slate-500">Desde<input type="date" className={`mt-1 block w-full ${control}`} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs font-medium text-slate-500">Hasta<input type="date" className={`mt-1 block w-full ${control}`} value={to} onChange={e => setTo(e.target.value)} /></label>
          <label className="col-span-2 text-xs font-medium text-slate-500 md:col-span-1">Tour<select className={`mt-1 block w-full ${control}`} value={tour} onChange={e => setTour(e.target.value)}><option value="">Todos</option>{[...names].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-500">Canal<select className={`mt-1 block w-full ${control}`} value={channel} onChange={e => setChannel(e.target.value)}><option value="">Todos</option>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-500">Estado<select className={`mt-1 block w-full ${control}`} value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option><option value="active">Activas</option><option value="cancelled">Canceladas</option></select></label>
          <label className="text-xs font-medium text-slate-500">Cobro<select className={`mt-1 block w-full ${control}`} value={payment} onChange={e => setPayment(e.target.value)}><option value="">Todos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></label>
        </div>
        {hasFilters && <button type="button" onClick={clearFilters} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline"><FilterX className="h-4 w-4" aria-hidden />Quitar filtros</button>}
      </section>

      {(message || sales.error || operations.error) && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-200">{message || errorText(sales.error ?? operations.error)}</p>}

      {qr && (
        <section aria-label="QR de check-in" className="flex flex-wrap items-center gap-5 rounded-2xl border border-blue-200 bg-white p-5">
          <QRCodeSVG className="sentry-block shrink-0" value={qr.url} size={160} />
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-base font-bold text-slate-900">QR de check-in · {qr.sale.primary_traveler_name}</h2>
            <p className="text-sm text-slate-600">Este QR identifica al grupo. Al generar otro, el anterior deja de funcionar.</p>
            <div className="flex flex-wrap gap-3">
              <a className="sentry-block inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline" href={qr.url}>Abrir check-in</a>
              <button className={actionBtn} onClick={() => setQr(null)}>Cerrar QR</button>
            </div>
          </div>
        </section>
      )}

      {sales.isPending ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(s => {
            const f = s.external_sale_financials;
            const cancelled = s.status !== 'active';
            const day = parseDay(s.departure_date);
            const pending = f ? Number(f.amount_pending) : 0;
            return (
              <li key={s.id} className={'rounded-2xl border bg-white p-4 shadow-sm ' + (cancelled ? 'border-slate-200 opacity-70' : 'border-slate-200')}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="w-16 shrink-0 rounded-xl bg-slate-100 py-2 text-center">
                    <div className="text-xl font-bold leading-none text-slate-900">{format(day, 'd')}</div>
                    <div className="text-[11px] font-medium uppercase text-slate-500">{format(day, 'MMM', { locale: es })}</div>
                    <div className="mt-0.5 text-xs text-slate-600">{time5(s.departure_time)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <OriginBadge origin="Externa" />
                      <span className={'rounded-full px-2.5 py-0.5 text-xs font-semibold ' + (cancelled ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800')}>{cancelled ? 'Cancelada' : 'Activa'}</span>
                    </div>
                    <div className="mt-1 truncate font-semibold text-slate-900">{names.get(s.tour_id) ?? 'Tour'}</div>
                    <div className="text-sm text-slate-600">{s.primary_traveler_name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{s.travelers_count} {s.travelers_count === 1 ? 'viajero' : 'viajeros'}</span>
                      <span>{CHANNELS[s.source] ?? s.source}</span>
                      {s.external_reference && <span className="font-mono">Ref. {s.external_reference}</span>}
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
                    {f ? (
                      <>
                        <Stat label="Total" value={money(Number(f.total_sale_amount), f.currency)} />
                        <Stat label="Pagado" value={money(Number(f.amount_paid), f.currency)} tone="text-emerald-700" />
                        {pending > 0
                          ? <Stat label="Pendiente" value={money(pending, f.currency)} tone="text-amber-700" />
                          : <span className="self-end rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Liquidada</span>}
                      </>
                    ) : <span className="text-sm text-slate-400">Importes privados</span>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Link className={actionBtn} to={'/agency/agenda?tour=' + s.tour_id + (s.slot_id ? '&slot=' + s.slot_id : '')}><ClipboardList className="h-4 w-4" aria-hidden />Asistentes / check-in</Link>
                  {s.status === 'active' && canManage && (
                    <>
                      <button disabled={busy} className={actionBtn} onClick={() => setForm(s)}><Pencil className="h-4 w-4" aria-hidden />Editar</button>
                      <button disabled={busy} className={actionBtn} onClick={() => void run(() => showQr(s))}><QrCode className="h-4 w-4" aria-hidden />Generar QR</button>
                      <button disabled={busy || !s.primary_traveler_email || !s.operational_email_authorized} title={!s.primary_traveler_email ? 'Falta el correo del viajero' : !s.operational_email_authorized ? 'Falta la autorización de correo operativo' : undefined} className={actionBtn} onClick={() => void run(() => sendQr(s))}><Mail className="h-4 w-4" aria-hidden />Enviar QR por correo</button>
                      <button disabled={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40" onClick={() => { const reason = window.prompt('Motivo de cancelación (se conservará el historial)'); if (reason) void run(() => cancelExternalSale(s, reason)); }}><XCircle className="h-4 w-4" aria-hidden />Cancelar</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!sales.isPending && !filtered.length && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
          <p className="mt-3 font-semibold text-slate-800">{hasFilters ? 'Ninguna venta coincide con los filtros' : 'No hay ventas externas en este periodo'}</p>
          <p className="text-sm text-slate-500">{hasFilters ? 'Quita algún filtro o amplía las fechas.' : canManage ? 'Registra una venta hecha fuera de ToursRed para llevar su control y ocupar su lugar en la salida.' : 'Cuando se registren ventas externas aparecerán aquí.'}</p>
        </div>
      )}

      {form && <ExternalSaleForm key={form === 'new' ? 'new' : form.id} operations={operations.data ?? []} existing={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={(id, warning) => { setForm(null); const extra = warning ? ' ' + warning : ''; setMessage('Venta externa guardada. Ya puedes generar o enviar el QR de check-in.' + extra); void run(async () => { await sales.refetch(); const s = (await loadExternalSales(agencyId!, from, to)).find(s => s.id === id); if (s) setMessage('Venta externa guardada. Genera o envía su QR desde la tarjeta de la venta.' + extra); }); }} />}
    </main>
  );
}
