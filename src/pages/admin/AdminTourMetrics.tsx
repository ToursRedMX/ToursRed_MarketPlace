import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart2, Search, ChevronDown, Users,
  Calendar, Building2, MapPin, Clock, TrendingUp, RefreshCw,
  ShoppingBag, CheckCircle, XCircle, AlertTriangle, Package,
  Shield
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourMetricRow {
  id: string;
  name: string;
  destination: string;
  tour_type: 'excursion' | 'receptivo';
  start_date: string | null;
  end_date: string | null;
  max_travelers: number | null;
  default_slot_capacity: number | null;
  agency_id: string;
  agencies: { id: string; name: string } | null;
  // aggregates loaded via separate queries
  bookings_total: number;
  bookings_confirmed: number;
  bookings_pending: number;
  bookings_cancelled: number;
  bookings_no_show: number;
  travelers_total: number;
  revenue_total: number;
  platform_revenue_total: number;
  commission_total: number;
  insurance_total: number;
}

interface BookingDetail {
  id: string;
  booking_code: string | null;
  status: string;
  payment_status: string;
  total_price: number;
  platform_revenue: number;
  commission_amount: number;
  travel_insurance_included: boolean;
  travel_insurance_cost: number;
  travelers_count: number;
  count_adultos: number;
  count_ninos: number;
  count_infantes: number;
  count_adultos_mayores: number;
  count_mascotas: number;
  created_at: string;
  booking_date: string | null;
  is_no_show: boolean;
  users: { first_name: string; last_name: string; email: string | null } | null;
}

interface SlotDetail {
  id: string;
  slot_date: string;
  departure_time: string | null;
  capacity: number;
  booked_count: number;
  status: string;
}

