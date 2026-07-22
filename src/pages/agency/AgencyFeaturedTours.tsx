import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Sparkles, Eye, MousePointerClick, ShoppingBag, TrendingUp,
  Calendar, Clock, ChevronDown, ChevronUp, ArrowRight, RefreshCw,
  Star, AlertTriangle, CheckCircle, XCircle
} from 'lucide-react';
import { getAgencyFeaturedSlots } from '../../lib/supabase';
import { useAgencyId } from '../../hooks/useAgencyId';
import { format, differenceInDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface FeaturedSlot {
  id: string;
  tour_id: string;
  plan_id: string;
  status: 'pending_payment' | 'active' | 'expired' | 'cancelled';
  starts_at: string;
  expires_at: string;
  total_amount: number;
  payment_provider: string | null;
  payment_confirmed_at: string | null;
  created_at: string;
  featured_plans: { id: string; name: string; duration_days: number; price: number } | null;
  featured_tour_stats: { impressions: number; clicks: number; bookings_generated: number } | { impressions: number; clicks: number; bookings_generated: number }[] | null;
  tours: { id: string; name: string; destination: string; image_url: string } | null;
}

const resolveStats = (raw: FeaturedSlot['featured_tour_stats']) => {
  if (!raw) return { impressions: 0, clicks: 0, bookings_generated: 0 };
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return { impressions: 0, clicks: 0, bookings_generated: 0 };
  return {
    impressions: s.impressions ?? 0,
    clicks: s.clicks ?? 0,
    bookings_generated: s.bookings_generated ?? 0,
  };
};

const StatusBadge: React.FC<{ status: FeaturedSlot['status'] }> = ({ status }) => {
  const map = {
    active: { label: 'Activo', cls: 'bg-green-100 text-green-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
    expired: { label: 'Vencido', cls: 'bg-gray-100 text-gray-600', icon: <XCircle className="h-3.5 w-3.5" /> },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-600', icon: <XCircle className="h-3.5 w-3.5" /> },
    pending_payment: { label: 'Pago Pendiente', cls: 'bg-yellow-100 text-yellow-700', icon: <Clock className="h-3.5 w-3.5" /> },
  };
  const { label, cls, icon } = map[status] ?? map.pending_payment;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
};

const FunnelChart: React.FC<{ impressions: number; clicks: number; bookings: number }> = ({
  impressions, clicks, bookings
}) => {
  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : '0.0';
  const cvr = clicks > 0 ? ((bookings / clicks) * 100).toFixed(1) : '0.0';
  const stages = [
    { label: 'Impresiones', value: impressions, color: 'bg-blue-500', width: 100 },
    { label: 'Clics', value: clicks, color: 'bg-amber-500', width: impressions > 0 ? Math.max(8, (clicks / impressions) * 100) : 8 },
    { label: 'Reservas', value: bookings, color: 'bg-green-500', width: impressions > 0 ? Math.max(4, (bookings / impressions) * 100) : 4 },
  ];

  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={s.label}>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{s.label}</span>
            <span className="font-semibold text-gray-800">{s.value.toLocaleString()}</span>
          </div>
          <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${s.color} rounded-full transition-all duration-700`}
              style={{ width: `${s.width}%` }}
            />
          </div>
          {i === 0 && (
            <div className="text-right text-xs text-gray-400 mt-0.5">CTR: {ctr}%</div>
          )}
          {i === 1 && (
            <div className="text-right text-xs text-gray-400 mt-0.5">Conversión: {cvr}%</div>
          )}
        </div>
      ))}
    </div>
  );
};

const DaysProgress: React.FC<{ startsAt: string; expiresAt: string }> = ({ startsAt, expiresAt }) => {
  const now = new Date();
  const start = parseISO(startsAt);
  const end = parseISO(expiresAt);
  const total = differenceInDays(end, start) || 1;
  const elapsed = Math.max(0, differenceInDays(now, start));
  const remaining = Math.max(0, differenceInDays(end, now));
  const pct = Math.min(100, (elapsed / total) * 100);

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Dias transcurridos: {elapsed}</span>
        <span className="font-semibold text-amber-700">{remaining} dias restantes</span>
      </div>
      <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const ActiveSlotCard: React.FC<{ slot: FeaturedSlot }> = ({ slot }) => {
  const stats = resolveStats(slot.featured_tour_stats);
  const plan = slot.featured_plans;
  const tour = slot.tours;
  const remaining = differenceInDays(parseISO(slot.expires_at), new Date());

  const kpis = [
    { label: 'Impresiones', value: stats.impressions, icon: <Eye className="h-5 w-5 text-blue-500" />, color: 'text-blue-700' },
    { label: 'Clics', value: stats.clicks, icon: <MousePointerClick className="h-5 w-5 text-amber-500" />, color: 'text-amber-700' },
    { label: 'Reservas', value: stats.bookings_generated, icon: <ShoppingBag className="h-5 w-5 text-green-500" />, color: 'text-green-700' },
  ];

  const ctr = stats.impressions > 0 ? ((stats.clicks / stats.impressions) * 100).toFixed(1) : '0.0';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
      {/* Tour image strip */}
      <div className="relative h-36 overflow-hidden">
        {tour?.image_url ? (
          <img src={tour.image_url} alt={tour.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-amber-400 to-orange-500" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-4">
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">{tour?.name}</h3>
            <p className="text-white/80 text-sm">{tour?.destination}</p>
          </div>
        </div>
        <div className="absolute top-3 right-3">
          <span className="inline-flex items-center gap-1 bg-amber-400 text-amber-900 text-xs font-bold px-2.5 py-1 rounded-full shadow">
            <Star className="h-3.5 w-3.5 fill-amber-800" />
            DESTACADO
          </span>
        </div>
        {remaining <= 5 && remaining > 0 && (
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5" /> {remaining}d restantes
            </span>
          </div>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Plan & dates */}
        <div className="flex flex-wrap gap-3 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="font-medium">{plan?.name}</span>
            <span className="text-gray-400">({plan?.duration_days} dias)</span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Calendar className="h-4 w-4 text-gray-400" />
            <span>
              {format(parseISO(slot.starts_at), 'd MMM', { locale: es })} –{' '}
              {format(parseISO(slot.expires_at), 'd MMM yyyy', { locale: es })}
            </span>
          </div>
        </div>

        {/* Days progress */}
        <DaysProgress startsAt={slot.starts_at} expiresAt={slot.expires_at} />

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-3">
          {kpis.map(kpi => (
            <div key={kpi.label} className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="flex justify-center mb-1">{kpi.icon}</div>
              <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Conversion rate */}
        <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-blue-700 font-medium">
            <TrendingUp className="h-4 w-4" />
            Tasa de Clic (CTR)
          </span>
          <span className="font-bold text-blue-800">{ctr}%</span>
        </div>

        {/* Funnel chart */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Embudo de Conversion</h4>
          <FunnelChart
            impressions={stats.impressions}
            clicks={stats.clicks}
            bookings={stats.bookings_generated}
          />
        </div>

        {/* Motivational message */}
        {stats.impressions === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Tu tour destacado esta activo. Las estadisticas comenzaran a aparecer cuando los viajeros lo vean en la plataforma.
          </div>
        )}
        {stats.impressions > 0 && stats.clicks === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Tu tour ha sido visto {stats.impressions} veces. Asegurate de que las fotos y descripcion sean atractivas para aumentar los clics.
          </div>
        )}
        {stats.impressions > 20 && stats.bookings_generated === 0 && parseFloat(ctr) < 5 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
            Tienes buena visibilidad. Considera mejorar el titulo, precio o agregar mas fotos para convertir esas visitas en reservas.
          </div>
        )}
        {stats.bookings_generated > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-start gap-2">
            <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
            <span>Excelente! Has generado <strong>{stats.bookings_generated}</strong> reserva{stats.bookings_generated !== 1 ? 's' : ''} gracias a destacar este tour. Considera renovar para mantener el impulso.</span>
          </div>
        )}

        {/* Renew CTA */}
        {remaining <= 7 && (
          <Link
            to="/agency/tours"
            className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Renovar Destacado
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
};

const HistoryRow: React.FC<{ slot: FeaturedSlot; isExpanded: boolean; onToggle: () => void }> = ({
  slot, isExpanded, onToggle
}) => {
  const stats = resolveStats(slot.featured_tour_stats);
  const plan = slot.featured_plans;
  const tour = slot.tours;
  const ctr = stats.impressions > 0 ? ((stats.clicks / stats.impressions) * 100).toFixed(1) : '-';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left"
      >
        {tour?.image_url ? (
          <img src={tour.image_url} alt={tour.name} className="h-12 w-16 object-cover rounded-lg shrink-0" />
        ) : (
          <div className="h-12 w-16 bg-gray-200 rounded-lg shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">{tour?.name}</div>
          <div className="text-xs text-gray-500">
            {plan?.name} — {format(parseISO(slot.starts_at), 'd MMM yyyy', { locale: es })} a{' '}
            {format(parseISO(slot.expires_at), 'd MMM yyyy', { locale: es })}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge status={slot.status} />
          <div className="text-xs text-gray-400 hidden sm:block">{formatCurrencyMXN(slot.total_amount)}</div>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 p-4 bg-gray-50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Impresiones', value: stats.impressions.toLocaleString() },
              { label: 'Clics', value: stats.clicks.toLocaleString() },
              { label: 'Reservas', value: stats.bookings_generated.toLocaleString() },
              { label: 'CTR', value: `${ctr}%` },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white rounded-lg p-3 text-center border border-gray-200">
                <div className="text-lg font-bold text-gray-800">{kpi.value}</div>
                <div className="text-xs text-gray-500">{kpi.label}</div>
              </div>
            ))}
          </div>
          <Link
            to="/agency/tours"
            className="inline-flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
          >
            <Sparkles className="h-4 w-4" />
            Destacar de nuevo este tour
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
};

const AgencyFeaturedTours: React.FC = () => {
  const { agencyId } = useAgencyId();
  const navigate = useNavigate();
  const [slots, setSlots] = useState<FeaturedSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!agencyId) return;
    loadSlots();
  }, [agencyId]);

  const loadSlots = async () => {
    if (!agencyId) return;
    setIsLoading(true);
    const { data } = await getAgencyFeaturedSlots(agencyId);
    setSlots((data as FeaturedSlot[]) ?? []);
    setIsLoading(false);
  };

  const activeSlots = slots.filter(s => s.status === 'active');
  const historySlots = slots.filter(s => s.status !== 'active' && s.status !== 'pending_payment');

  const totalImpressions = activeSlots.reduce((a, s) => a + resolveStats(s.featured_tour_stats).impressions, 0);
  const totalClicks = activeSlots.reduce((a, s) => a + resolveStats(s.featured_tour_stats).clicks, 0);
  const totalBookings = activeSlots.reduce((a, s) => a + resolveStats(s.featured_tour_stats).bookings_generated, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-amber-500" />
              Mis Tours Destacados
            </h1>
            <p className="text-gray-500 text-sm mt-1">Seguimiento de visibilidad y rendimiento de tus inversiones en destacados</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadSlots}
              disabled={isLoading}
              className="inline-flex items-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium px-3 py-2.5 rounded-xl text-sm transition-colors"
              title="Actualizar estadísticas"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
            <Link
              to="/agency/tours"
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Destacar Nuevo Tour
            </Link>
          </div>
        </div>

        {/* Summary KPIs (only when has active slots) */}
        {activeSlots.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Tours Activos', value: activeSlots.length, icon: <Star className="h-5 w-5 text-amber-500 fill-amber-400" />, color: 'text-amber-700' },
              { label: 'Impresiones Totales', value: totalImpressions.toLocaleString(), icon: <Eye className="h-5 w-5 text-blue-500" />, color: 'text-blue-700' },
              { label: 'Clics Totales', value: totalClicks.toLocaleString(), icon: <MousePointerClick className="h-5 w-5 text-violet-500" />, color: 'text-violet-700' },
              { label: 'Reservas Generadas', value: totalBookings.toLocaleString(), icon: <ShoppingBag className="h-5 w-5 text-green-500" />, color: 'text-green-700' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col items-center text-center shadow-sm">
                {kpi.icon}
                <div className={`text-2xl font-bold mt-2 ${kpi.color}`}>{kpi.value}</div>
                <div className="text-xs text-gray-500 mt-1">{kpi.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Active slots */}
        {activeSlots.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Destacados Activos
              <span className="ml-1 text-sm font-normal text-gray-500">({activeSlots.length})</span>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {activeSlots.map(slot => (
                <ActiveSlotCard key={slot.id} slot={slot} />
              ))}
            </div>
          </section>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-amber-300 p-10 text-center">
            <Sparkles className="h-12 w-12 text-amber-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Sin tours destacados activos</h3>
            <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
              Destaca un tour para aparecer primero en busquedas y en la seccion de inicio. Mas visibilidad = mas reservas.
            </p>
            <Link
              to="/agency/tours"
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Destacar un Tour
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* History */}
        {historySlots.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-gray-400" />
              Historial
              <span className="ml-1 text-sm font-normal text-gray-500">({historySlots.length})</span>
            </h2>
            <div className="space-y-3">
              {historySlots.map(slot => (
                <HistoryRow
                  key={slot.id}
                  slot={slot}
                  isExpanded={!!expandedHistory[slot.id]}
                  onToggle={() => setExpandedHistory(p => ({ ...p, [slot.id]: !p[slot.id] }))}
                />
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
};

export default AgencyFeaturedTours;
