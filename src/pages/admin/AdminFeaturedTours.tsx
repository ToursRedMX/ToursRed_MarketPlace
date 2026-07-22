import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Clock, List, Settings2, Search, RefreshCw,
  Building2, Calendar, TrendingUp, Eye, MousePointerClick,
  ShoppingBag, CheckCircle, XCircle, AlertCircle, Bell,
  Trash2, Save, ToggleLeft, ToggleRight, Loader2,
  ChevronUp, ChevronDown, DollarSign
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/formatCurrency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeaturedPlan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  is_active: boolean;
  display_order: number;
}

interface FeaturedSlot {
  id: string;
  status: 'pending_payment' | 'active' | 'expired' | 'cancelled';
  starts_at: string;
  expires_at: string;
  created_at: string;
  payment_confirmed_at: string | null;
  total_amount: number | null;
  tours: { name: string; destination: string } | null;
  agencies: { name: string } | null;
  featured_plans: { name: string; duration_days: number; price: number } | null;
  featured_tour_stats: { impressions: number; clicks: number; bookings_generated: number } | null;
}

interface WaitlistEntry {
  id: string;
  status: string;
  position: number;
  created_at: string;
  notified_at: string | null;
  tours: { name: string; destination: string } | null;
  agencies: { name: string } | null;
  featured_plans: { name: string } | null;
}

type Tab = 'active' | 'waitlist' | 'plans';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysRemaining(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

function statusBadge(status: FeaturedSlot['status']) {
  const map = {
    active: { label: 'Activo', cls: 'bg-emerald-100 text-emerald-700' },
    pending_payment: { label: 'Pago Pendiente', cls: 'bg-amber-100 text-amber-700' },
    expired: { label: 'Vencido', cls: 'bg-slate-100 text-slate-500' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-600' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

function daysRemainingBadge(days: number) {
  let cls = 'text-emerald-600 bg-emerald-50';
  if (days <= 3) cls = 'text-red-600 bg-red-50';
  else if (days <= 7) cls = 'text-amber-600 bg-amber-50';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      <Clock className="h-3 w-3" /> {days}d
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const AdminFeaturedTours: React.FC = () => {
  const [tab, setTab] = useState<Tab>('active');

  // Slots
  const [slots, setSlots] = useState<FeaturedSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotSearch, setSlotSearch] = useState('');
  const [slotStatusFilter, setSlotStatusFilter] = useState<'all' | 'active' | 'pending_payment' | 'expired' | 'cancelled'>('all');

  // Waitlist
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(true);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Plans
  const [plans, setPlans] = useState<FeaturedPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState<Record<string, Partial<FeaturedPlan>>>({});
  const [savingPlan, setSavingPlan] = useState<string | null>(null);

  const [actionMsg, setActionMsg] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    const { data, error } = await supabase
      .from('featured_tour_slots')
      .select(`
        id, status, starts_at, expires_at, created_at,
        payment_confirmed_at, total_amount,
        tours(name, destination),
        agencies(name),
        featured_plans(name, duration_days, price),
        featured_tour_stats(impressions, clicks, bookings_generated)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) setSlots(data as unknown as FeaturedSlot[]);
    setSlotsLoading(false);
  }, []);

  const loadWaitlist = useCallback(async () => {
    setWaitlistLoading(true);
    const { data, error } = await supabase
      .from('featured_tour_waitlist')
      .select(`
        id, status, position, created_at, notified_at,
        tours(name, destination),
        agencies(name),
        featured_plans(name)
      `)
      .order('position', { ascending: true });

    if (!error && data) setWaitlist(data as unknown as WaitlistEntry[]);
    setWaitlistLoading(false);
  }, []);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    const { data, error } = await supabase
      .from('featured_plans')
      .select('*')
      .order('display_order', { ascending: true });

    if (!error && data) setPlans(data as FeaturedPlan[]);
    setPlansLoading(false);
  }, []);

  useEffect(() => {
    loadSlots();
    loadWaitlist();
    loadPlans();
  }, [loadSlots, loadWaitlist, loadPlans]);

  // ── Slot actions ──────────────────────────────────────────────────────────

  const handleCancelSlot = async (id: string) => {
    if (!confirm('¿Cancelar este slot destacado?')) return;
    const { error } = await supabase
      .from('featured_tour_slots')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'cancelled' } : s));
      flash('Slot cancelado correctamente.');
    }
  };

  // ── Waitlist actions ──────────────────────────────────────────────────────

  const handleNotify = async (entry: WaitlistEntry) => {
    setNotifyingId(entry.id);
    const { error } = await supabase
      .from('featured_tour_waitlist')
      .update({ status: 'notified', notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', entry.id);
    setNotifyingId(null);
    if (!error) {
      setWaitlist(prev => prev.map(w => w.id === entry.id ? { ...w, status: 'notified', notified_at: new Date().toISOString() } : w));
      flash('Agencia marcada como notificada.');
    }
  };

  const handleDeleteWaitlist = async (id: string) => {
    if (!confirm('¿Eliminar esta entrada de la lista de espera?')) return;
    setDeletingId(id);
    const { error } = await supabase.from('featured_tour_waitlist').delete().eq('id', id);
    setDeletingId(null);
    if (!error) {
      setWaitlist(prev => prev.filter(w => w.id !== id));
      flash('Entrada eliminada.');
    }
  };

  // ── Plan editing ──────────────────────────────────────────────────────────

  const startEdit = (plan: FeaturedPlan) => {
    setEditingPlan(prev => ({ ...prev, [plan.id]: { price: plan.price, name: plan.name } }));
  };

  const handlePlanFieldChange = (id: string, field: keyof FeaturedPlan, value: unknown) => {
    setEditingPlan(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSavePlan = async (plan: FeaturedPlan) => {
    const changes = editingPlan[plan.id];
    if (!changes) return;
    const price = Number(changes.price);
    if (isNaN(price) || price <= 0) { flash('El precio debe ser mayor a 0.', true); return; }
    setSavingPlan(plan.id);
    const { error } = await supabase
      .from('featured_plans')
      .update({ name: changes.name ?? plan.name, price, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    setSavingPlan(null);
    if (!error) {
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, name: (changes.name ?? p.name) as string, price } : p));
      setEditingPlan(prev => { const n = { ...prev }; delete n[plan.id]; return n; });
      flash('Plan actualizado correctamente.');
    } else {
      flash('Error al guardar el plan.', true);
    }
  };

  const handleTogglePlan = async (plan: FeaturedPlan) => {
    const { error } = await supabase
      .from('featured_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (!error) {
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, is_active: !p.is_active } : p));
      flash(`Plan ${plan.is_active ? 'desactivado' : 'activado'}.`);
    }
  };

  const handleReorderPlan = async (plan: FeaturedPlan, dir: 'up' | 'down') => {
    const sorted = [...plans].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex(p => p.id === plan.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swapPlan = sorted[swapIdx];
    await supabase.from('featured_plans').update({ display_order: swapPlan.display_order }).eq('id', plan.id);
    await supabase.from('featured_plans').update({ display_order: plan.display_order }).eq('id', swapPlan.id);
    setPlans(prev => prev.map(p => {
      if (p.id === plan.id) return { ...p, display_order: swapPlan.display_order };
      if (p.id === swapPlan.id) return { ...p, display_order: plan.display_order };
      return p;
    }).sort((a, b) => a.display_order - b.display_order));
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const flash = (msg: string, _isError = false) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 3500);
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const filteredSlots = slots.filter(s => {
    const matchStatus = slotStatusFilter === 'all' || s.status === slotStatusFilter;
    const query = slotSearch.toLowerCase();
    const matchSearch = !query ||
      (s.tours?.name ?? '').toLowerCase().includes(query) ||
      (s.agencies?.name ?? '').toLowerCase().includes(query);
    return matchStatus && matchSearch;
  });

  const activeCount = slots.filter(s => s.status === 'active').length;
  const pendingCount = slots.filter(s => s.status === 'pending_payment').length;
  const totalRevenue = slots
    .filter(s => s.payment_confirmed_at && s.total_amount)
    .reduce((sum, s) => sum + (s.total_amount ?? 0), 0);
  const totalImpressions = slots.reduce((sum, s) => sum + (s.featured_tour_stats?.impressions ?? 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 rounded-lg">
                <Sparkles className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Tours Destacados</h1>
                <p className="text-sm text-gray-500 mt-0.5">Gestiona slots, lista de espera y configuracion de planes</p>
              </div>
            </div>
            <button
              onClick={() => { loadSlots(); loadWaitlist(); loadPlans(); }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Actualizar
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <SummaryCard label="Slots activos" value={activeCount} icon={<CheckCircle className="h-5 w-5 text-emerald-500" />} color="emerald" caption={`de 50 disponibles`} />
            <SummaryCard label="Pago pendiente" value={pendingCount} icon={<Clock className="h-5 w-5 text-amber-500" />} color="amber" caption="por confirmar" />
            <SummaryCard label="En espera" value={waitlist.filter(w => w.status === 'waiting').length} icon={<List className="h-5 w-5 text-blue-500" />} color="blue" caption="agencias esperando" />
            <SummaryCard label="Ingresos confirmados" value={formatCurrency(totalRevenue)} icon={<DollarSign className="h-5 w-5 text-violet-500" />} color="violet" caption={`${totalImpressions.toLocaleString()} impresiones`} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6" aria-label="Tabs">
            {([
              { id: 'active', label: 'Slots Activos', icon: <Sparkles className="h-4 w-4" /> },
              { id: 'waitlist', label: 'Lista de Espera', icon: <List className="h-4 w-4" /> },
              { id: 'plans', label: 'Planes & Precios', icon: <Settings2 className="h-4 w-4" /> },
            ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 py-4 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Flash message */}
        {actionMsg && (
          <div className="mb-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-lg">
            <CheckCircle className="h-4 w-4 shrink-0" /> {actionMsg}
          </div>
        )}

        {/* ── TAB: Slots ──────────────────────────────────────────────── */}
        {tab === 'active' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por tour o agencia..."
                  value={slotSearch}
                  onChange={e => setSlotSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
              <select
                value={slotStatusFilter}
                onChange={e => setSlotStatusFilter(e.target.value as typeof slotStatusFilter)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
              >
                <option value="all">Todos los estados</option>
                <option value="active">Activos</option>
                <option value="pending_payment">Pago pendiente</option>
                <option value="expired">Vencidos</option>
                <option value="cancelled">Cancelados</option>
              </select>
            </div>

            {slotsLoading ? (
              <LoadingSpinner />
            ) : filteredSlots.length === 0 ? (
              <EmptyState message="No hay slots con los filtros seleccionados." />
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Tour</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Agencia</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Plan</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Vence</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Metricas</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Monto</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredSlots.map(slot => {
                        const days = daysRemaining(slot.expires_at);
                        const stats = slot.featured_tour_stats;
                        return (
                          <tr key={slot.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900 max-w-[180px] truncate">{slot.tours?.name ?? '—'}</div>
                              <div className="text-xs text-gray-400">{slot.tours?.destination ?? ''}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 text-gray-700">
                                <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                <span className="max-w-[140px] truncate">{slot.agencies?.name ?? '—'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-gray-700">{slot.featured_plans?.name ?? '—'}</span>
                            </td>
                            <td className="px-4 py-3">{statusBadge(slot.status)}</td>
                            <td className="px-4 py-3">
                              {slot.status === 'active' ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-500 text-xs">{new Date(slot.expires_at).toLocaleDateString('es-MX')}</span>
                                  {daysRemainingBadge(days)}
                                </div>
                              ) : (
                                <span className="text-gray-400 text-xs">{new Date(slot.expires_at).toLocaleDateString('es-MX')}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3 text-xs text-gray-500">
                                <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{stats?.impressions ?? 0}</span>
                                <span className="flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" />{stats?.clicks ?? 0}</span>
                                <span className="flex items-center gap-1"><ShoppingBag className="h-3.5 w-3.5" />{stats?.bookings_generated ?? 0}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {slot.total_amount ? (
                                <span className="font-medium text-gray-900">{formatCurrency(slot.total_amount)}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {(slot.status === 'active' || slot.status === 'pending_payment') && (
                                <button
                                  onClick={() => handleCancelSlot(slot.id)}
                                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                >
                                  Cancelar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Waitlist ─────────────────────────────────────────────── */}
        {tab === 'waitlist' && (
          <div className="space-y-4">
            {waitlistLoading ? (
              <LoadingSpinner />
            ) : waitlist.length === 0 ? (
              <EmptyState message="No hay agencias en lista de espera." />
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-3 font-medium text-gray-500">#</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Tour</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Agencia</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Plan solicitado</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Fecha solicitud</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {waitlist.map(entry => (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-400 font-mono">{entry.position}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 max-w-[180px] truncate">{entry.tours?.name ?? '—'}</div>
                            <div className="text-xs text-gray-400">{entry.tours?.destination ?? ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-gray-700">
                              <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              <span>{entry.agencies?.name ?? '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{entry.featured_plans?.name ?? '—'}</td>
                          <td className="px-4 py-3">
                            <WaitlistStatusBadge status={entry.status} />
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {new Date(entry.created_at).toLocaleDateString('es-MX')}
                            {entry.notified_at && (
                              <div className="text-emerald-600">Notif: {new Date(entry.notified_at).toLocaleDateString('es-MX')}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 justify-end">
                              {entry.status === 'waiting' && (
                                <button
                                  onClick={() => handleNotify(entry)}
                                  disabled={notifyingId === entry.id}
                                  className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {notifyingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                                  Notificar
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteWaitlist(entry.id)}
                                disabled={deletingId === entry.id}
                                className="flex items-center gap-1 text-xs bg-red-50 text-red-500 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {deletingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Plans ────────────────────────────────────────────────── */}
        {tab === 'plans' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Configura los planes disponibles para que las agencias destaquen sus tours. Los cambios de precio aplican a nuevas contrataciones.
            </p>
            {plansLoading ? (
              <LoadingSpinner />
            ) : (
              <div className="space-y-3">
                {[...plans].sort((a, b) => a.display_order - b.display_order).map((plan, idx, arr) => {
                  const editing = editingPlan[plan.id];
                  return (
                    <div
                      key={plan.id}
                      className={`bg-white rounded-xl border transition-all ${
                        plan.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Reorder */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => handleReorderPlan(plan, 'up')}
                            disabled={idx === 0}
                            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-20"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleReorderPlan(plan, 'down')}
                            disabled={idx === arr.length - 1}
                            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-20"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Plan info */}
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                          {/* Name */}
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">Nombre del plan</label>
                            {editing ? (
                              <input
                                type="text"
                                value={(editing.name ?? plan.name) as string}
                                onChange={e => handlePlanFieldChange(plan.id, 'name', e.target.value)}
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                              />
                            ) : (
                              <div className="font-semibold text-gray-900">{plan.name}</div>
                            )}
                          </div>

                          {/* Duration */}
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">Duracion</label>
                            <div className="flex items-center gap-1.5 text-gray-700">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span className="text-sm">{plan.duration_days} dias</span>
                            </div>
                          </div>

                          {/* Price */}
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">Precio (IVA incluido)</label>
                            {editing ? (
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="0.01"
                                  value={editing.price ?? plan.price}
                                  onChange={e => handlePlanFieldChange(plan.id, 'price', e.target.value)}
                                  className="w-full pl-6 pr-3 py-1.5 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                                />
                              </div>
                            ) : (
                              <div className="font-bold text-gray-900 text-base">{formatCurrency(plan.price)}</div>
                            )}
                            {!editing && (
                              <div className="text-xs text-gray-400 mt-0.5">
                                Subtotal: {formatCurrency(Math.round((plan.price / 1.16) * 100) / 100)} + IVA
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Toggle active */}
                          <button
                            onClick={() => handleTogglePlan(plan)}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                              plan.is_active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                            title={plan.is_active ? 'Desactivar plan' : 'Activar plan'}
                          >
                            {plan.is_active
                              ? <><ToggleRight className="h-4 w-4" /> Activo</>
                              : <><ToggleLeft className="h-4 w-4" /> Inactivo</>
                            }
                          </button>

                          {editing ? (
                            <>
                              <button
                                onClick={() => handleSavePlan(plan)}
                                disabled={savingPlan === plan.id}
                                className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {savingPlan === plan.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditingPlan(prev => { const n = { ...prev }; delete n[plan.id]; return n; })}
                                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-100"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(plan)}
                              className="flex items-center gap-1.5 text-xs border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Settings2 className="h-3.5 w-3.5" /> Editar
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              Los cambios de precio <strong>no afectan slots ya contratados</strong>. Solo aplican a nuevas contrataciones.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  caption?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon, caption }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold text-gray-900">{value}</div>
    {caption && <div className="text-xs text-gray-400 mt-0.5">{caption}</div>}
  </div>
);

const WaitlistStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { label: string; cls: string }> = {
    waiting:  { label: 'En espera',  cls: 'bg-blue-50 text-blue-600' },
    notified: { label: 'Notificado', cls: 'bg-amber-50 text-amber-600' },
    paid:     { label: 'Pagado',     cls: 'bg-emerald-50 text-emerald-600' },
    skipped:  { label: 'Saltado',    cls: 'bg-slate-50 text-slate-500' },
    expired:  { label: 'Vencido',    cls: 'bg-slate-50 text-slate-400' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-50 text-slate-500' };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
};

const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center py-12">
    <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="text-center py-16 text-gray-400">
    <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-30" />
    <p className="text-sm">{message}</p>
  </div>
);

export default AdminFeaturedTours;
