import React, { useState, useCallback, useEffect } from 'react';
import {
  FileSpreadsheet, Filter, Search, TrendingUp, TrendingDown,
  DollarSign, BarChart2, Download, RefreshCw, ChevronDown, ChevronRight,
  Calendar, Tag, AlertCircle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

// ─── Types ────────────────────────────────────────────────────────────────────

type MovementType = 'ingreso' | 'egreso';

type MovementCategory =
  | 'reserva'
  | 'seguro_viaje'
  | 'membresia'
  | 'tarjeta_regalo'
  | 'cargo_servicio'
  | 'suplemento'
  | 'servicio_opcional'
  | 'cobro_checkin'
  | 'tour_destacado'
  | 'contable_manual'
  | 'pago_agencia'
  | 'comision_ejecutivo'
  | 'penalidad_cancelacion'
  | 'egreso_manual';

interface MasterRow {
  id: string;
  fecha: string;
  tipo: MovementType;
  categoria: MovementCategory;
  descripcion: string;
  referencia: string;
  monto: number;
  metodo_pago?: string;
  entidad?: string;
}

interface Filters {
  desde: string;
  hasta: string;
  tipo: 'todos' | MovementType;
  categoria: 'todas' | MovementCategory;
  busqueda: string;
}

const CATEGORY_LABELS: Record<MovementCategory, string> = {
  reserva: 'Reserva',
  seguro_viaje: 'Seguro de Viaje',
  membresia: 'Membresia',
  tarjeta_regalo: 'Tarjeta de Regalo',
  cargo_servicio: 'Cargo por Servicio',
  suplemento: 'Suplemento/Extra',
  servicio_opcional: 'Servicio Opcional',
  cobro_checkin: 'Cobro en Checkin',
  tour_destacado: 'Tour Destacado',
  contable_manual: 'Entrada Contable Manual',
  pago_agencia: 'Pago a Agencia',
  comision_ejecutivo: 'Comision Ejecutivo',
  penalidad_cancelacion: 'Penalidad por Cancelacion',
  egreso_manual: 'Egreso Manual',
};

const INCOME_CATEGORIES: MovementCategory[] = [
  'reserva', 'seguro_viaje', 'membresia', 'tarjeta_regalo',
  'cargo_servicio', 'suplemento', 'servicio_opcional', 'cobro_checkin', 'tour_destacado', 'contable_manual',
];
const EXPENSE_CATEGORIES: MovementCategory[] = [
  'pago_agencia', 'comision_ejecutivo', 'penalidad_cancelacion', 'egreso_manual',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d: string) => {
  try { return format(parseISO(d), 'dd/MM/yyyy', { locale: es }); } catch { return d; }
};

const fmtCurrency = (n: number) => formatCurrencyMXN(n);

const today = () => format(new Date(), 'yyyy-MM-dd');
const firstOfMonth = () => format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');

// ─── Component ────────────────────────────────────────────────────────────────

const AdminReporteMaestro: React.FC = () => {
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({
    desde: firstOfMonth(),
    hasta: today(),
    tipo: 'todos',
    categoria: 'todas',
    busqueda: '',
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const collected: MasterRow[] = [];

    try {
      const desde = filters.desde;
      const hasta = filters.hasta + 'T23:59:59';

      // 1. Reservas pagadas
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, booking_code, paid_at, total_price, platform_revenue, service_charge, travel_insurance_cost, travel_insurance_included, payment_method, agencies(name), tours(name)')
          .eq('payment_status', 'succeeded')
          .gte('paid_at', desde)
          .lte('paid_at', hasta)
          .order('paid_at', { ascending: false });

        (bookings ?? []).forEach((b: any) => {
          collected.push({
            id: b.id,
            fecha: b.paid_at,
            tipo: 'ingreso',
            categoria: 'reserva',
            descripcion: `Reserva - ${b.tours?.name ?? 'Tour'}`,
            referencia: b.booking_code ?? b.id.substring(0, 8),
            monto: Number(b.platform_revenue ?? b.total_price ?? 0),
            metodo_pago: b.payment_method,
            entidad: b.agencies?.name,
          });

          if (Number(b.service_charge ?? 0) > 0) {
            collected.push({
              id: `${b.id}-sc`,
              fecha: b.paid_at,
              tipo: 'ingreso',
              categoria: 'cargo_servicio',
              descripcion: `Cargo por servicio - ${b.tours?.name ?? 'Tour'}`,
              referencia: b.booking_code ?? b.id.substring(0, 8),
              monto: Number(b.service_charge),
              metodo_pago: b.payment_method,
              entidad: b.agencies?.name,
            });
          }

          if (Number(b.travel_insurance_cost ?? 0) > 0 && b.travel_insurance_included) {
            collected.push({
              id: `${b.id}-ins`,
              fecha: b.paid_at,
              tipo: 'ingreso',
              categoria: 'seguro_viaje',
              descripcion: `Seguro de viaje - ${b.tours?.name ?? 'Tour'}`,
              referencia: b.booking_code ?? b.id.substring(0, 8),
              monto: Number(b.travel_insurance_cost),
              metodo_pago: b.payment_method,
              entidad: b.agencies?.name,
            });
          }
        });
      }

      // 2. Membresías
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: mems } = await supabase
          .from('memberships')
          .select('id, plan_type, price_paid, renewal_amount, start_date, users(first_name, last_name, email)')
          .gte('start_date', desde)
          .lte('start_date', hasta)
          .order('start_date', { ascending: false });

        (mems ?? []).forEach((m: any) => {
          const amount = Number(m.price_paid ?? m.renewal_amount ?? 0);
          if (amount <= 0) return;
          const user = m.users ? `${m.users.first_name} ${m.users.last_name}` : '';
          collected.push({
            id: m.id,
            fecha: m.start_date,
            tipo: 'ingreso',
            categoria: 'membresia',
            descripcion: `Membresia ${m.plan_type === 'annual' ? 'Anual' : 'Mensual'}`,
            referencia: m.id.substring(0, 8),
            monto: amount,
            entidad: user,
          });
        });
      }

      // 3. Tarjetas de regalo
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: gcs } = await supabase
          .from('gift_cards')
          .select('id, code, amount, purchased_at, purchaser_name, purchaser_email, payment_provider')
          .eq('payment_status', 'paid')
          .gte('purchased_at', desde)
          .lte('purchased_at', hasta)
          .order('purchased_at', { ascending: false });

        (gcs ?? []).forEach((g: any) => {
          collected.push({
            id: g.id,
            fecha: g.purchased_at,
            tipo: 'ingreso',
            categoria: 'tarjeta_regalo',
            descripcion: `Tarjeta de regalo`,
            referencia: g.code ?? g.id.substring(0, 8),
            monto: Number(g.amount ?? 0),
            metodo_pago: g.payment_provider,
            entidad: g.purchaser_name ?? g.purchaser_email,
          });
        });
      }

      // 4. Suplementos de reserva (booking_supplements)
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: supls } = await supabase
          .from('booking_supplements')
          .select('id, total_paid, paid_at, bookings(booking_code, agencies(name)), tour_supplements(name)')
          .eq('status', 'paid')
          .gte('paid_at', desde)
          .lte('paid_at', hasta)
          .order('paid_at', { ascending: false });

        (supls ?? []).forEach((s: any) => {
          const monto = Number(s.total_paid ?? 0);
          if (monto <= 0) return;
          collected.push({
            id: s.id,
            fecha: s.paid_at,
            tipo: 'ingreso',
            categoria: 'suplemento',
            descripcion: `Suplemento - ${s.tour_supplements?.name ?? 'Suplemento'}`,
            referencia: s.bookings?.booking_code ?? s.id.substring(0, 8),
            monto,
            entidad: s.bookings?.agencies?.name,
          });
        });
      }

      // 5. Servicios opcionales de reserva (booking_optional_services)
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: opts } = await supabase
          .from('booking_optional_services')
          .select('id, subtotal, bookings!inner(booking_code, paid_at, agencies(name)), tour_optional_services(name)')
          .eq('is_cancelled', false)
          .eq('bookings.payment_status', 'succeeded')
          .gte('bookings.paid_at', desde)
          .lte('bookings.paid_at', hasta)
          .order('bookings(paid_at)', { ascending: false });

        (opts ?? []).forEach((o: any) => {
          const monto = Number(o.subtotal ?? 0);
          if (monto <= 0) return;
          collected.push({
            id: o.id,
            fecha: o.bookings?.paid_at,
            tipo: 'ingreso',
            categoria: 'servicio_opcional',
            descripcion: `Servicio opcional - ${o.tour_optional_services?.name ?? 'Servicio'}`,
            referencia: o.bookings?.booking_code ?? o.id.substring(0, 8),
            monto,
            entidad: o.bookings?.agencies?.name,
          });
        });
      }

      // 6. Cobros en checkin (wallet_checkin_charges)
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: checkins } = await supabase
          .from('wallet_checkin_charges')
          .select('id, amount_charged, service_charge_applied, created_at, bookings(booking_code, agencies(name), tours(name))')
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at', { ascending: false });

        (checkins ?? []).forEach((c: any) => {
          const monto = Number(c.amount_charged ?? 0);
          if (monto <= 0) return;
          collected.push({
            id: c.id,
            fecha: c.created_at,
            tipo: 'ingreso',
            categoria: 'cobro_checkin',
            descripcion: `Cobro checkin - ${c.bookings?.tours?.name ?? 'Tour'}`,
            referencia: c.bookings?.booking_code ?? c.id.substring(0, 8),
            monto,
            entidad: c.bookings?.agencies?.name,
          });
        });
      }

      // 7. Tours destacados (ingresos de agencias por posicionamiento)
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: featured } = await supabase
          .from('featured_tour_slots')
          .select('id, total_amount, payment_confirmed_at, agencies(name), tours(name), featured_plans(name)')
          .not('payment_confirmed_at', 'is', null)
          .gte('payment_confirmed_at', desde)
          .lte('payment_confirmed_at', hasta)
          .order('payment_confirmed_at', { ascending: false });

        (featured ?? []).forEach((f: any) => {
          const monto = Number(f.total_amount ?? 0);
          if (monto <= 0) return;
          const plan = f.featured_plans?.name ?? 'Plan';
          collected.push({
            id: f.id,
            fecha: f.payment_confirmed_at,
            tipo: 'ingreso',
            categoria: 'tour_destacado',
            descripcion: `Tour destacado - ${plan} - ${f.tours?.name ?? 'Tour'}`,
            referencia: f.id.substring(0, 8),
            monto,
            entidad: f.agencies?.name,
          });
        });
      }

      // 8. Entradas contables manuales (ingresos y egresos)
      {
        let query = supabase
          .from('accounting_entries')
          .select('id, entry_number, entry_date, description, entry_type, source_type')
          .eq('source_type', 'manual')
          .eq('is_posted', true)
          .gte('entry_date', desde.substring(0, 10))
          .lte('entry_date', hasta.substring(0, 10))
          .order('entry_date', { ascending: false });

        if (filters.tipo !== 'todos') {
          query = query.eq('entry_type', filters.tipo);
        }

        const { data: manualEntries } = await query;

        // Get totals per entry from lines
        const entryIds = (manualEntries ?? []).map((e: any) => e.id);
        if (entryIds.length > 0) {
          const { data: lines } = await supabase
            .from('accounting_entry_lines')
            .select('accounting_entry_id, debit, credit')
            .in('accounting_entry_id', entryIds);

          const totals: Record<string, { debit: number; credit: number }> = {};
          (lines ?? []).forEach((l: any) => {
            if (!totals[l.accounting_entry_id]) totals[l.accounting_entry_id] = { debit: 0, credit: 0 };
            totals[l.accounting_entry_id].debit += Number(l.debit ?? 0);
            totals[l.accounting_entry_id].credit += Number(l.credit ?? 0);
          });

          (manualEntries ?? []).forEach((e: any) => {
            const t = totals[e.id] ?? { debit: 0, credit: 0 };
            const isIngreso = e.entry_type === 'ingreso';
            const monto = isIngreso ? t.credit : t.debit;
            if (monto <= 0) return;
            collected.push({
              id: e.id,
              fecha: e.entry_date,
              tipo: isIngreso ? 'ingreso' : 'egreso',
              categoria: isIngreso ? 'contable_manual' : 'egreso_manual',
              descripcion: e.description ?? 'Entrada contable manual',
              referencia: e.entry_number ?? e.id.substring(0, 8),
              monto,
            });
          });
        }
      }

      // 9. Pagos a agencias (egresos)
      if (filters.tipo === 'todos' || filters.tipo === 'egreso') {
        const { data: payouts } = await supabase
          .from('agency_payouts')
          .select('id, payout_code, payment_date, amount, net_amount, payment_method, agencies(name)')
          .gte('payment_date', desde.substring(0, 10))
          .lte('payment_date', hasta.substring(0, 10))
          .order('payment_date', { ascending: false });

        (payouts ?? []).forEach((p: any) => {
          collected.push({
            id: p.id,
            fecha: p.payment_date,
            tipo: 'egreso',
            categoria: 'pago_agencia',
            descripcion: `Pago a agencia - ${p.agencies?.name ?? 'Agencia'}`,
            referencia: p.payout_code ?? p.id.substring(0, 8),
            monto: Number(p.net_amount ?? p.amount ?? 0),
            metodo_pago: p.payment_method,
            entidad: p.agencies?.name,
          });
        });
      }

      // 10. Comisiones de ejecutivos (egresos)
      if (filters.tipo === 'todos' || filters.tipo === 'egreso') {
        const { data: comms } = await supabase
          .from('executive_commissions')
          .select('id, amount, commission_type, paid_at, created_at, agencies(name), account_executives(first_name, last_name)')
          .eq('status', 'paid')
          .gte('paid_at', desde)
          .lte('paid_at', hasta)
          .order('paid_at', { ascending: false });

        (comms ?? []).forEach((c: any) => {
          const monto = Number(c.amount ?? 0);
          if (monto <= 0) return;
          const executive = c.account_executives ? `${c.account_executives.first_name} ${c.account_executives.last_name}` : '';
          collected.push({
            id: c.id,
            fecha: c.paid_at ?? c.created_at,
            tipo: 'egreso',
            categoria: 'comision_ejecutivo',
            descripcion: `Comision ejecutivo - ${c.commission_type ?? 'General'}`,
            referencia: c.id.substring(0, 8),
            monto,
            entidad: executive || c.agencies?.name,
          });
        });
      }

      // 11. Penalidades por cancelacion (ingresos para plataforma)
      if (filters.tipo === 'todos' || filters.tipo === 'ingreso') {
        const { data: penalties } = await supabase
          .from('cancellation_penalty_records')
          .select('id, platform_amount, gross_penalty, created_at, agencies(name)')
          .in('status', ['paid', 'processed'])
          .gte('created_at', desde)
          .lte('created_at', hasta)
          .order('created_at', { ascending: false });

        (penalties ?? []).forEach((p: any) => {
          const monto = Number(p.platform_amount ?? p.gross_penalty ?? 0);
          if (monto <= 0) return;
          collected.push({
            id: p.id,
            fecha: p.created_at,
            tipo: 'ingreso',
            categoria: 'penalidad_cancelacion',
            descripcion: `Penalidad por cancelacion`,
            referencia: p.id.substring(0, 8),
            monto,
            entidad: p.agencies?.name,
          });
        });
      }

      // Sort all collected rows by date descending
      collected.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      setRows(collected);
    } catch (err: any) {
      setError(err.message ?? 'Error al cargar el reporte');
    } finally {
      setLoading(false);
    }
  }, [filters.desde, filters.hasta, filters.tipo]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived/filtered data ────────────────────────────────────────────────────

  const filtered = rows.filter((r) => {
    if (filters.categoria !== 'todas' && r.categoria !== filters.categoria) return false;
    if (filters.busqueda) {
      const q = filters.busqueda.toLowerCase();
      if (
        !r.descripcion.toLowerCase().includes(q) &&
        !r.referencia.toLowerCase().includes(q) &&
        !(r.entidad ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const totalIngresos = filtered.filter((r) => r.tipo === 'ingreso').reduce((s, r) => s + r.monto, 0);
  const totalEgresos = filtered.filter((r) => r.tipo === 'egreso').reduce((s, r) => s + r.monto, 0);
  const resultado = totalIngresos - totalEgresos;

  // ── Export ──────────────────────────────────────────────────────────────────

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ['REPORTE MAESTRO DE INGRESOS Y EGRESOS'],
      [''],
      ['Periodo:', `${fmtDate(filters.desde)} - ${fmtDate(filters.hasta)}`],
      ['Generado:', format(new Date(), 'dd/MM/yyyy HH:mm')],
      [''],
      ['RESUMEN'],
      ['Total Ingresos:', fmtCurrency(totalIngresos)],
      ['Total Egresos:', fmtCurrency(totalEgresos)],
      ['Resultado Neto:', fmtCurrency(resultado)],
      [''],
      ['INGRESOS POR CATEGORIA'],
      ...INCOME_CATEGORIES.map((cat) => {
        const sum = filtered.filter((r) => r.categoria === cat).reduce((s, r) => s + r.monto, 0);
        return [CATEGORY_LABELS[cat], fmtCurrency(sum)];
      }),
      [''],
      ['EGRESOS POR CATEGORIA'],
      ...EXPENSE_CATEGORIES.map((cat) => {
        const sum = filtered.filter((r) => r.categoria === cat).reduce((s, r) => s + r.monto, 0);
        return [CATEGORY_LABELS[cat], fmtCurrency(sum)];
      }),
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 35 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

    // Sheet 2: Detail
    const detailData: any[][] = [
      ['Fecha', 'Tipo', 'Categoria', 'Descripcion', 'Referencia', 'Entidad', 'Metodo Pago', 'Monto']
    ];
    filtered.forEach((r) => {
      detailData.push([
        fmtDate(r.fecha),
        r.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
        CATEGORY_LABELS[r.categoria],
        r.descripcion,
        r.referencia,
        r.entidad ?? '',
        r.metodo_pago ?? '',
        Number(r.monto.toFixed(2)),
      ]);
    });
    const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
    wsDetail['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 40 },
      { wch: 18 }, { wch: 30 }, { wch: 15 }, { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle');

    XLSX.writeFile(wb, `ReporteMaestro_${filters.desde}_${filters.hasta}.xlsx`);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const categoriasDisponibles: MovementCategory[] =
    filters.tipo === 'ingreso' ? INCOME_CATEGORIES :
    filters.tipo === 'egreso' ? EXPENSE_CATEGORIES :
    [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reporte Maestro de Ingresos y Egresos</h1>
          <p className="text-gray-500 text-sm mt-1">
            Registro consolidado de todos los movimientos financieros de la plataforma
          </p>
        </div>
        <button
          onClick={exportToExcel}
          disabled={loading || filtered.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          Exportar a Excel
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-medium text-sm">
          <Filter size={15} />
          Filtros
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input
              type="date"
              value={filters.desde}
              onChange={(e) => setFilters((f) => ({ ...f, desde: e.target.value, categoria: 'todas' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input
              type="date"
              value={filters.hasta}
              onChange={(e) => setFilters((f) => ({ ...f, hasta: e.target.value, categoria: 'todas' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
            <select
              value={filters.tipo}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  tipo: e.target.value as Filters['tipo'],
                  categoria: 'todas',
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos</option>
              <option value="ingreso">Solo Ingresos</option>
              <option value="egreso">Solo Egresos</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
            <select
              value={filters.categoria}
              onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value as Filters['categoria'] }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todas">Todas</option>
              {categoriasDisponibles.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Descripcion, referencia..."
                value={filters.busqueda}
                onChange={(e) => setFilters((f) => ({ ...f, busqueda: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Ingresos</p>
              <p className="text-2xl font-bold text-emerald-600">{fmtCurrency(totalIngresos)}</p>
            </div>
            <div className="p-2 bg-emerald-50 rounded-lg">
              <TrendingUp size={20} className="text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Egresos</p>
              <p className="text-2xl font-bold text-red-600">{fmtCurrency(totalEgresos)}</p>
            </div>
            <div className="p-2 bg-red-50 rounded-lg">
              <TrendingDown size={20} className="text-red-600" />
            </div>
          </div>
        </div>
        <div className={`bg-white rounded-xl border p-5 shadow-sm ${resultado >= 0 ? 'border-gray-200' : 'border-red-100'}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Resultado Neto</p>
              <p className={`text-2xl font-bold ${resultado >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                {fmtCurrency(resultado)}
              </p>
            </div>
            <div className={`p-2 rounded-lg ${resultado >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
              <DollarSign size={20} className={resultado >= 0 ? 'text-blue-600' : 'text-red-600'} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Movimientos</p>
              <p className="text-2xl font-bold text-gray-800">{filtered.length}</p>
            </div>
            <div className="p-2 bg-gray-100 rounded-lg">
              <BarChart2 size={20} className="text-gray-500" />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">
            {filtered.length} {filtered.length === 1 ? 'movimiento' : 'movimientos'}
          </span>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <BarChart2 size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sin movimientos en el periodo seleccionado</p>
            <p className="text-gray-400 text-sm mt-1">Ajusta los filtros o el rango de fechas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Categoria</th>
                  <th className="px-4 py-3 text-left">Descripcion</th>
                  <th className="px-4 py-3 text-left">Referencia</th>
                  <th className="px-4 py-3 text-left">Entidad</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={12} className="text-gray-400 flex-shrink-0" />
                        {fmtDate(row.fecha)}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        row.tipo === 'ingreso'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {row.tipo === 'ingreso' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {row.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Tag size={11} className="text-gray-400" />
                        {CATEGORY_LABELS[row.categoria]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs truncate">{row.descripcion}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{row.referencia}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{row.entidad ?? '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                      row.tipo === 'ingreso' ? 'text-emerald-700' : 'text-red-600'
                    }`}>
                      {row.tipo === 'egreso' && <span className="text-red-400 mr-0.5">-</span>}
                      {fmtCurrency(row.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                  <td colSpan={5} className="px-4 py-3 text-sm text-gray-700">
                    Totales ({filtered.length} movimientos)
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    <span className="text-emerald-600">+{fmtCurrency(totalIngresos)}</span>
                    {' / '}
                    <span className="text-red-500">-{fmtCurrency(totalEgresos)}</span>
                  </td>
                  <td className={`px-4 py-3 text-right text-base ${resultado >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                    {fmtCurrency(resultado)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminReporteMaestro;