interface TourDetail {
  bookings: BookingDetail[];
  slots: SlotDetail[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const statusColor: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
  draft: 'bg-gray-100 text-gray-500',
  no_show: 'bg-orange-100 text-orange-700',
};

const statusLabel: Record<string, string> = {
  confirmed: 'Confirmada',
  pending: 'Pendiente',
  cancelled: 'Cancelada',
  completed: 'Completada',
  draft: 'Borrador',
  no_show: 'No-show',
};

const formatDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function occupancyColor(pct: number) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-green-500';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
  accent?: string;
}> = ({ label, value, icon, sub, accent = 'text-blue-600' }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
    <div className={`p-2.5 rounded-lg bg-gray-50 ${accent}`}>{icon}</div>
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[status] ?? 'bg-gray-100 text-gray-600'}`}>
    {statusLabel[status] ?? status}
  </span>
);

const paymentColor: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-700',
  processing: 'bg-yellow-100 text-yellow-700',
  canceled: 'bg-red-100 text-red-700',
};

const paymentLabel: Record<string, string> = {
  succeeded: 'Pagado',
  processing: 'Procesando',
  canceled: 'Cancelado',
};

const PaymentBadge: React.FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${paymentColor[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {paymentLabel[status] ?? status}
    </span>
  );
};

// ─── Detail panel ─────────────────────────────────────────────────────────────

const TourDetailPanel: React.FC<{
  tour: TourMetricRow;
  detail: TourDetail | null;
  isLoading: boolean;
}> = ({ tour, detail, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <RefreshCw className="animate-spin mr-2" size={18} />
        Cargando detalle...
      </div>
    );
  }
  if (!detail) return null;

  const { bookings, slots } = detail;

  const byStatus = bookings.reduce<Record<string, number>>((acc, b) => {
    if (b.is_no_show) { acc['no_show'] = (acc['no_show'] ?? 0) + 1; return acc; }
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  const travelersBreakdown = bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'draft')
    .reduce(
      (acc, b) => ({
        adultos: acc.adultos + b.count_adultos,
        ninos: acc.ninos + b.count_ninos,
        infantes: acc.infantes + b.count_infantes,
        adultos_mayores: acc.adultos_mayores + b.count_adultos_mayores,
        mascotas: acc.mascotas + b.count_mascotas,
      }),
      { adultos: 0, ninos: 0, infantes: 0, adultos_mayores: 0, mascotas: 0 }
    );

  const activeBookings = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'draft');
  const grossRevenue = activeBookings.reduce((s, b) => s + b.total_price, 0);
  const platformRevenue = activeBookings.reduce((s, b) => s + b.platform_revenue, 0);
  const agencyCommission = activeBookings.reduce((s, b) => s + b.commission_amount, 0);
  const insuranceTotal = activeBookings.reduce((s, b) => s + (b.travel_insurance_included ? (b.travel_insurance_cost ?? 0) : 0), 0);

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-6 py-5 space-y-6">

      {/* ── Finanzas ── */}
      <section>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Resumen Financiero</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Ingresos Brutos</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrencyMXN(grossRevenue)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Comision Agencia</p>
            <p className="text-lg font-bold text-blue-700 mt-1">{formatCurrencyMXN(agencyCommission)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Ingreso Plataforma</p>
            <p className="text-lg font-bold text-green-700 mt-1">{formatCurrencyMXN(platformRevenue)}</p>
          </div>
          {insuranceTotal > 0 && (
            <div className="bg-white rounded-lg border border-emerald-200 p-4">
              <p className="text-xs text-emerald-600 flex items-center gap-1"><Shield size={11} /> Seguros de Viaje</p>
              <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrencyMXN(insuranceTotal)}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Reservas por estado ── */}
      <section>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Reservas por Estado</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([st, count]) => (
            <span key={st} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${statusColor[st] ?? 'bg-gray-100 text-gray-600'}`}>
              {statusLabel[st] ?? st}
              <span className="bg-white/60 rounded-md px-1.5 py-0.5 text-xs font-bold">{count}</span>
            </span>
          ))}
          {Object.keys(byStatus).length === 0 && (
            <p className="text-sm text-gray-400">Sin reservas aun</p>
          )}
        </div>
      </section>

      {/* ── Viajeros por categoria ── */}
      <section>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Viajeros por Categoria (reservas activas)</h4>
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Adultos', val: travelersBreakdown.adultos },
            { label: 'Ninos', val: travelersBreakdown.ninos },
            { label: 'Infantes', val: travelersBreakdown.infantes },
            { label: 'Ad. Mayores', val: travelersBreakdown.adultos_mayores },
            { label: 'Mascotas', val: travelersBreakdown.mascotas },
          ].map(({ label, val }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-center min-w-[90px]">
              <p className="text-2xl font-bold text-gray-900">{val}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Slots (solo receptivos) ── */}
      {tour.tour_type === 'receptivo' && (
        <section>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Proximas Salidas</h4>
          {slots.length === 0 ? (
            <p className="text-sm text-gray-400">Sin salidas programadas</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Fecha</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Hora</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Reservados</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Capacidad</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Ocupacion</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {slots.slice(0, 15).map(slot => {
                    const pct = slot.capacity > 0 ? Math.round((slot.booked_count / slot.capacity) * 100) : 0;
                    return (
                      <tr key={slot.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700">{formatDate(slot.slot_date)}</td>
                        <td className="px-3 py-2 text-gray-500">{slot.departure_time ?? '—'}</td>
                        <td className="px-3 py-2 text-center font-medium text-gray-900">{slot.booked_count}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{slot.capacity}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                              <div className={`h-1.5 rounded-full ${occupancyColor(pct)}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 w-8">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            slot.status === 'activo' ? 'bg-green-100 text-green-700' :
                            slot.status === 'lleno' ? 'bg-red-100 text-red-700' :
                            slot.status === 'cancelado' ? 'bg-gray-100 text-gray-500' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{slot.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Ultimas reservas ── */}
      <section>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ultimas Reservas</h4>
        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">Sin reservas</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Codigo</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Viajero</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Estado</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Pago</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Personas</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Plataforma</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-emerald-600">Seguro</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Fecha</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {bookings.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{b.booking_code ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {b.users ? `${b.users.first_name} ${b.users.last_name}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={b.is_no_show ? 'no_show' : b.status} />
                    </td>
                    <td className="px-3 py-2">
                      <PaymentBadge status={b.payment_status} />
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700">{b.travelers_count}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrencyMXN(b.total_price)}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-medium">{formatCurrencyMXN(b.platform_revenue)}</td>
                    <td className="px-3 py-2 text-right">
                      {b.travel_insurance_included && b.travel_insurance_cost > 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium text-xs">
                          <Shield size={11} />{formatCurrencyMXN(b.travel_insurance_cost)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDate(b.booking_date ?? b.created_at.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

// ─── Tour row ─────────────────────────────────────────────────────────────────

const TourRow: React.FC<{
  tour: TourMetricRow;
  isExpanded: boolean;
  onToggle: () => void;
  detail: TourDetail | null;
  isLoadingDetail: boolean;
}> = ({ tour, isExpanded, onToggle, detail, isLoadingDetail }) => {
  const capacity = tour.tour_type === 'excursion' ? (tour.max_travelers ?? 0) : 0;
  const occupancyPct = capacity > 0 ? Math.min(100, Math.round((tour.travelers_total / capacity) * 100)) : null;

  const isActive = !tour.end_date || tour.end_date >= TODAY;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow transition-shadow">
      {/* ── Header row ── */}
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start gap-4">
          {/* Tour info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm truncate">{tour.name}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                tour.tour_type === 'receptivo' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
              }`}>
                {tour.tour_type === 'receptivo' ? 'Receptivo' : 'Excursion'}
              </span>
              {!isActive && (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                  Pasado
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Building2 size={11} />
                {tour.agencies?.name ?? '—'}
              </span>
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {tour.destination}
              </span>
              {tour.start_date && (
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {formatDate(tour.start_date)}
                  {tour.end_date && tour.end_date !== tour.start_date && ` → ${formatDate(tour.end_date)}`}
                </span>
              )}
            </div>
          </div>

          {/* Metrics grid */}
          <div className="flex items-center gap-6 shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{tour.bookings_total}</p>
              <p className="text-xs text-gray-400">Reservas</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{tour.travelers_total}</p>
              <p className="text-xs text-gray-400">Viajeros</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{formatCurrencyMXN(tour.revenue_total)}</p>
              <p className="text-xs text-gray-400">Ingresos</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-700">{formatCurrencyMXN(tour.platform_revenue_total)}</p>
              <p className="text-xs text-gray-400">Plataforma</p>
            </div>
            {occupancyPct !== null && (
              <div className="text-center">
                <div className="flex items-center justify-center gap-1">
                  <div className="w-12 bg-gray-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${occupancyColor(occupancyPct)}`} style={{ width: `${occupancyPct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-600">{occupancyPct}%</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Ocupacion</p>
              </div>
            )}
            <div className={`transition-transform duration-200 text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown size={18} />
            </div>
          </div>
        </div>

        {/* Mini status bar */}
        {tour.bookings_total > 0 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {tour.bookings_confirmed > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                <CheckCircle size={11} /> {tour.bookings_confirmed} conf.
              </span>
            )}
            {tour.bookings_pending > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-yellow-600">
                <Clock size={11} /> {tour.bookings_pending} pend.
              </span>
            )}
            {tour.bookings_cancelled > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-red-500">
                <XCircle size={11} /> {tour.bookings_cancelled} canc.
              </span>
            )}
            {tour.bookings_no_show > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-orange-500">
                <AlertTriangle size={11} /> {tour.bookings_no_show} no-show
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expandible */}
      {isExpanded && (
        <TourDetailPanel tour={tour} detail={detail} isLoading={isLoadingDetail} />
      )}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

const AdminTourMetrics: React.FC = () => {
  const [tours, setTours] = useState<TourMetricRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'excursion' | 'receptivo'>('all');
  const [activeTab, setActiveTab] = useState<'active' | 'past'>('active');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TourDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  const fetchTours = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      // 1. Fetch all tours with agency join
      const { data: toursData, error: toursErr } = await supabase
        .from('tours')
        .select('id, name, destination, tour_type, start_date, end_date, max_travelers, default_slot_capacity, agency_id, agencies(id, name)')
        .order('name');

      if (toursErr) throw toursErr;

      const rawTours = (toursData ?? []) as Array<{
        id: string; name: string; destination: string; tour_type: 'excursion' | 'receptivo';
        start_date: string | null; end_date: string | null; max_travelers: number | null;
        default_slot_capacity: number | null; agency_id: string;
        agencies: { id: string; name: string } | null;
      }>;

      if (rawTours.length === 0) { setTours([]); return; }

      // 2. Fetch booking aggregates for all tours at once
      const { data: bookingsAgg, error: bookingsErr } = await supabase
        .from('bookings')
        .select('tour_id, status, is_no_show, travelers_count, total_price, platform_revenue, commission_amount, travel_insurance_cost, travel_insurance_included')
        .neq('status', 'draft')
        .in('tour_id', rawTours.map(t => t.id));

      if (bookingsErr) throw bookingsErr;

      // 3. Aggregate per tour
      const agg: Record<string, {
        total: number; confirmed: number; pending: number; cancelled: number; no_show: number;
        travelers: number; revenue: number; platform_revenue: number; commission: number; insurance: number;
      }> = {};

      for (const b of bookingsAgg ?? []) {
        if (!agg[b.tour_id]) {
          agg[b.tour_id] = { total: 0, confirmed: 0, pending: 0, cancelled: 0, no_show: 0, travelers: 0, revenue: 0, platform_revenue: 0, commission: 0, insurance: 0 };
        }
        const a = agg[b.tour_id];
        a.total++;
        if (b.is_no_show) { a.no_show++; }
        else if (b.status === 'confirmed') { a.confirmed++; }
        else if (b.status === 'pending') { a.pending++; }
        else if (b.status === 'cancelled') { a.cancelled++; }

        if (b.status !== 'cancelled') {
          a.travelers += b.travelers_count ?? 0;
          a.revenue += b.total_price ?? 0;
          a.platform_revenue += b.platform_revenue ?? 0;
          a.commission += b.commission_amount ?? 0;
          if (b.travel_insurance_included) {
            a.insurance += b.travel_insurance_cost ?? 0;
          }
        }
      }

      const rows: TourMetricRow[] = rawTours.map(t => ({
        ...t,
        bookings_total: agg[t.id]?.total ?? 0,
        bookings_confirmed: agg[t.id]?.confirmed ?? 0,
        bookings_pending: agg[t.id]?.pending ?? 0,
        bookings_cancelled: agg[t.id]?.cancelled ?? 0,
        bookings_no_show: agg[t.id]?.no_show ?? 0,
        travelers_total: agg[t.id]?.travelers ?? 0,
        revenue_total: agg[t.id]?.revenue ?? 0,
        platform_revenue_total: agg[t.id]?.platform_revenue ?? 0,
        commission_total: agg[t.id]?.commission ?? 0,
        insurance_total: agg[t.id]?.insurance ?? 0,
      }));

      setTours(rows);
    } catch (err: any) {
      setError(err.message ?? 'Error al cargar los datos');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (tourId: string, tourType: string) => {
    if (details[tourId]) return;
    setLoadingDetailId(tourId);
    try {
      const [bookingsRes, slotsRes] = await Promise.all([
        supabase
          .from('bookings')
          .select(`
            id, booking_code, status, payment_status, total_price, platform_revenue,
            commission_amount, travelers_count, count_adultos, count_ninos, count_infantes,
            count_adultos_mayores, count_mascotas, created_at, booking_date, is_no_show,
            travel_insurance_included, travel_insurance_cost,
            users!bookings_user_id_fkey(first_name, last_name, email)
          `)
          .eq('tour_id', tourId)
          .neq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(500),
        tourType === 'receptivo'
          ? supabase
              .from('tour_slots')
              .select('id, slot_date, departure_time, capacity, booked_count, status')
              .eq('tour_id', tourId)
              .gte('slot_date', TODAY)
              .order('slot_date', { ascending: true })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;
      if (slotsRes.error) throw slotsRes.error;

      setDetails(prev => ({
        ...prev,
        [tourId]: {
          bookings: (bookingsRes.data ?? []) as BookingDetail[],
          slots: (slotsRes.data ?? []) as SlotDetail[],
        },
      }));
    } catch (err: any) {
      console.error('Error al cargar detalle del tour:', err);
    } finally {
      setLoadingDetailId(null);
    }
  }, [details]);

  useEffect(() => {
    fetchTours();
  }, [fetchTours]);

  const handleToggle = (tour: TourMetricRow) => {
    if (expandedId === tour.id) {
      setExpandedId(null);
    } else {
      setExpandedId(tour.id);
      fetchDetail(tour.id, tour.tour_type);
    }
  };

  // ── Filter ──
  const isActive = (t: TourMetricRow) => !t.end_date || t.end_date >= TODAY;

  const filtered = tours.filter(t => {
    if (activeTab === 'active' && !isActive(t)) return false;
    if (activeTab === 'past' && isActive(t)) return false;
    if (filterType !== 'all' && t.tour_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) ||
        t.destination.toLowerCase().includes(q) ||
        (t.agencies?.name ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const activeTours = tours.filter(isActive);
  const pastTours = tours.filter(t => !isActive(t));

  // ── KPIs para la pestaña activa ──
  const kpiBase = filtered;
  const kpiBookings = kpiBase.reduce((s, t) => s + t.bookings_total, 0);
  const kpiTravelers = kpiBase.reduce((s, t) => s + t.travelers_total, 0);
  const kpiRevenue = kpiBase.reduce((s, t) => s + t.platform_revenue_total, 0);
  const kpiInsurance = kpiBase.reduce((s, t) => s + t.insurance_total, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart2 className="text-blue-600" size={26} />
              Metricas por Tour
            </h1>
            <p className="text-sm text-gray-500 mt-1">Analisis completo de reservas, viajeros e ingresos</p>
          </div>
          <button
            onClick={fetchTours}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          <KpiCard
            label="Tours en vista"
            value={String(filtered.length)}
            icon={<Package size={20} />}
            accent="text-blue-600"
          />
          <KpiCard
            label="Reservas totales"
            value={String(kpiBookings)}
            icon={<ShoppingBag size={20} />}
            accent="text-teal-600"
          />
          <KpiCard
            label="Viajeros totales"
            value={String(kpiTravelers)}
            icon={<Users size={20} />}
            accent="text-amber-600"
          />
          <KpiCard
            label="Ingreso plataforma"
            value={formatCurrencyMXN(kpiRevenue)}
            icon={<TrendingUp size={20} />}
            accent="text-green-600"
          />
          {kpiInsurance > 0 && (
            <KpiCard
              label="Total seguros"
              value={formatCurrencyMXN(kpiInsurance)}
              icon={<Shield size={20} />}
              accent="text-emerald-600"
              sub="Intermediacion aseguradora"
            />
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
          {([
            { key: 'active', label: 'Activos y Futuros', count: activeTours.length },
            { key: 'past', label: 'Tours Pasados', count: pastTours.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setExpandedId(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              <span className={`ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold ${
                activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar tour, agencia, destino..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value as typeof filterType)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos los tipos</option>
            <option value="excursion">Excursion</option>
            <option value="receptivo">Receptivo</option>
          </select>
        </div>

        {/* ── Tour list ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <RefreshCw className="animate-spin mr-2" size={20} />
            Cargando tours...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Package size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay tours en esta vista</p>
            {search && <p className="text-sm mt-1">Intenta con otra busqueda</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(tour => (
              <TourRow
                key={tour.id}
                tour={tour}
                isExpanded={expandedId === tour.id}
                onToggle={() => handleToggle(tour)}
                detail={details[tour.id] ?? null}
                isLoadingDetail={loadingDetailId === tour.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminTourMetrics;