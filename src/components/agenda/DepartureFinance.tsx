import { AlertTriangle, Banknote, Clock3, Handshake, HandCoins, Landmark } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import type { DepartureReservation } from '../../types/externalSales';
import { summarize } from './financeMath';

function Stat({ icon, label, value, hint, tone = 'text-slate-900' }: { icon: ReactNode; label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{formatCurrencyMXN(value)}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</div>}
    </div>
  );
}

export default function DepartureFinance({ rows }: { rows: DepartureReservation[] }) {
  const s = summarize(rows);
  return (
    <section aria-label="Dinero de la salida" className="space-y-3">
      <div className="grid gap-3 rounded-2xl bg-slate-900 p-4 text-white sm:grid-cols-3">
        <div><div className="text-xs text-slate-300">Venta total de la salida</div><div className="text-2xl font-bold tabular-nums">{formatCurrencyMXN(s.grandTotal)}</div></div>
        <div><div className="text-xs text-slate-300">Ya cobrado</div><div className="text-2xl font-bold tabular-nums text-emerald-300">{formatCurrencyMXN(s.grandCollected)}</div></div>
        <div><div className="text-xs text-slate-300">Falta por cobrar</div><div className="text-2xl font-bold tabular-nums text-amber-300">{formatCurrencyMXN(s.grandPending)}</div></div>
      </div>

      <div>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Landmark className="h-4 w-4 text-blue-600" aria-hidden /> Reservas por ToursRed</h4>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat icon={<Banknote className="h-3.5 w-3.5" aria-hidden />} label="Cobrado en la plataforma" value={s.t.collected} hint="Anticipos pagados por los viajeros" />
          <Stat icon={<Clock3 className="h-3.5 w-3.5" aria-hidden />} label="Pendiente de liberar" value={s.t.releasePending} hint="Tu parte neta, aún no liberada a tu cuenta" tone="text-blue-700" />
          <Stat icon={<Handshake className="h-3.5 w-3.5" aria-hidden />} label="Ya liberado" value={s.t.released} hint="Tu parte neta ya procesada" tone="text-emerald-700" />
          <Stat icon={<HandCoins className="h-3.5 w-3.5" aria-hidden />} label="Falta por cobrar" value={s.t.pending} hint="Saldo que el viajero paga directo a la agencia" tone="text-amber-700" />
        </div>
        {s.t.hasPlan && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Hay reservas con plan de pagos: sus cifras usan la regla estándar de anticipo y saldo, y pueden no reflejar las mensualidades.</p>
        )}
      </div>

      <div>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden /> Ventas externas <span className="font-normal text-slate-500">· control interno, sin comisión</span></h4>
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Banknote className="h-3.5 w-3.5" aria-hidden />} label="Vendido" value={s.e.total} />
          <Stat icon={<Handshake className="h-3.5 w-3.5" aria-hidden />} label="Cobrado" value={s.e.collected} tone="text-emerald-700" />
          <Stat icon={<HandCoins className="h-3.5 w-3.5" aria-hidden />} label="Por cobrar" value={s.e.pending} tone="text-amber-700" />
        </div>
        {s.foreignCurrency > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{s.foreignCurrency} venta(s) externa(s) están en otra moneda y no se suman a estos totales en pesos.</p>
        )}
      </div>
    </section>
  );
}
