import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingBag, Search, X, ChevronDown, ChevronUp, ChevronsUpDown,
  User, Building2, MapPin, Calendar, CreditCard, DollarSign,
  CheckCircle, Clock, XCircle, AlertTriangle, RefreshCw,
  Users, Star, Coins, Shield, FileText, ArrowLeftRight,
  Phone, Mail, Package, Percent, Hash, Tag, Info, Plus,
  TrendingUp, BarChart2, Activity, Upload, Ban, Loader2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { useAuth } from '../../context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingRow {
  id: string;
  booking_code: string | null;
  user_id: string;
  tour_id: string;
  agency_id: string;
  booking_date: string | null;
  created_at: string;
  updated_at: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  total_price: number;
  deposit_amount: number | null;
  user_payment: number;
  service_charge: number;
  platform_revenue: number;
  commission_amount: number;
  travelers_count: number;
  count_adultos: number;
  count_ninos: number;
  count_infantes: number;
  count_adultos_mayores: number;
  count_mascotas: number;
  approval_status: string | null;
  approval_notes: string | null;
  approved_at: string | null;
  is_no_show: boolean;
  no_show_marked_at: string | null;
  has_pending_reschedule: boolean;
  has_pending_slot_reschedule: boolean;
  slot_reschedule_response: string | null;
  reschedule_response: string | null;
  original_booking_date: string | null;
  selected_date: string | null;
  selected_time: string | null;
  paid_at: string | null;
  confirmation_email_sent: boolean;
  payment_intent_id: string | null;
  cancelled_at: string | null;
  cancellation_type: string | null;
  cancellation_refund_amount: number | null;
  toursred_cash_used: number;
  points_used: number;
  points_earned: number;
  used_membership_benefit: boolean;
  service_charge_discount: number;
  membership_service_fee_saved: number;
  preventa_comision_descuento: number;
  discount_amount: number;
  es_reserva_preventa: boolean;
  needs_seat_reselection: boolean;
  selected_seats: number[] | null;
  travel_insurance_included: boolean;
  travel_insurance_cost: number;
  insurance_email_sent: boolean;
  has_payment_plan: boolean;
  payment_plan_total: number | null;
  payment_plan_paid: number | null;
  payment_plan_status: string | null;
  selected_payment_mode: string | null;
  admin_cancellation_id: string | null;
  payment_plan?: {
    id: string;
    mode: string;
    total_plan_amount: number;
    total_amount_paid: number;
    status: string;
    installments: {
      id: string;
      installment_number: number;
      label: string;
      amount_due: number;
      amount_paid: number;
      due_date: string;
      status: string;
      paid_at: string | null;
    }[];
  } | null;
  // joined (estructura de la Edge Function)
  users: {
    first_name: string;
    last_name: string;
    email: string | null;
    profile_picture_url: string | null;
    phone_number: string | null;
    is_active: boolean;
    curp: string | null;
    rfc: string | null;
    razon_social: string | null;
    regimen_fiscal: string | null;
    uso_cfdi: string | null;
    is_foreign_traveler: boolean | null;
    passport_number: string | null;
  } | null;
  tours: {
    name: string;
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    image_url: string | null;
    price: number;
    deposit_percentage: number | null;
    booking_approval_type: string | null;
    category: string[] | null;
  } | null;
  agencies: {
    name: string;
    logo: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    commission_rate: number | null;
  } | null;
  commission_records: {
    id: string;
    agency_commission_rate: number | null;
    agency_commission_amount: number | null;
    service_charge_rate: number | null;
    service_charge_amount: number | null;
    gross_service_charge_amount: number | null;
    membership_exemption_total: number | null;
    payment_plan_service_charges: number | null;
    payment_plan_membership_exemptions: number | null;
    optional_services_subtotal: number | null;
    optional_services_commission: number | null;
    optional_services_service_charge: number | null;
    optional_services_agency_net: number | null;
    supplements_subtotal: number | null;
    supplements_commission: number | null;
    supplements_service_charge: number | null;
    supplements_agency_net: number | null;
    platform_total_revenue: number | null;
    agency_net_amount: number | null;
    status: string | null;
    processed_at: string | null;
  }[] | null;
  optional_services?: {
    id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    service_charge: number;
    total_paid: number;
    agency_commission: number;
    membership_exemption_used: number;
    is_cancelled: boolean;
    paid_at: string | null;
    payment_method: string | null;
    tour_optional_services: { name: string } | null;
  }[] | null;
  supplements?: {
    id: string;
    quantity: number;
    unit_price: number;
    service_charge: number;
    membership_exemption_used: number;
    supplement_commission: number;
    total_paid: number;
    status: string;
    paid_at: string | null;
    payment_method: string | null;
    refund_amount: number | null;
    tour_supplements: { name: string } | null;
  }[] | null;
}

interface Stats {
  total: number;
  pagadas: number;
  pendientes: number;
  procesando: number;
  canceladas: number;
  totalRevenue: number;
  totalServiceCharges: number;
  totalCommissions: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  succeeded: { label: 'Pagada', cls: 'bg-green-100 text-green-800' },
  pending: { label: 'Pendiente', cls: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Procesando', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'Cancelada', cls: 'bg-red-100 text-red-800' },
  canceled: { label: 'Cancelada', cls: 'bg-red-100 text-red-800' },
  failed: { label: 'Fallida', cls: 'bg-red-100 text-red-800' },
};

const BOOKING_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: 'Pendiente', cls: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Confirmada', cls: 'bg-green-100 text-green-800' },
  completed: { label: 'Completada', cls: 'bg-teal-100 text-teal-800' },
  cancelled: { label: 'Cancelada', cls: 'bg-red-100 text-red-800' },
  cancellation_processing: { label: 'Cancelación en Proceso', cls: 'bg-amber-100 text-amber-800' },
  payment_not_received: { label: 'Pago no recibido', cls: 'bg-orange-100 text-orange-800' },
};

const APPROVAL_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Aprobada', cls: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rechazada', cls: 'bg-red-100 text-red-800' },
};

