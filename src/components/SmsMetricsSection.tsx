import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Metrics {
  period: string;
  messages: { category: string; status: string; country_code: string; total: number }[];
  attempts: { provider: string; status: string; country_code: string; is_simulated: boolean; total: number; segments: number; fallback: number; retries: number; known_cost: number | null; cost_unit: string | null }[];
  otp: { requested: number; verified: number; simulated: number; invalid: number };
  consumption: { scope: string; window_start: string; segments: number }[];
  health: { provider: string; balance_credits: number | null; balance_checked_at: string | null; last_worker_at: string | null }[];
  alerts: { code: string; last_seen_at: string; occurrences: number }[];
}

const labels: Record<string, string> = {
  queue_error: 'Error al preparar una notificación',
  missing_schedule: 'Salidas sin hora o zona horaria inequívoca',
  low_balance: 'Saldo bajo del proveedor',
  provider_unavailable: 'No se pudo consultar al proveedor',
  repeated_errors: 'Errores de envío reiterados',
  unknown_results: 'Envíos con resultado desconocido: no reenviar a ciegas',
  consumption_high: 'Consumo cercano al límite diario',
  otp_abuse: 'Límite de solicitudes OTP alcanzado',
  worker_stale: 'El procesador no ha reportado actividad reciente',
};

const th = 'text-left py-2 pr-4 font-medium text-gray-700';
const td = 'py-2 pr-4 text-gray-800';

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export function SmsMetricsSection() {
  const query = useQuery({
    queryKey: ['sms-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sms_metrics');
      if (error) throw error;
      return data as Metrics;
    },
    refetchInterval: 30000,
    retry: false,
  });

  if (query.isPending) return <div className="bg-white rounded-lg shadow-md p-6"><p role="status" className="text-sm text-gray-500">Cargando actividad SMS…</p></div>;
  if (query.isError || !query.data) {
    return (
      <section className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p role="alert">No se pudo consultar la actividad SMS.</p>
        </div>
        <button type="button" onClick={() => void query.refetch()} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700">Reintentar</button>
      </section>
    );
  }

  const m = query.data;
  return (
    <section className="bg-white rounded-lg shadow-md p-6" aria-label="Actividad y alertas SMS">
      <div className="flex items-center gap-x-3 mb-2">
        <Activity className="w-6 h-6 text-primary-600" />
        <h2 className="text-xl font-semibold text-gray-900">Actividad SMS · últimos 30 días</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">Métricas de mensajería independientes de ventas, comisiones y contabilidad. Aceptado por el proveedor no significa entregado.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="OTP reales solicitados" value={m.otp.requested} />
        <Kpi label="Verificados" value={m.otp.verified} />
        <Kpi label="Conversión por desafío" value={m.otp.requested ? `${(100 * m.otp.verified / m.otp.requested).toFixed(1)}%` : '—'} />
        <Kpi label="OTP simulados" value={m.otp.simulated} />
      </div>

      {m.alerts.length > 0 && (
        <ul className="space-y-2 rounded-md bg-amber-50 border border-amber-200 p-4 mb-5 text-sm text-amber-800" aria-label="Alertas operativas">
          {m.alerts.map(a => <li key={a.code}>{labels[a.code] ?? a.code} · {new Date(a.last_seen_at).toLocaleString()}</li>)}
        </ul>
      )}

      <h3 className="text-sm font-semibold text-gray-800 mb-2">Mensajes lógicos</h3>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200"><th className={th}>Categoría</th><th className={th}>Estado</th><th className={th}>País</th><th className={th}>Total</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {m.messages.length === 0 && <tr><td colSpan={4} className="py-3 text-gray-500">Sin mensajes en el periodo.</td></tr>}
            {m.messages.map((r, i) => (
              <tr key={i}><td className={td}>{r.category === 'reserva_confirmada' ? 'Confirmación' : 'Recordatorio'}</td><td className={td}>{r.status}</td><td className={td}>{r.country_code === 'ZZ' ? 'Por determinar' : r.country_code}</td><td className={td}>{r.total}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold text-gray-800 mb-2">Intentos por proveedor y país</h3>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200"><th className={th}>Proveedor</th><th className={th}>Estado</th><th className={th}>País</th><th className={th}>Modo</th><th className={th}>Intentos</th><th className={th}>Segmentos</th><th className={th}>Respaldo</th><th className={th}>Reintentos</th><th className={th}>Costo conocido</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {m.attempts.length === 0 && <tr><td colSpan={9} className="py-3 text-gray-500">Sin intentos en el periodo.</td></tr>}
            {m.attempts.map((a, i) => (
              <tr key={i}><td className={td}>{a.provider}</td><td className={td}>{a.status}</td><td className={td}>{a.country_code}</td><td className={td}>{a.is_simulated ? 'Simulado' : 'Real'}</td><td className={td}>{a.total}</td><td className={td}>{a.segments}</td><td className={td}>{a.fallback}</td><td className={td}>{a.retries}</td><td className={td}>{a.known_cost == null ? 'No informado' : `${a.known_cost} ${a.cost_unit ?? ''}`}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Cuota consumida: {m.consumption.length ? m.consumption.map(c => `${c.scope === 'sms_daily' ? 'Diaria' : 'Mensual'}: ${c.segments} segmentos`).join(' · ') : 'Sin consumo registrado'}. La cuota reserva intentos reales; no equivale a un costo facturado.
      </p>
      {m.health.map(h => (
        <p key={h.provider} className="mt-1 text-xs text-gray-500">
          {h.provider}: {h.balance_credits == null ? 'saldo no disponible' : `${h.balance_credits} créditos`} {h.balance_checked_at && `· consultado ${new Date(h.balance_checked_at).toLocaleString()}`}.
        </p>
      ))}
    </section>
  );
}