const fmtDate = (d: string | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
  d ? new Date(d).toLocaleDateString('es-MX', opts ?? { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Section components used inside the detail modal ─────────────────────────

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="mb-6">
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
      <span className="text-blue-600">{icon}</span>
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{title}</h3>
    </div>
    {children}
  </div>
);

const Field: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex flex-col">
    <span className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</span>
    <span className={`text-sm text-gray-800 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
  </div>
);

// ─── Sort Icon ─────────────────────────────────────────────────────────────────

const SortIcon: React.FC<{ active: boolean; dir: 'asc' | 'desc' }> = ({ active, dir }) => {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === 'asc'
    ? <ChevronUp className="h-3 w-3" />
    : <ChevronDown className="h-3 w-3" />;
};

// ─── Main component ───────────────────────────────────────────────────────────

function AdminBookings() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    total: 0, pagadas: 0, pendientes: 0, procesando: 0, canceladas: 0,
    totalRevenue: 0, totalServiceCharges: 0, totalCommissions: 0,
  });

  // Filters
  const [search, setSearch] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterApproval, setFilterApproval] = useState('');

  // Sort
  const [sortCol, setSortCol] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Detail modal
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const { permissions, isSuperAdmin } = useAuth();
  const canCancel = isSuperAdmin || permissions?.canCancelBookings;
  const [adminCancellationData, setAdminCancellationData] = useState<any>(null);

  // Scroll horizontal sincronizado (scrollbar arriba y abajo)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    const tableEl = tableScrollRef.current;
    if (!tableEl) return;
    const obs = new ResizeObserver(() => setTableScrollWidth(tableEl.scrollWidth));
    obs.observe(tableEl);
    return () => obs.disconnect();
  }, []);

  const onTopScroll = () => {
    if (tableScrollRef.current && topScrollRef.current)
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  };
  const onTableScroll = () => {
    if (topScrollRef.current && tableScrollRef.current)
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Query principal: solo columnas escalares de bookings, sin joins
      const { data: rawBookings, error: err } = await supabase
        .from('bookings')
        .select(`
          id, booking_code, user_id, tour_id, agency_id,
          booking_date, created_at, updated_at, status, payment_status,
          payment_method, total_price, deposit_amount, user_payment,
          service_charge, platform_revenue, commission_amount,
          travelers_count, count_adultos, count_ninos, count_infantes,
          count_adultos_mayores, count_mascotas,
          approval_status, approval_notes, approved_at,
          is_no_show, no_show_marked_at,
          has_pending_reschedule, has_pending_slot_reschedule,
          slot_reschedule_response, reschedule_response, original_booking_date,
          selected_date, selected_time, paid_at, confirmation_email_sent,
          payment_intent_id, cancelled_at, cancellation_type, cancellation_refund_amount,
          toursred_cash_used, points_used, points_earned, used_membership_benefit,
          service_charge_discount, membership_service_fee_saved,
          preventa_comision_descuento, discount_amount, es_reserva_preventa,
          needs_seat_reselection, selected_seats,
          travel_insurance_included, travel_insurance_cost, insurance_email_sent,
          has_payment_plan, payment_plan_total, payment_plan_paid, payment_plan_status,
          selected_payment_mode, admin_cancellation_id
        `)
        .neq('status', 'draft')
        .order('created_at', { ascending: false });

      if (err) throw err;
      if (!rawBookings || rawBookings.length === 0) {
        setBookings([]);
        setStats({ total: 0, pagadas: 0, pendientes: 0, procesando: 0, canceladas: 0, totalRevenue: 0, totalServiceCharges: 0, totalCommissions: 0 });
        return;
      }

      // Recopilar IDs unicos para queries de lookup
      const userIds = [...new Set(rawBookings.map(b => b.user_id).filter(Boolean))];
      const tourIds = [...new Set(rawBookings.map(b => b.tour_id).filter(Boolean))];
      const agencyIds = [...new Set(rawBookings.map(b => b.agency_id).filter(Boolean))];
      const bookingIds = rawBookings.map(b => b.id);

      // Queries paralelos de lookup
      const planBookingIds = rawBookings.filter(b => b.has_payment_plan).map(b => b.id);

      const [usersRes, toursRes, agenciesRes, commRes, plansRes, installmentsRes, optSvcRes, supplementsRes] = await Promise.all([
        supabase.from('users').select('id, first_name, last_name, email, profile_picture_url, phone_number, is_active, curp, rfc, razon_social, regimen_fiscal, uso_cfdi, is_foreign_traveler, passport_number').in('id', userIds),
        supabase.from('tours').select('id, name, destination, start_date, end_date, image_url, price, deposit_percentage, booking_approval_type, category').in('id', tourIds),
        supabase.from('agencies').select('id, name, logo, contact_email, contact_phone, commission_rate').in('id', agencyIds),
        supabase.from('commission_records').select('id, booking_id, agency_commission_rate, agency_commission_amount, service_charge_rate, service_charge_amount, gross_service_charge_amount, membership_exemption_total, preventa_comision_descuento, payment_plan_service_charges, payment_plan_membership_exemptions, optional_services_subtotal, optional_services_commission, optional_services_service_charge, optional_services_agency_net, supplements_subtotal, supplements_commission, supplements_service_charge, supplements_agency_net, platform_total_revenue, agency_net_amount, status, processed_at').in('booking_id', bookingIds),
        planBookingIds.length > 0
          ? supabase.from('booking_payment_plans').select('id, booking_id, mode, total_plan_amount, total_amount_paid, status').in('booking_id', planBookingIds)
          : Promise.resolve({ data: [], error: null } as any),
        planBookingIds.length > 0
          ? supabase.from('booking_payment_plan_installments').select('id, plan_id, booking_id, installment_number, label, amount_due, amount_paid, due_date, status, paid_at').in('booking_id', planBookingIds).order('installment_number', { ascending: true })
          : Promise.resolve({ data: [], error: null } as any),
        bookingIds.length > 0
          ? supabase.from('booking_optional_services').select('id, booking_id, quantity, unit_price, subtotal, service_charge, total_paid, agency_commission, membership_exemption_used, is_cancelled, paid_at, payment_method, tour_optional_services(name)').in('booking_id', bookingIds)
          : Promise.resolve({ data: [], error: null } as any),
        bookingIds.length > 0
          ? supabase.from('booking_supplements').select('id, booking_id, quantity, unit_price, service_charge, membership_exemption_used, supplement_commission, total_paid, status, paid_at, payment_method, refund_amount, tour_supplements(name)').in('booking_id', bookingIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      // Mapas para optional_services y supplements
      const optSvcMap: Record<string, typeof optSvcRes.data> = {};
      for (const os of (optSvcRes.data || [])) {
        if (!optSvcMap[os.booking_id]) optSvcMap[os.booking_id] = [];
        optSvcMap[os.booking_id]!.push(os);
      }
      const supplementsMap: Record<string, typeof supplementsRes.data> = {};
      for (const sp of (supplementsRes.data || [])) {
        if (!supplementsMap[sp.booking_id]) supplementsMap[sp.booking_id] = [];
        supplementsMap[sp.booking_id]!.push(sp);
      }

      // Mapas para lookup O(1)
      const usersMap = Object.fromEntries((usersRes.data || []).map(u => [u.id, u]));
      const toursMap = Object.fromEntries((toursRes.data || []).map(t => [t.id, t]));
      const agenciesMap = Object.fromEntries((agenciesRes.data || []).map(a => [a.id, a]));
      const commMap: Record<string, typeof commRes.data> = {};
      for (const c of (commRes.data || [])) {
        if (!commMap[c.booking_id]) commMap[c.booking_id] = [];
        commMap[c.booking_id]!.push(c);
      }

      const plansMap: Record<string, any> = {};
      for (const p of (plansRes.data || [])) {
        plansMap[p.booking_id] = { ...p, installments: [] };
      }
      for (const i of (installmentsRes.data || [])) {
        if (plansMap[i.booking_id]) {
          plansMap[i.booking_id].installments.push(i);
        }
      }

      // Ensamblar resultado final
      const enriched: BookingRow[] = rawBookings.map(b => ({
        ...b,
        users: usersMap[b.user_id] ?? null,
        tours: toursMap[b.tour_id] ?? null,
        agencies: agenciesMap[b.agency_id] ?? null,
        commission_records: commMap[b.id] ?? null,
        payment_plan: plansMap[b.id] ?? null,
        optional_services: optSvcMap[b.id] ?? null,
        supplements: supplementsMap[b.id] ?? null,
      }));

      setBookings(enriched);

      // Compute stats
      setStats({
        total: enriched.length,
        pagadas: enriched.filter(b => b.payment_status === 'succeeded').length,
        pendientes: enriched.filter(b => b.payment_status === 'pending').length,
        procesando: enriched.filter(b => b.payment_status === 'processing').length,
        canceladas: enriched.filter(b => b.payment_status === 'cancelled' || b.payment_status === 'canceled' || b.payment_status === 'failed').length,
        totalRevenue: enriched.filter(b => b.payment_status === 'succeeded').reduce((s, b) => s + Number(b.total_price), 0),
        totalServiceCharges: enriched.filter(b => b.payment_status === 'succeeded').reduce((s, b) => s + Number(b.service_charge), 0),
        totalCommissions: enriched.filter(b => b.payment_status === 'succeeded').reduce((s, b) => s + Number(b.commission_amount), 0),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e));
      setError(msg || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filter + sort ────────────────────────────────────────────────────────────

  const filtered = bookings.filter(b => {
    const q = search.toLowerCase();
    if (q) {
      const haystack = [
        b.booking_code,
        b.users?.first_name,
        b.users?.last_name,
        b.users?.email,
        b.tours?.name,
        b.tours?.destination,
        b.agencies?.name,
        b.id,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filterPayment && b.payment_status !== filterPayment) return false;
    if (filterStatus && b.status !== filterStatus) return false;
    if (filterApproval && b.approval_status !== filterApproval) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    let cmp = 0;
    switch (sortCol) {
      case 'booking_code': cmp = (a.booking_code || a.id).localeCompare(b.booking_code || b.id); break;
      case 'created_at': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
      case 'booking_date': cmp = (a.booking_date ?? '').localeCompare(b.booking_date ?? ''); break;
      case 'traveler': cmp = `${a.users?.first_name} ${a.users?.last_name}`.localeCompare(`${b.users?.first_name} ${b.users?.last_name}`); break;
      case 'tour': cmp = (a.tours?.name ?? '').localeCompare(b.tours?.name ?? ''); break;
      case 'agency': cmp = (a.agencies?.name ?? '').localeCompare(b.agencies?.name ?? ''); break;
      case 'payment_status': cmp = (a.payment_status ?? '').localeCompare(b.payment_status ?? ''); break;
      case 'status': cmp = (a.status ?? '').localeCompare(b.status ?? ''); break;
      case 'total_price': cmp = Number(a.total_price) - Number(b.total_price); break;
      case 'service_charge': cmp = Number(a.service_charge) - Number(b.service_charge); break;
      case 'pax': {
        const pa = (a.count_adultos || 0) + (a.count_ninos || 0) + (a.count_infantes || 0) + (a.count_adultos_mayores || 0) + (a.count_mascotas || 0) || a.travelers_count || 0;
        const pb = (b.count_adultos || 0) + (b.count_ninos || 0) + (b.count_infantes || 0) + (b.count_adultos_mayores || 0) + (b.count_mascotas || 0) || b.travelers_count || 0;
        cmp = pa - pb;
        break;
      }
    }
    return cmp * dir;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const Th: React.FC<{ col: string; label: string; align?: string }> = ({ col, label, align = 'left' }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-3 text-${align} text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 transition-colors`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className={sortCol === col ? 'text-blue-600 font-semibold' : ''}>{label}</span>
        <span className={sortCol === col ? 'text-blue-600' : ''}><SortIcon active={sortCol === col} dir={sortDir} /></span>
      </span>
    </th>
  );

  // ── Stats cards ──────────────────────────────────────────────────────────────

  const statCards = [
    { label: 'Total Reservas', value: stats.total.toLocaleString(), icon: <ShoppingBag className="h-5 w-5" />, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Pagadas', value: stats.pagadas.toLocaleString(), icon: <CheckCircle className="h-5 w-5" />, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Pendientes', value: stats.pendientes.toLocaleString(), icon: <Clock className="h-5 w-5" />, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Procesando', value: stats.procesando.toLocaleString(), icon: <Activity className="h-5 w-5" />, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Canceladas/Fallidas', value: stats.canceladas.toLocaleString(), icon: <XCircle className="h-5 w-5" />, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Ingresos Totales', value: formatCurrencyMXN(stats.totalRevenue), icon: <TrendingUp className="h-5 w-5" />, color: 'text-teal-600', bg: 'bg-teal-50' },
    { label: 'Cargos por Servicio', value: formatCurrencyMXN(stats.totalServiceCharges), icon: <BarChart2 className="h-5 w-5" />, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Comisiones Agencias', value: formatCurrencyMXN(stats.totalCommissions), icon: <Percent className="h-5 w-5" />, color: 'text-gray-600', bg: 'bg-gray-50' },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reservas</h1>
            <p className="mt-1 text-gray-500">Vista completa de todas las reservas de la plataforma</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm transition"
          >
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
          {statCards.map(c => (
            <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className={`inline-flex p-2 rounded-lg ${c.bg} mb-2`}>
                <span className={c.color}>{c.icon}</span>
              </div>
              <div className="text-lg font-bold text-gray-900 leading-tight">{c.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por folio, viajero, tour, agencia..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <select
              value={filterPayment}
              onChange={e => setFilterPayment(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Pago: Todos</option>
              <option value="succeeded">Pagada</option>
              <option value="pending">Pendiente</option>
              <option value="processing">Procesando</option>
              <option value="cancelled">Cancelada</option>
              <option value="failed">Fallida</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Estado: Todos</option>
              <option value="draft">Borrador</option>
              <option value="pending">Pendiente</option>
              <option value="confirmed">Confirmada</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
              <option value="cancellation_processing">Cancelación en Proceso</option>
              <option value="payment_not_received">Pago no recibido</option>
            </select>
            <select
              value={filterApproval}
              onChange={e => setFilterApproval(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Aprobacion: Todas</option>
              <option value="pending">Pendiente</option>
              <option value="approved">Aprobada</option>
              <option value="rejected">Rechazada</option>
            </select>
            {(search || filterPayment || filterStatus || filterApproval) && (
              <button
                onClick={() => { setSearch(''); setFilterPayment(''); setFilterStatus(''); setFilterApproval(''); }}
                className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 280px)', minHeight: 300 }}>
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <ShoppingBag className="h-12 w-12 mb-3" />
              <p className="text-base">No se encontraron reservas</p>
            </div>
          ) : (
            <div
              ref={tableScrollRef}
              onScroll={onTableScroll}
              className="flex-1 overflow-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-track]:bg-gray-100"
            >
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <Th col="booking_code" label="Folio" />
                    <Th col="traveler" label="Viajero" />
                    <Th col="tour" label="Tour" />
                    <Th col="agency" label="Agencia" />
                    <Th col="created_at" label="Fecha Reserva" />
                    <Th col="booking_date" label="Fecha Tour" />
                    <Th col="payment_status" label="Pago" />
                    <Th col="status" label="Estado" />
                    <Th col="pax" label="Pax" align="right" />
                    <Th col="total_price" label="Total" align="right" />
                    <Th col="service_charge" label="Cargo Serv." align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.map(b => {
                    const pax = (b.count_adultos || 0) + (b.count_ninos || 0) + (b.count_infantes || 0) + (b.count_adultos_mayores || 0) + (b.count_mascotas || 0) || b.travelers_count || 0;
                    const ps = PAYMENT_STATUS_MAP[b.payment_status] ?? { label: b.payment_status, cls: 'bg-gray-100 text-gray-600' };
                    const bs = BOOKING_STATUS_MAP[b.status] ?? { label: b.status, cls: 'bg-gray-100 text-gray-600' };
                    const hasBadge = b.is_no_show || b.has_pending_reschedule || b.es_reserva_preventa;
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setSelected(b)}
                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-gray-700 font-medium">
                              {b.booking_code || b.id.slice(0, 8).toUpperCase()}
                            </span>
                            {hasBadge && (
                              <span className="flex gap-0.5">
                                {b.is_no_show && <span title="No-show" className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                                {b.has_pending_reschedule && <span title="Reagendamiento pendiente" className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />}
                                {b.es_reserva_preventa && <span title="Preventa" className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {b.users?.profile_picture_url ? (
                              <img src={b.users.profile_picture_url} alt="" className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                <User className="h-3.5 w-3.5 text-blue-600" />
                              </div>
                            )}
                            <span className="text-gray-800 font-medium max-w-[140px] truncate">
                              {b.users ? `${b.users.first_name} ${b.users.last_name}` : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap max-w-[180px] truncate text-gray-700">
                          {b.tours?.name || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap max-w-[140px] truncate text-gray-600">
                          {b.agencies?.name || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                          {fmtDate(b.created_at)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                          {fmtDate(b.booking_date)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ps.cls}`}>
                            {ps.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bs.cls}`}>
                            {bs.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-gray-700">{pax || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-gray-900">
                          {formatCurrencyMXN(Number(b.total_price))}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600">
                          {formatCurrencyMXN(Number(b.service_charge))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Counter */}
        {!loading && (
          <div className="mt-3 text-xs text-gray-500 text-right">
            Mostrando {sorted.length} de {bookings.length} reservas
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <DetailModal booking={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const DetailModal: React.FC<{ booking: BookingRow; onClose: () => void }> = ({ booking: b, onClose }) => {
  const ps = PAYMENT_STATUS_MAP[b.payment_status] ?? { label: b.payment_status, cls: 'bg-gray-100 text-gray-600' };
  const bs = BOOKING_STATUS_MAP[b.status] ?? { label: b.status, cls: 'bg-gray-100 text-gray-600' };
  const ap = b.approval_status ? (APPROVAL_MAP[b.approval_status] ?? { label: b.approval_status, cls: 'bg-gray-100 text-gray-600' }) : null;

  const pax = (b.count_adultos || 0) + (b.count_ninos || 0) + (b.count_infantes || 0) + (b.count_adultos_mayores || 0) + (b.count_mascotas || 0) || b.travelers_count || 0;
  const commRec = b.commission_records?.[0] ?? null;
  const [isDownloadingXlsx, setIsDownloadingXlsx] = React.useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const { permissions, isSuperAdmin } = useAuth();
  const canCancel = isSuperAdmin || permissions?.canCancelBookings;
  const [adminCancellationData, setAdminCancellationData] = useState<any>(null);

  useEffect(() => {
    if (b.cancellation_type === 'admin_cancelled' && b.admin_cancellation_id) {
      supabase
        .from('admin_booking_cancellations')
        .select('*')
        .eq('id', b.admin_cancellation_id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setAdminCancellationData(data);
        });
    }
  }, [b.id, b.cancellation_type, b.admin_cancellation_id]);

  const downloadInsuranceXlsx = async () => {
    try {
      setIsDownloadingXlsx(true);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-insurance-xlsx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ booking_id: b.id }),
      });
      const json = await res.json();
      if (!json.base64) throw new Error(json.error || 'Error al generar Excel');
      const bytes = Uint8Array.from(atob(json.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = json.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Error al descargar: ' + e.message);
    } finally {
      setIsDownloadingXlsx(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-5xl my-6 shadow-2xl">

        {/* Modal header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-xl font-bold text-gray-900">
                {b.booking_code || b.id.slice(0, 8).toUpperCase()}
              </span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${ps.cls}`}>{ps.label}</span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${bs.cls}`}>{bs.label}</span>
              {ap && <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${ap.cls}`}>{ap.label}</span>}
              {b.es_reserva_preventa && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Preventa</span>}
              {b.is_no_show && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">No-show</span>}
              {b.has_pending_reschedule && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">Reagendamiento pendiente</span>}
              {b.needs_seat_reselection && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Re-seleccion asientos</span>}
            </div>
            <p className="mt-1 text-sm text-gray-400 font-mono">{b.id}</p>
          </div>
          <button onClick={onClose} className="ml-4 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition flex-shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-2">

          {/* ── Viajero ─────────────────────────────────────────────────────────── */}
          <Section title="Viajero" icon={<User className="h-4 w-4" />}>
            <div className="flex items-start gap-4 mb-4">
              {b.users?.profile_picture_url ? (
                <img src={b.users.profile_picture_url} alt="" className="h-14 w-14 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center border border-gray-200">
                  <User className="h-6 w-6 text-blue-600" />
                </div>
              )}
              <div>
                <div className="font-semibold text-gray-900 text-base">
                  {b.users ? `${b.users.first_name} ${b.users.last_name}` : '—'}
                </div>
                {b.users?.email && <div className="text-sm text-gray-500 flex items-center gap-1 mt-0.5"><Mail className="h-3.5 w-3.5" />{b.users.email}</div>}
                {b.users?.phone_number && <div className="text-sm text-gray-500 flex items-center gap-1 mt-0.5"><Phone className="h-3.5 w-3.5" />{b.users.phone_number}</div>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="ID Usuario" value={<span className="font-mono text-xs">{b.user_id?.slice(0, 16) ?? '—'}…</span>} />
              <Field label="Estado cuenta" value={b.users?.is_active ? <span className="text-green-700 font-medium">Activa</span> : <span className="text-red-600 font-medium">Inactiva</span>} />
              {b.users?.is_foreign_traveler ? (
                <Field label="Pasaporte" value={b.users.passport_number} mono />
              ) : (
                <>
                  <Field label="CURP" value={b.users?.curp} mono />
                  <Field label="RFC" value={b.users?.rfc} mono />
                </>
              )}
              <Field label="Razon Social" value={b.users?.razon_social} />
              <Field label="Regimen Fiscal" value={b.users?.regimen_fiscal} />
              <Field label="Uso CFDI" value={b.users?.uso_cfdi} />
              <Field label="Viajero extranjero" value={b.users?.is_foreign_traveler ? 'Si' : 'No'} />
            </div>
          </Section>

          {/* ── Tour ────────────────────────────────────────────────────────────── */}
          <Section title="Tour" icon={<Package className="h-4 w-4" />}>
            {b.tours?.image_url && (
              <img
                src={b.tours.image_url}
                alt={b.tours.name}
                className="w-full h-28 object-cover rounded-lg mb-3 border border-gray-100"
              />
            )}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Nombre" value={<span className="font-medium text-gray-900">{b.tours?.name}</span>} />
              <Field label="Destino" value={<span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-gray-400" />{b.tours?.destination}</span>} />
              <Field label="Fecha inicio" value={fmtDate(b.tours?.start_date)} />
              <Field label="Fecha fin" value={fmtDate(b.tours?.end_date)} />
              <Field label="Fecha de la reserva" value={fmtDate(b.booking_date)} />
              <Field label="Precio base" value={b.tours?.price != null ? formatCurrencyMXN(Number(b.tours.price)) : '—'} />
              <Field label="% Deposito" value={b.tours?.deposit_percentage != null ? `${b.tours.deposit_percentage}%` : '—'} />
              <Field label="Tipo aprobacion" value={b.tours?.booking_approval_type === 'automatic' ? 'Automatica' : 'Manual'} />
              {b.tours?.category && b.tours.category.length > 0 && (
                <div className="col-span-2">
                  <span className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Categorias</span>
                  <div className="flex flex-wrap gap-1">
                    {b.tours.category.map(c => (
                      <span key={c} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                        <Tag className="h-2.5 w-2.5" />{c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* ── Agencia ─────────────────────────────────────────────────────────── */}
          <Section title="Agencia" icon={<Building2 className="h-4 w-4" />}>
            <div className="flex items-center gap-3 mb-3">
              {b.agencies?.logo ? (
                <img src={b.agencies.logo} alt="" className="h-10 w-10 rounded-lg object-contain border border-gray-100" />
              ) : (
                <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-gray-400" />
                </div>
              )}
              <span className="font-semibold text-gray-900">{b.agencies?.name ?? '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Email contacto" value={b.agencies?.contact_email} />
              <Field label="Telefono" value={b.agencies?.contact_phone} />
              <Field label="Tasa de comision" value={b.agencies?.commission_rate != null ? `${(Number(b.agencies.commission_rate) * 100).toFixed(1)}%` : '—'} />
            </div>
          </Section>

          {/* ── Pasajeros ───────────────────────────────────────────────────────── */}
          <Section title="Pasajeros" icon={<Users className="h-4 w-4" />}>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Adultos', val: b.count_adultos },
                { label: 'Ninos', val: b.count_ninos },
                { label: 'Infantes', val: b.count_infantes },
                { label: 'Adultos mayores', val: b.count_adultos_mayores },
                { label: 'Mascotas', val: b.count_mascotas },
                { label: 'Total', val: pax },
              ].map(({ label, val }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{val ?? 0}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Desglose financiero ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <Section title="Desglose Financiero" icon={<DollarSign className="h-4 w-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                {[
                  { label: 'Total Reserva', val: Number(b.total_price), highlight: true },
                  { label: 'Deposito requerido', val: Number(b.deposit_amount ?? 0) },
                  { label: 'Total pagado', val: (() => {
                    if (b.payment_plan?.installments?.length) {
                      return b.payment_plan.installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
                    }
                    return Number(b.user_payment ?? 0);
                  })(), highlight: b.has_payment_plan },
                  { label: 'Cargo por servicio', val: Number(b.service_charge) },
                  { label: 'Ingreso plataforma', val: Number(b.platform_revenue ?? 0) },
                  { label: 'Seguro de viajero', val: Number(b.travel_insurance_included ? b.travel_insurance_cost || 0 : 0), highlight: b.travel_insurance_included },
                ].map(({ label, val, highlight }) => (
                  <div key={label} className={`rounded-lg p-3 ${highlight ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                    <div className={`text-base font-bold ${highlight ? 'text-blue-700' : 'text-gray-900'}`}>
                      {formatCurrencyMXN(val)}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 border-t border-gray-100 pt-4">
                <Field label="Comision agencia" value={formatCurrencyMXN(Number(b.commission_amount))} />
                <Field label="Desc. cargo servicio" value={formatCurrencyMXN(Number(b.service_charge_discount ?? 0))} />
                <Field label="Ahorro por membresia" value={formatCurrencyMXN(Number(b.membership_service_fee_saved ?? 0))} />
                <Field label="Desc. comision preventa" value={formatCurrencyMXN(Number(b.preventa_comision_descuento ?? 0))} />
                <Field label="Puntos ganados" value={<span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5 text-yellow-500" />{b.points_earned ?? 0} pts</span>} />
                <Field label="Puntos usados" value={<span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5 text-gray-400" />{b.points_used ?? 0} pts</span>} />
                <Field label="Beneficio membresia" value={b.used_membership_benefit ? <span className="text-green-700 font-medium flex items-center gap-1"><Star className="h-3.5 w-3.5" />Si</span> : 'No'} />
              </div>
            </Section>
          </div>

          {/* ── Estado de Pago ──────────────────────────────────────────────────── */}
          <Section title="Estado de Pago" icon={<CreditCard className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Estado pago" value={<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ps.cls}`}>{ps.label}</span>} />
              <Field label="Metodo de pago" value={b.payment_method || '—'} />
              <Field label="Fecha de pago" value={fmtDateTime(b.paid_at)} />
              <Field label="Email confirmacion enviado" value={b.confirmation_email_sent ? <span className="text-green-700">Si</span> : <span className="text-gray-400">No</span>} />
              <div className="col-span-2">
                <Field label="Payment Intent ID (Stripe)" value={<span className="font-mono text-xs break-all">{b.payment_intent_id || '—'}</span>} mono />
              </div>
            </div>
          </Section>

          {/* ── Aprobacion ──────────────────────────────────────────────────────── */}
          <Section title="Aprobacion" icon={<Shield className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Estado aprobacion" value={ap ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ap.cls}`}>{ap.label}</span> : '—'} />
              <Field label="Fecha aprobacion" value={fmtDateTime(b.approved_at)} />
              {b.approval_notes && (
                <div className="col-span-2">
                  <Field label="Notas de aprobacion" value={<span className="text-gray-700 italic">"{b.approval_notes}"</span>} />
                </div>
              )}
            </div>
          </Section>

          {/* ── Comisiones ──────────────────────────────────────────────────────── */}
          {commRec && (
            <Section title="Registro de Comision" icon={<Percent className="h-4 w-4" />}>
              {/* Tour principal */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Tour Principal</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                  <Field label="Tasa comision agencia" value={commRec.agency_commission_rate != null ? `${(Number(commRec.agency_commission_rate) * 100).toFixed(1)}%` : '—'} />
                  <Field label="Comision bruta" value={commRec.agency_commission_amount != null ? formatCurrencyMXN(Number(commRec.agency_commission_amount) + Number(commRec.preventa_comision_descuento ?? 0)) : '—'} />
                  <Field label="Desc. comision preventa" value={formatCurrencyMXN(Number(commRec.preventa_comision_descuento ?? 0))} />
                  <Field label="Comision agencia (neta)" value={commRec.agency_commission_amount != null ? formatCurrencyMXN(Number(commRec.agency_commission_amount)) : '—'} />
                  <Field label="Total tour" value={formatCurrencyMXN(Number(b.total_price))} />
                  <Field label="Cargo servicio bruto" value={commRec.gross_service_charge_amount != null ? formatCurrencyMXN(Number(commRec.gross_service_charge_amount)) : '—'} />
                  <Field label="Exencion membresia" value={commRec.membership_exemption_total != null ? formatCurrencyMXN(Number(commRec.membership_exemption_total)) : '—'} />
                  <Field label="Cargo servicio neto" value={commRec.service_charge_amount != null ? formatCurrencyMXN(Number(commRec.service_charge_amount)) : '—'} />
                  <Field label="Neto agencia (tour)" value={formatCurrencyMXN(Number(b.total_price) - Number(b.commission_amount))} />
                </div>
              </div>

              {/* Plan de pagos */}
              {(Number(commRec.payment_plan_service_charges) > 0 || Number(commRec.payment_plan_membership_exemptions) > 0) && (
                <div className="mb-4 pt-3 border-t border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Plan de Pagos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                    <Field label="Cargos servicio de abonos" value={formatCurrencyMXN(Number(commRec.payment_plan_service_charges ?? 0))} />
                    <Field label="Exenciones en abonos" value={formatCurrencyMXN(Number(commRec.payment_plan_membership_exemptions ?? 0))} />
                  </div>
                </div>
              )}

              {/* Servicios opcionales */}
              {Number(commRec.optional_services_subtotal) > 0 && (
                <div className="mb-4 pt-3 border-t border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Servicios Opcionales</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                    <Field label="Subtotal opcionales" value={formatCurrencyMXN(Number(commRec.optional_services_subtotal ?? 0))} />
                    <Field label="Comision agencia" value={formatCurrencyMXN(Number(commRec.optional_services_commission ?? 0))} />
                    <Field label="Cargo servicio" value={formatCurrencyMXN(Number(commRec.optional_services_service_charge ?? 0))} />
                    <Field label="Neto agencia" value={formatCurrencyMXN(Number(commRec.optional_services_agency_net ?? 0))} />
                  </div>
                </div>
              )}

              {/* Suplementos */}
              {Number(commRec.supplements_subtotal) > 0 && (
                <div className="mb-4 pt-3 border-t border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Suplementos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                    <Field label="Subtotal suplementos" value={formatCurrencyMXN(Number(commRec.supplements_subtotal ?? 0))} />
                    <Field label="Comision suplemento" value={formatCurrencyMXN(Number(commRec.supplements_commission ?? 0))} />
                    <Field label="Cargo servicio" value={formatCurrencyMXN(Number(commRec.supplements_service_charge ?? 0))} />
                    <Field label="Neto agencia" value={formatCurrencyMXN(Number(commRec.supplements_agency_net ?? 0))} />
                  </div>
                </div>
              )}

              {/* Totales consolidados */}
              <div className="pt-3 border-t-2 border-gray-200">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="rounded-lg p-3 bg-blue-50 border border-blue-100">
                    <div className="text-base font-bold text-blue-700">{formatCurrencyMXN(Number(commRec.platform_total_revenue ?? 0))}</div>
                    <div className="text-xs text-blue-600 mt-0.5">Revenue total plataforma</div>
                  </div>
                  <div className="rounded-lg p-3 bg-green-50 border border-green-100">
                    <div className="text-base font-bold text-green-700">{formatCurrencyMXN(Number(commRec.agency_net_amount ?? 0))}</div>
                    <div className="text-xs text-green-600 mt-0.5">Payout total agencia</div>
                  </div>
                  <Field label="Estado pago comision" value={commRec.status ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      commRec.status === 'paid_out' ? 'bg-green-100 text-green-800' :
                      commRec.status === 'processed' ? 'bg-blue-100 text-blue-800' :
                      commRec.status === 'disputed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{commRec.status === 'paid_out' ? 'Pagado' : commRec.status === 'processed' ? 'Procesado' : commRec.status === 'disputed' ? 'Disputado' : commRec.status}</span>
                  ) : '—'} />
                  <Field label="Procesado el" value={fmtDateTime(commRec.processed_at)} />
                </div>
              </div>
            </Section>
          )}

          {/* ── Servicios Opcionales ───────────────────────────────────────── */}
          {b.optional_services && b.optional_services.length > 0 && (
            <Section title="Servicios Opcionales" icon={<Plus className="h-4 w-4" />}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-4">Servicio</th>
                      <th className="py-2 pr-4 text-center">Cant.</th>
                      <th className="py-2 pr-4 text-right">Precio unit.</th>
                      <th className="py-2 pr-4 text-right">Subtotal</th>
                      <th className="py-2 pr-4 text-right">Cargo servicio</th>
                      <th className="py-2 pr-4 text-right">Total pagado</th>
                      <th className="py-2 pr-4 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.optional_services.map((os) => (
                      <tr key={os.id} className="border-b border-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-800">{os.tour_optional_services?.name ?? '—'}</td>
                        <td className="py-2 pr-4 text-center">{os.quantity}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(os.unit_price))}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(os.subtotal))}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(os.service_charge))}</td>
                        <td className="py-2 pr-4 text-right font-medium">{formatCurrencyMXN(Number(os.total_paid))}</td>
                        <td className="py-2 pr-4 text-center">
                          {os.is_cancelled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Cancelado</span>
                          ) : os.paid_at ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pagado</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Pendiente</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Suplementos ────────────────────────────────────────────────── */}
          {b.supplements && b.supplements.length > 0 && (
            <Section title="Suplementos" icon={<Package className="h-4 w-4" />}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-4">Suplemento</th>
                      <th className="py-2 pr-4 text-center">Cant.</th>
                      <th className="py-2 pr-4 text-right">Precio unit.</th>
                      <th className="py-2 pr-4 text-right">Subtotal</th>
                      <th className="py-2 pr-4 text-right">Comision</th>
                      <th className="py-2 pr-4 text-right">Cargo servicio</th>
                      <th className="py-2 pr-4 text-right">Total pagado</th>
                      <th className="py-2 pr-4 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.supplements.map((sp) => (
                      <tr key={sp.id} className="border-b border-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-800">{sp.tour_supplements?.name ?? '—'}</td>
                        <td className="py-2 pr-4 text-center">{sp.quantity}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(sp.unit_price))}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(sp.unit_price) * Number(sp.quantity))}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(sp.supplement_commission))}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrencyMXN(Number(sp.service_charge))}</td>
                        <td className="py-2 pr-4 text-right font-medium">{formatCurrencyMXN(Number(sp.total_paid))}</td>
                        <td className="py-2 pr-4 text-center">
                          {sp.status === 'paid' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pagado</span>
                          ) : sp.status === 'cancelled' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Cancelado</span>
                          ) : sp.status === 'pending_approval' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Pendiente aprob.</span>
                          ) : sp.status === 'approved' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Aprobado</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{sp.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Cancelacion ─────────────────────────────────────────────────────── */}
          {(b.cancelled_at || b.is_no_show) && (
            <Section title="Cancelacion / No-show" icon={<XCircle className="h-4 w-4" />}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {b.is_no_show && (
                  <>
                    <Field label="No-show" value={<span className="text-red-700 font-semibold">Si</span>} />
                    <Field label="Marcado el" value={fmtDateTime(b.no_show_marked_at)} />
                  </>
                )}
                {b.cancelled_at && (
                  <>
                    <Field label="Cancelado el" value={fmtDateTime(b.cancelled_at)} />
                    <Field label="Tipo cancelacion" value={b.cancellation_type || '—'} />
                    <Field label="Reembolso" value={b.cancellation_refund_amount != null ? formatCurrencyMXN(Number(b.cancellation_refund_amount)) : '—'} />
                  </>
                )}
              </div>
              {b.cancellation_type === 'admin_cancelled' && adminCancellationData && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">Detalle de Cancelacion Administrativa</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <Field label="Motivo viajero" value={adminCancellationData.reason_for_traveler || '—'} />
                    <Field label="Motivo agencia" value={adminCancellationData.reason_for_agency || '—'} />
                    <Field label="Metodo reembolso" value={
                      adminCancellationData.refund_method === 'toursred_cash' ? 'ToursRed Cash' :
                      adminCancellationData.refund_method === 'bank_transfer' ? 'Transferencia' :
                      'Sin reembolso'
                    } />
                    <Field label="Monto reembolsado" value={adminCancellationData.refund_amount ? formatCurrencyMXN(Number(adminCancellationData.refund_amount)) : '—'} />
                    <Field label="Puntos descontados" value={adminCancellationData.points_deducted?.toString() || '0'} />
                    <Field label="Fecha" value={fmtDateTime(adminCancellationData.cancelled_at)} />
                  </div>
                  {adminCancellationData.receipt_file_path && (
                    <a
                      href={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/cancellation-receipts/${adminCancellationData.receipt_file_path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition"
                    >
                      <FileText className="h-4 w-4" />
                      Ver comprobante de transferencia
                    </a>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* ── Reagendamiento ──────────────────────────────────────────────────── */}
          {(b.has_pending_reschedule || b.original_booking_date) && (
            <Section title="Reagendamiento" icon={<ArrowLeftRight className="h-4 w-4" />}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Pendiente de respuesta" value={b.has_pending_reschedule ? <span className="text-orange-600 font-medium">Si</span> : 'No'} />
                <Field label="Fecha original" value={fmtDate(b.original_booking_date)} />
                <Field label="Nueva fecha" value={fmtDate(b.booking_date)} />
                {b.reschedule_response && <Field label="Respuesta viajero" value={b.reschedule_response} />}
              </div>
            </Section>
          )}

          {/* ── Plan de Pagos ──────────────────────────────────────────────────── */}
          {b.payment_plan && b.payment_plan.installments?.length > 0 && (
            <Section title="Plan de Pagos" icon={<CreditCard className="h-4 w-4" />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 mb-4 border-b border-gray-100 pb-4">
                <Field label="Modo" value={b.payment_plan.mode === 'installments' ? 'Parcialidades' : b.payment_plan.mode === 'free_form' ? 'Libre' : 'Pago unico'} />
                <Field label="Total del plan" value={formatCurrencyMXN(Number(b.payment_plan.total_plan_amount))} />
                <Field label="Total pagado" value={formatCurrencyMXN(Number(b.payment_plan.total_amount_paid))} highlight />
                <Field label="Pendiente" value={formatCurrencyMXN(Number(b.payment_plan.total_plan_amount) - Number(b.payment_plan.total_amount_paid))} />
                <Field label="Estado" value={b.payment_plan.status === 'active' ? 'Activo' : b.payment_plan.status === 'completed' ? 'Completado' : b.payment_plan.status === 'defaulted' ? 'Incumplido' : 'Cancelado'} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-4">#</th>
                      <th className="py-2 pr-4">Etiqueta</th>
                      <th className="py-2 pr-4">Vencimiento</th>
                      <th className="py-2 pr-4 text-right">Monto</th>
                      <th className="py-2 pr-4 text-right">Pagado</th>
                      <th className="py-2 pr-4">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.payment_plan.installments.map((inst) => (
                      <tr key={inst.id} className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-gray-600">{inst.installment_number}</td>
                        <td className="py-2 pr-4 text-gray-800">{inst.label}</td>
                        <td className="py-2 pr-4 text-gray-600">{new Date(inst.due_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td className="py-2 pr-4 text-right font-medium text-gray-800">{formatCurrencyMXN(Number(inst.amount_due))}</td>
                        <td className="py-2 pr-4 text-right font-medium text-green-700">{formatCurrencyMXN(Number(inst.amount_paid))}</td>
                        <td className="py-2 pr-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            inst.status === 'paid' ? 'bg-green-100 text-green-700' :
                            inst.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            inst.status === 'overdue' || inst.status === 'overdue_grace' ? 'bg-red-100 text-red-700' :
                            inst.status === 'partially_paid' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {inst.status === 'paid' ? 'Pagada' :
                             inst.status === 'pending' ? 'Pendiente' :
                             inst.status === 'overdue' ? 'Vencida' :
                             inst.status === 'overdue_grace' ? 'Gracia' :
                             inst.status === 'partially_paid' ? 'Pago parcial' :
                             inst.status === 'waived' ? 'Exenta' :
                             inst.status === 'cancelled' ? 'Cancelada' : inst.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Seguro de Viajero ────────────────────────────────────────────────── */}
          {b.travel_insurance_included && (
            <Section title="Seguro de Viajero" icon={<Shield className="h-4 w-4 text-emerald-600" />}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Costo del seguro" value={formatCurrencyMXN(Number(b.travel_insurance_cost || 0))} />
                <Field
                  label="Notificacion a seguros"
                  value={
                    b.insurance_email_sent
                      ? <span className="text-emerald-600 font-medium">Enviada</span>
                      : <span className="text-amber-600 font-medium">Pendiente</span>
                  }
                />
              </div>
              <div className="mt-4">
                <button
                  onClick={downloadInsuranceXlsx}
                  disabled={isDownloadingXlsx}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-lg transition"
                >
                  <FileText className="h-4 w-4" />
                  {isDownloadingXlsx ? 'Generando...' : 'Descargar Excel para aseguradora'}
                </button>
              </div>
            </Section>
          )}

          {/* ── Timestamps ──────────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 text-xs text-gray-500">
              <div><span className="block text-gray-400 uppercase tracking-wide mb-0.5">Creado</span>{fmtDateTime(b.created_at)}</div>
              <div><span className="block text-gray-400 uppercase tracking-wide mb-0.5">Actualizado</span>{fmtDateTime(b.updated_at)}</div>
              <div><span className="block text-gray-400 uppercase tracking-wide mb-0.5">Pagado</span>{fmtDateTime(b.paid_at)}</div>
              <div><span className="block text-gray-400 uppercase tracking-wide mb-0.5">ID completo</span><span className="font-mono">{b.id}</span></div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          {canCancel && b.status !== 'cancelled' && b.status !== 'cancellation_processing' && !b.cancelled_at ? (
            <button
              onClick={() => setShowCancelModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
            >
              <Ban className="h-4 w-4" />
              Cancelar Reserva
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 shadow-sm transition"
          >
            Cerrar
          </button>
        </div>
      </div>

      {showCancelModal && (
        <AdminCancelBookingModal
          booking={b}
          adminCancellationData={adminCancellationData}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => {
            setShowCancelModal(false);
            load();
            onClose();
          }}
        />
      )}
    </div>
  );
};

// ─── Admin Cancel Booking Modal ──────────────────────────────────────────────

interface AdminCancelModalProps {
  booking: BookingRow;
  adminCancellationData: any;
  onClose: () => void;
  onSuccess: () => void;
}

const AdminCancelBookingModal: React.FC<AdminCancelModalProps> = ({ booking, adminCancellationData, onClose, onSuccess }) => {
  const [reasonForTraveler, setReasonForTraveler] = useState('');
  const [reasonForAgency, setReasonForAgency] = useState('');
  const [withRefund, setWithRefund] = useState(true);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethod, setRefundMethod] = useState<'toursred_cash' | 'bank_transfer' | 'original_payment_method'>('toursred_cash');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [refundServiceCharge, setRefundServiceCharge] = useState(false);

  // Two-phase flow for original_payment_method
  const [bookingCancelled, setBookingCancelled] = useState(false);
  const [cancellationId, setCancellationId] = useState<string | null>(null);
  const [adminCancellationId, setAdminCancellationId] = useState<string | null>(null);
  const [refundLines, setRefundLines] = useState<any[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [lineStates, setLineStates] = useState<Record<string, 'pending' | 'processing' | 'succeeded' | 'failed'>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [refundAllProcessing, setRefundAllProcessing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [manualRefundTxId, setManualRefundTxId] = useState<string | null>(null);
  const [manualRefundMethod, setManualRefundMethod] = useState<'toursred_cash' | 'bank_transfer'>('toursred_cash');

  useEffect(() => {
    // Suggest refund amount based on total actually paid by traveler
    const insurance = booking.travel_insurance_included ? Number(booking.travel_insurance_cost || 0) : 0;
    let totalPaid: number;
    if (booking.payment_plan?.installments?.length) {
      totalPaid = booking.payment_plan.installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    } else {
      totalPaid = Number(booking.user_payment ?? booking.deposit_amount ?? 0);
    }
    setRefundAmount(totalPaid + insurance);
  }, [booking]);

  // Detect in-progress cancellation when modal opens so we can resume the refund-lines flow
  const [resumingCancellation, setResumingCancellation] = useState(false);

  useEffect(() => {
    if (booking.status !== 'cancellation_processing') return;
    let cancelled = false;
    setResumingCancellation(true);
    (async () => {
      try {
        const { data: cancRow, error: cancErr } = await supabase
          .from('booking_cancellations')
          .select('id, refund_processed')
          .eq('booking_id', booking.id)
          .eq('refund_processed', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancErr) throw cancErr;
        if (cancelled) return;

        const { data: adminRow, error: adminErr } = await supabase
          .from('admin_booking_cancellations')
          .select('id')
          .eq('booking_id', booking.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (adminErr) throw adminErr;
        if (cancelled) return;

        if (cancRow?.id && adminRow?.id) {
          setCancellationId(cancRow.id);
          setAdminCancellationId(adminRow.id);
          setBookingCancelled(true);
          setRefundMethod('original_payment_method');
          setWithRefund(true);
          await loadRefundLines();
        } else {
          setError('Esta reserva está en proceso de cancelación pero no se encontró el registro de cancelación asociado. Contactar a soporte técnico.');
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Error al reanudar la cancelación en proceso');
        }
      } finally {
        if (!cancelled) setResumingCancellation(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id, booking.status]);

  const loadRefundLines = async () => {
    setLoadingLines(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-refundable-lines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ booking_id: booking.id }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error al cargar líneas reembolsables');

      setRefundLines(result.lines || []);
      const initialStates: Record<string, 'pending' | 'processing' | 'succeeded' | 'failed'> = {};
      for (const line of result.lines || []) {
        if (line.existing_refund?.status === 'succeeded') {
          initialStates[line.payment_transaction_id] = 'succeeded';
        } else if (line.existing_refund?.status === 'processing' || line.existing_refund?.status === 'pending') {
          initialStates[line.payment_transaction_id] = 'processing';
        } else if (line.existing_refund?.status === 'failed') {
          initialStates[line.payment_transaction_id] = 'failed';
        } else {
          initialStates[line.payment_transaction_id] = 'pending';
        }
      }
      setLineStates(initialStates);
    } catch (e: any) {
      setError(e.message || 'Error al cargar líneas reembolsables');
    } finally {
      setLoadingLines(false);
    }
  };

  const handleRefundLine = async (txId: string) => {
    const line = refundLines.find(l => l.payment_transaction_id === txId);
    if (!line) return;

    setLineStates(prev => ({ ...prev, [txId]: 'processing' }));
    setLineErrors(prev => { const n = { ...prev }; delete n[txId]; return n; });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-payment-refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          payment_transaction_id: txId,
          booking_id: booking.id,
          cancellation_id: cancellationId,
          amount: line.amount,
          currency: line.currency || 'mxn',
          requested_by: 'admin_override',
          created_by_user_id: session.user.id,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al procesar reembolso');
      }

      setLineStates(prev => ({ ...prev, [txId]: result.status === 'succeeded' ? 'succeeded' : 'processing' }));
    } catch (e: any) {
      setLineStates(prev => ({ ...prev, [txId]: 'failed' }));
      setLineErrors(prev => ({ ...prev, [txId]: e.message || 'Error' }));
    }
  };

  const handleRefundAll = async () => {
    setRefundAllProcessing(true);
    const pendingLines = refundLines.filter(l =>
      lineStates[l.payment_transaction_id] === 'pending' && l.refundable_to_original
    );
    for (const line of pendingLines) {
      await handleRefundLine(line.payment_transaction_id);
    }
    setRefundAllProcessing(false);
  };

  const allLinesReady = refundLines.length > 0 && refundLines.every(l => {
    const st = lineStates[l.payment_transaction_id];
    return st === 'succeeded' || st === 'processing';
  });

  const handleFinalizeCancellation = async () => {
    setFinalizing(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-finalize-cancellation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          booking_id: booking.id,
          cancellation_id: cancellationId,
          admin_cancellation_id: adminCancellationId,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al finalizar cancelación');
      }

      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Error al finalizar la cancelación');
    } finally {
      setFinalizing(false);
    }
  };

  const handleManualRefund = async (txId: string) => {
    const line = refundLines.find(l => l.payment_transaction_id === txId);
    if (!line) return;

    setLineStates(prev => ({ ...prev, [txId]: 'processing' }));
    setLineErrors(prev => { const n = { ...prev }; delete n[txId]; return n; });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const { error: insertError } = await supabase
        .from('payment_refunds')
        .insert({
          booking_id: booking.id,
          cancellation_id: cancellationId,
          payment_transaction_id: txId,
          refund_method: manualRefundMethod,
          payment_processor: manualRefundMethod,
          requested_amount: line.amount,
          currency: line.currency || 'mxn',
          status: 'succeeded',
          requested_by: 'admin_override',
          created_by_user_id: session.user.id,
          processed_at: new Date().toISOString(),
        });

      if (insertError) throw new Error(insertError.message);

      setLineStates(prev => ({ ...prev, [txId]: 'succeeded' }));
      setManualRefundTxId(null);
    } catch (e: any) {
      setLineStates(prev => ({ ...prev, [txId]: 'failed' }));
      setLineErrors(prev => ({ ...prev, [txId]: e.message || 'Error' }));
    }
  };

  const handleSubmit = async () => {
    setError(null);

    if (reasonForTraveler.trim().length < 10) {
      setError('El motivo para el viajero debe tener al menos 10 caracteres');
      return;
    }
    if (reasonForAgency.trim().length < 10) {
      setError('El motivo para la agencia debe tener al menos 10 caracteres');
      return;
    }
    if (withRefund && refundMethod !== 'original_payment_method' && refundAmount <= 0) {
      setError('El monto del reembolso debe ser mayor a 0');
      return;
    }
    if (withRefund && refundMethod === 'bank_transfer' && !receiptFile) {
      setError('Debes subir el comprobante de transferencia');
      return;
    }

    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setSubmitting(true);
    try {
      let receiptBase64: string | undefined;
      let receiptFilename: string | undefined;

      if (withRefund && refundMethod === 'bank_transfer' && receiptFile) {
        const arrayBuffer = await receiptFile.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        receiptBase64 = btoa(binary);
        receiptFilename = receiptFile.name;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-cancel-booking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          booking_id: booking.id,
          reason_for_traveler: reasonForTraveler.trim(),
          reason_for_agency: reasonForAgency.trim(),
          refund_method: withRefund ? refundMethod : 'none',
          refund_amount: withRefund && refundMethod !== 'original_payment_method' ? Number(refundAmount) : 0,
          receipt_base64: receiptBase64,
          receipt_filename: receiptFilename,
          requested_by: 'admin_override',
          mode: withRefund && refundMethod === 'original_payment_method' ? 'prepare' : 'full',
          refund_service_charge: withRefund && refundServiceCharge,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al cancelar la reserva');
      }

      if (withRefund && refundMethod === 'original_payment_method') {
        setBookingCancelled(true);
        setCancellationId(result.cancellation_id || null);
        setAdminCancellationId(result.admin_cancellation_id || null);
        await loadRefundLines();
      } else {
        onSuccess();
      }
    } catch (e: any) {
      setError(e.message || 'Error al procesar la cancelación');
      setConfirmStep(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo no debe exceder 5MB');
      return;
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Formato no válido. Use PDF, JPG o PNG');
      return;
    }
    setReceiptFile(file);
    setError(null);
  };

  const insuranceCost = booking.travel_insurance_included ? Number(booking.travel_insurance_cost || 0) : 0;
  const totalPaidByTraveler = booking.payment_plan?.installments?.length
    ? booking.payment_plan.installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0)
    : Number(booking.user_payment ?? booking.deposit_amount ?? 0);
  const optionalServicesRefundable = booking.optional_services
    ? booking.optional_services
        .filter(os => !os.is_cancelled && Number(os.total_paid || 0) > 0)
        .reduce((s, os) => s + Number(os.total_paid || 0), 0)
    : 0;
  const supplementsRefundable = booking.supplements
    ? booking.supplements
        .filter(sp => sp.status === 'paid' && Number(sp.total_paid || 0) > 0)
        .reduce((s, sp) => s + Number(sp.total_paid || 0), 0)
    : 0;
  const serviceChargeAmount = Number(booking.service_charge || 0)
    + (booking.payment_plan?.installments?.reduce((s: number, i: any) => s + Number(i.service_charge || 0), 0) || 0);
  const suggestedAmount = totalPaidByTraveler + insuranceCost + optionalServicesRefundable + supplementsRefundable + (refundServiceCharge ? serviceChargeAmount : 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-red-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 rounded-full p-2">
              <Ban className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Cancelar Reserva</h2>
              <p className="text-sm text-gray-500">Reserva {booking.booking_code || booking.id.slice(0, 8)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {resumingCancellation && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">Reanudando cancelación en proceso...</span>
            </div>
          )}

          {!resumingCancellation && !bookingCancelled && (
            <>
          {/* Booking summary */}
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Tour:</span> <span className="font-medium text-gray-800">{booking.tours?.name}</span></div>
              <div><span className="text-gray-500">Viajero:</span> <span className="font-medium text-gray-800">{booking.users ? `${booking.users.first_name} ${booking.users.last_name}` : '—'}</span></div>
              <div><span className="text-gray-500">Pagado por viajero:</span> <span className="font-medium text-gray-800">{formatCurrencyMXN(totalPaidByTraveler)}</span></div>
              <div><span className="text-gray-500">Seguro:</span> <span className="font-medium text-gray-800">{insuranceCost > 0 ? formatCurrencyMXN(insuranceCost) : 'N/A'}</span></div>
              {optionalServicesRefundable > 0 && (
                <div><span className="text-gray-500">Opcionales reembolsables:</span> <span className="font-medium text-gray-800">{formatCurrencyMXN(optionalServicesRefundable)}</span></div>
              )}
              {supplementsRefundable > 0 && (
                <div><span className="text-gray-500">Suplementos reembolsables:</span> <span className="font-medium text-gray-800">{formatCurrencyMXN(supplementsRefundable)}</span></div>
              )}
              <div className="col-span-2 pt-2 border-t border-gray-200 mt-1">
                <div><span className="text-gray-600 font-semibold">Reembolso sugerido total:</span> <span className="font-bold text-red-600 text-base">{formatCurrencyMXN(suggestedAmount)}</span></div>
              </div>
            </div>
          </div>

          {/* Reasons */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Motivo para el viajero <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reasonForTraveler}
              onChange={(e) => setReasonForTraveler(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              placeholder="Explica el motivo de la cancelación que se enviará al viajero por correo..."
            />
            <p className="text-xs text-gray-400 mt-1">Mínimo 10 caracteres ({reasonForTraveler.trim().length}/10)</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Motivo para la agencia <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reasonForAgency}
              onChange={(e) => setReasonForAgency(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              placeholder="Explica el motivo de la cancelación que se enviará a la agencia por correo..."
            />
            <p className="text-xs text-gray-400 mt-1">Mínimo 10 caracteres ({reasonForAgency.trim().length}/10)</p>
          </div>

          {/* Refund selector */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={withRefund}
                onChange={(e) => setWithRefund(e.target.checked)}
                className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-gray-700">Con reembolso</span>
            </label>

            {withRefund && (
              <div className="space-y-4 mt-3 pl-8">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Monto a reembolsar (MXN)</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(Number(e.target.value))}
                        step="0.01"
                        min="0"
                        className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={() => setRefundAmount(suggestedAmount)}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg transition whitespace-nowrap"
                    >
                      Sugerido: {formatCurrencyMXN(suggestedAmount)}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Sugerido: pagado + seguro + opcionales + suplementos{refundServiceCharge ? ' + cargo de servicio' : ''} = {formatCurrencyMXN(suggestedAmount)}</p>
                </div>

                {serviceChargeAmount > 0 && (
                  <label className="flex items-center gap-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-lg p-3 hover:bg-gray-100 transition">
                    <input
                      type="checkbox"
                      checked={refundServiceCharge}
                      onChange={(e) => {
                        setRefundServiceCharge(e.target.checked);
                        if (e.target.checked) {
                          setRefundAmount(prev => prev + serviceChargeAmount);
                        } else {
                          setRefundAmount(prev => Math.max(0, prev - serviceChargeAmount));
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        Tambien reembolsar el cargo de servicio ({formatCurrencyMXN(serviceChargeAmount)})
                      </span>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Marca esta opcion si el viajero debe recibir el cargo de servicio ademas del principal (ej. fraude de agencia, PROFECO, apoyo al cliente).
                      </p>
                    </div>
                  </label>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Método de reembolso</label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className={`cursor-pointer border-2 rounded-lg p-3 text-center text-sm transition ${refundMethod === 'toursred_cash' ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                      <input
                        type="radio"
                        name="refundMethod"
                        value="toursred_cash"
                        checked={refundMethod === 'toursred_cash'}
                        onChange={() => setRefundMethod('toursred_cash')}
                        className="sr-only"
                      />
                      <Coins className="h-5 w-5 mx-auto mb-1" />
                      ToursRed Cash
                    </label>
                    <label className={`cursor-pointer border-2 rounded-lg p-3 text-center text-sm transition ${refundMethod === 'bank_transfer' ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                      <input
                        type="radio"
                        name="refundMethod"
                        value="bank_transfer"
                        checked={refundMethod === 'bank_transfer'}
                        onChange={() => setRefundMethod('bank_transfer')}
                        className="sr-only"
                      />
                      <CreditCard className="h-5 w-5 mx-auto mb-1" />
                      Transferencia
                    </label>
                    <label className={`cursor-pointer border-2 rounded-lg p-3 text-center text-sm transition ${refundMethod === 'original_payment_method' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                      <input
                        type="radio"
                        name="refundMethod"
                        value="original_payment_method"
                        checked={refundMethod === 'original_payment_method'}
                        onChange={() => setRefundMethod('original_payment_method')}
                        className="sr-only"
                      />
                      <RefreshCw className="h-5 w-5 mx-auto mb-1" />
                      Método original
                    </label>
                  </div>
                </div>

                {refundMethod === 'original_payment_method' && !bookingCancelled && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-800 font-semibold">
                        Reembolso a método de pago original (multi-pago)
                      </p>
                    </div>
                    <p className="text-xs text-amber-700 pl-6">
                      Al confirmar la cancelación, se mostrará la lista de pagos procesados (anticipo, parcialidades, suplementos, opcionales, seguro). Cada línea se reembolsa individualmente con su propio botón, o usa "Reembolsar todo".
                    </p>
                  </div>
                )}

                {refundMethod === 'bank_transfer' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Comprobante de transferencia <span className="text-red-500">*</span></label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition">
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleFileChange}
                        className="hidden"
                        id="receipt-upload"
                      />
                      <label htmlFor="receipt-upload" className="cursor-pointer">
                        {receiptFile ? (
                          <div className="text-sm text-gray-700">
                            <FileText className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                            <span className="font-medium">{receiptFile.name}</span>
                            <span className="text-gray-400 ml-2">({(receiptFile.size / 1024).toFixed(0)} KB)</span>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">
                            <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                            Haz clic para subir el comprobante
                            <p className="text-xs text-gray-400 mt-1">PDF, JPG o PNG (máx. 5MB)</p>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Points info */}
          {refundMethod !== 'original_payment_method' && Math.floor(refundAmount) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <Coins className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-700">
                Se descontarán <strong>{Math.floor(refundAmount)} puntos</strong> acumulados por esta reserva al viajero.
              </p>
            </div>
          )}

          {/* Confirmation step */}
          {confirmStep && !bookingCancelled && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Confirmar cancelación</p>
                  <p className="text-xs text-red-600 mt-1">
                    {withRefund && refundMethod !== 'original_payment_method'
                      ? `Se reembolsarán ${formatCurrencyMXN(refundAmount)} vía ${refundMethod === 'toursred_cash' ? 'ToursRed Cash' : 'transferencia bancaria'} al viajero.`
                      : withRefund && refundMethod === 'original_payment_method'
                      ? 'Se cancelará la reserva. Después podrás reembolsar cada pago individualmente.'
                      : 'No se procesará reembolso al viajero.'}
                    {refundMethod === 'original_payment_method'
                      ? ' Los puntos se descontarán conforme reembolses cada línea.'
                      : Math.floor(refundAmount) > 0
                      ? ` Se descontarán ${Math.floor(refundAmount)} puntos.`
                      : null}
                    {' '}Se enviarán correos al viajero, agencia y a contacto@toursred.com.
                  </p>
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Refund lines panel (phase 2) */}
        {bookingCancelled && (
          <div className="border-t border-gray-100 px-6 py-5 bg-gray-50 rounded-b-2xl">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-800">Líneas reembolsables</h3>
                  <p className="text-xs text-gray-500">Reserva cancelada. ID de cancelación: {cancellationId ? cancellationId.slice(0, 8) + '...' : 'N/A'}</p>
                </div>
                <button
                  onClick={handleRefundAll}
                  disabled={refundAllProcessing || loadingLines || !refundLines.some(l => lineStates[l.payment_transaction_id] === 'pending' && l.refundable_to_original)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refundAllProcessing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Reembolsando...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4" /> Reembolsar todo</>
                  )}
                </button>
              </div>

              {loadingLines ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-sm text-gray-500">Cargando pagos...</span>
                </div>
              ) : refundLines.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500">
                  No se encontraron pagos reembolsables para esta reserva.
                </div>
              ) : (
                <div className="space-y-2">
                  {refundLines.map((line) => {
                    const state = lineStates[line.payment_transaction_id] || 'pending';
                    const err = lineErrors[line.payment_transaction_id];
                    return (
                      <div
                        key={line.payment_transaction_id}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition ${
                          state === 'succeeded' ? 'border-emerald-200 bg-emerald-50' :
                          state === 'failed' ? 'border-red-200 bg-red-50' :
                          state === 'processing' ? 'border-amber-200 bg-amber-50' :
                          'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800 truncate">{line.description}</p>
                            {!line.refundable_to_original && (
                              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">No reembolsable</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-sm text-gray-700 font-medium">{formatCurrencyMXN(line.amount)}</span>
                            <span className="text-xs text-gray-400">{line.payment_processor || 'N/A'}</span>
                            {line.points_earned > 0 && (
                              <span className="text-xs text-amber-600">- {line.points_earned} pts{line.points_earned_is_estimated ? ' (est.)' : ''}</span>
                            )}
                          </div>
                          {state === 'processing' && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> Procesando reembolso...
                            </p>
                          )}
                          {state === 'succeeded' && (
                            <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" /> Reembolso procesado
                            </p>
                          )}
                          {state === 'failed' && (
                            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> {err || 'Error al reembolsar'}
                            </p>
                          )}
                        </div>

                        {state === 'pending' && line.refundable_to_original && (
                          <button
                            onClick={() => handleRefundLine(line.payment_transaction_id)}
                            disabled={refundAllProcessing}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
                          >
                            Reembolsar
                          </button>
                        )}
                        {state === 'processing' && (
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                        )}
                        {state === 'succeeded' && (
                          <CheckCircle className="h-5 w-5 text-emerald-500" />
                        )}
                        {state === 'failed' && line.refundable_to_original && (
                          <div className="flex flex-col gap-1.5 items-end">
                            <button
                              onClick={() => handleRefundLine(line.payment_transaction_id)}
                              disabled={refundAllProcessing}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
                            >
                              Reintentar
                            </button>
                            {manualRefundTxId === line.payment_transaction_id ? (
                              <div className="flex flex-col gap-1.5 w-48">
                                <select
                                  value={manualRefundMethod}
                                  onChange={e => setManualRefundMethod(e.target.value as 'toursred_cash' | 'bank_transfer')}
                                  className="text-xs border border-gray-200 rounded px-2 py-1"
                                >
                                  <option value="toursred_cash">ToursRed Cash</option>
                                  <option value="bank_transfer">Transferencia</option>
                                </select>
                                <button
                                  onClick={() => handleManualRefund(line.payment_transaction_id)}
                                  className="px-2 py-1 bg-gray-700 hover:bg-gray-800 text-white text-xs rounded transition"
                                >
                                  Confirmar manual
                                </button>
                                <button
                                  onClick={() => setManualRefundTxId(null)}
                                  className="text-xs text-gray-500 hover:underline"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setManualRefundTxId(line.payment_transaction_id)}
                                className="text-xs text-gray-600 hover:text-gray-800 underline"
                              >
                                Reembolso manual
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-gray-200 space-y-3">
                {allLinesReady ? (
                  <button
                    onClick={handleFinalizeCancellation}
                    disabled={finalizing}
                    className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {finalizing ? (
                      <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Finalizando...</span>
                    ) : (
                      'Finalizar cancelación'
                    )}
                  </button>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Reembolsa todas las líneas para habilitar el botón de finalización. La reserva permanece en estado "Cancelación en Proceso" hasta entonces.</span>
                  </div>
                )}
                <button
                  onClick={onSuccess}
                  className="w-full px-4 py-2 text-gray-500 hover:text-gray-700 text-sm transition"
                >
                  Cerrar sin finalizar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer (hidden when in phase 2 — lines panel has its own close button) */}
        {!bookingCancelled && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <button
              onClick={() => confirmStep ? setConfirmStep(false) : onClose()}
              disabled={submitting}
              className="px-5 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
            >
              {confirmStep ? 'Volver' : 'Cancelar'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : confirmStep ? (
                <>
                  <Ban className="h-4 w-4" />
                  Confirmar Cancelación
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" />
                  Continuar
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};


export default AdminBookings