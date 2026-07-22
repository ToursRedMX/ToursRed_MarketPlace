import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Calendar, Clock, CheckCircle, AlertCircle, RefreshCw, Upload, ShieldAlert, MapPin, Plus } from 'lucide-react';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { format } from 'date-fns';

interface AgencyPayoutSummary {
  agency_id: string;
  agency_name: string;
  total_pending_commissions: number;
  total_pending_platform_commission: number;
  total_pending_penalties: number;
  total_pending: number;
  commission_records_count: number;
  penalty_records_count: number;
  last_payout_date?: string;
  days_since_last_payout?: number;
  frequency: string;
  next_scheduled_payout?: string;
}

interface CompletedTourData {
  tour_id: string;
  tour_name: string;
  agency_id: string;
  agency_name: string;
  end_date: string;
  days_completed: number;
  bookings_count: number;
  total_revenue: number;
  commission_records_exist: boolean;
  commission_records_count: number;
  total_commission_pending: number;
  total_commission_processed: number;
  total_platform_commission_pending: number;
  total_platform_commission_processed: number;
  payment_status: 'no_commissions' | 'pending' | 'processed' | 'partial';
  ready_for_payout: boolean;
  can_create_commissions: boolean;
}

interface CompletedReceptivoSlotData {
  slot_id: string;
  tour_id: string;
  tour_name: string;
  agency_id: string;
  agency_name: string;
  slot_date: string;
  selected_time: string | null;
  days_completed: number;
  bookings_count: number;
  total_revenue: number;
  commission_records_exist: boolean;
  commission_records_count: number;
  total_commission_pending: number;
  total_commission_processed: number;
  total_platform_commission_pending: number;
  total_platform_commission_processed: number;
  payment_status: 'no_commissions' | 'pending' | 'processed' | 'partial';
  ready_for_payout: boolean;
  can_create_commissions: boolean;
}

type TourViewTab = 'excursion' | 'receptivo';

const AdminPayouts: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<'by-agency' | 'by-tour' | 'penalties'>('by-tour');
  const [tourViewTab, setTourViewTab] = useState<TourViewTab>('excursion');
  const [agencySummaries, setAgencySummaries] = useState<AgencyPayoutSummary[]>([]);
  const [completedTours, setCompletedTours] = useState<CompletedTourData[]>([]);
  const [completedReceptivoSlots, setCompletedReceptivoSlots] = useState<CompletedReceptivoSlotData[]>([]);
  const [penaltyRecords, setPenaltyRecords] = useState<any[]>([]);
  const [tourFilter, setTourFilter] = useState<'pending' | 'processed' | 'all'>('pending');
  const [penaltyFilter, setPenaltyFilter] = useState<'pending' | 'processed' | 'all'>('pending');
  const [selectedAgency, setSelectedAgency] = useState<string | null>(null);
  const [selectedTour, setSelectedTour] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedPenaltyIds, setSelectedPenaltyIds] = useState<string[]>([]);
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [showPenaltyModal, setShowPenaltyModal] = useState(false);
  const [isCreatingCommissions, setIsCreatingCommissions] = useState(false);
  const [creationMessage, setCreationMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  useEffect(() => {
    fetchPayoutData();
  }, [view]);

  const fetchPayoutData = async () => {
    try {
      setIsLoading(true);
      if (view === 'by-agency') {
        await fetchAgencyView();
      } else if (view === 'by-tour') {
        await Promise.all([fetchTourView(), fetchReceptivoSlotsView()]);
      } else {
        await fetchPenaltiesView();
      }
    } catch (error) {
      console.error('Error fetching payout data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgencyView = async () => {
    const [commissionsRes, penaltiesRes] = await Promise.all([
      supabase.from('commission_records').select('*, agencies!inner(id, name)').eq('status', 'pending'),
      supabase.from('cancellation_penalty_records').select('*, agencies!inner(id, name)').eq('status', 'pending'),
    ]);
    if (commissionsRes.error) throw commissionsRes.error;

    const agencyIds = [...new Set([
      ...(commissionsRes.data || []).map((r: any) => r.agency_id),
      ...(penaltiesRes.data || []).map((r: any) => r.agency_id),
    ])];

    const { data: payoutSchedules } = await supabase
      .from('payout_schedules').select('*').in('agency_id', agencyIds);

    const scheduleMap = new Map(payoutSchedules?.map(s => [s.agency_id, s]) || []);
    const agencyMap = new Map<string, AgencyPayoutSummary>();

    const ensureAgency = (agencyId: string, agencyName: string) => {
      if (!agencyMap.has(agencyId)) {
        const schedule = scheduleMap.get(agencyId);
        const lastPayoutDate = schedule?.last_payout_date;
        const daysSince = lastPayoutDate
          ? Math.floor((Date.now() - new Date(lastPayoutDate).getTime()) / (1000 * 60 * 60 * 24))
          : undefined;
        agencyMap.set(agencyId, {
          agency_id: agencyId, agency_name: agencyName,
          total_pending_commissions: 0, total_pending_platform_commission: 0,
          total_pending_penalties: 0, total_pending: 0,
          commission_records_count: 0, penalty_records_count: 0,
          last_payout_date: lastPayoutDate, days_since_last_payout: daysSince,
          frequency: schedule?.frequency || 'weekly',
          next_scheduled_payout: schedule?.next_scheduled_payout,
        });
      }
    };

    commissionsRes.data?.forEach((record: any) => {
      ensureAgency(record.agency_id, record.agencies.name);
      const s = agencyMap.get(record.agency_id)!;
      s.total_pending_commissions += Number(record.agency_net_amount);
      s.total_pending_platform_commission += Number(record.agency_commission_amount);
      s.commission_records_count++;
      s.total_pending += Number(record.agency_net_amount);
    });

    penaltiesRes.data?.forEach((record: any) => {
      ensureAgency(record.agency_id, record.agencies.name);
      const s = agencyMap.get(record.agency_id)!;
      s.total_pending_penalties += Number(record.agency_net_amount);
      s.penalty_records_count++;
      s.total_pending += Number(record.agency_net_amount);
    });

    setAgencySummaries(Array.from(agencyMap.values()).sort((a, b) => b.total_pending - a.total_pending));
  };

  const fetchTourView = async () => {
    const { data, error } = await supabase.rpc('get_completed_tours_with_commission_status');
    if (error) throw error;
    setCompletedTours(data || []);
  };

  const fetchReceptivoSlotsView = async () => {
    const { data, error } = await supabase.rpc('get_completed_receptivo_slots_with_commission_status');
    if (error) {
      console.error('Error fetching receptivo slots:', error);
      setCompletedReceptivoSlots([]);
      return;
    }
    setCompletedReceptivoSlots(data || []);
  };

  const fetchPenaltiesView = async () => {
    const { data, error } = await supabase
      .from('cancellation_penalty_records')
      .select(`*, agencies(name), tours(name, start_date), bookings(booking_code, user_id)`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    setPenaltyRecords(data || []);
  };

  const createCommissionRecords = async (tourId: string) => {
    setIsCreatingCommissions(true);
    setCreationMessage(null);
    try {
      const { data, error } = await supabase.rpc('create_commission_records_for_tour', { p_tour_id: tourId });
      if (error) throw error;
      if (data.success) {
        setCreationMessage({ type: 'success', text: `${data.created_count} comisiones creadas para "${data.tour_name}". ${data.skipped_count > 0 ? `${data.skipped_count} ya existían.` : ''}` });
        await fetchPayoutData();
      } else {
        setCreationMessage({ type: 'error', text: data.message || 'Error al crear comisiones' });
      }
    } catch (error: any) {
      setCreationMessage({ type: 'error', text: error.message || 'Error al crear comisiones' });
    } finally {
      setIsCreatingCommissions(false);
      setTimeout(() => setCreationMessage(null), 5000);
    }
  };

  const createReceptivoSlotCommissions = async (slotId: string) => {
    setIsCreatingCommissions(true);
    setCreationMessage(null);
    try {
      const { data, error } = await supabase.rpc('create_commission_records_for_receptivo_slot', { p_slot_id: slotId });
      if (error) throw error;
      if (data.success) {
        setCreationMessage({ type: 'success', text: `${data.created_count} comisiones creadas para "${data.tour_name}" (${data.slot_date}). ${data.skipped_count > 0 ? `${data.skipped_count} ya existían.` : ''}` });
        await fetchPayoutData();
      } else {
        setCreationMessage({ type: 'error', text: data.message || 'Error al crear comisiones' });
      }
    } catch (error: any) {
      setCreationMessage({ type: 'error', text: error.message || 'Error al crear comisiones' });
    } finally {
      setIsCreatingCommissions(false);
      setTimeout(() => setCreationMessage(null), 5000);
    }
  };

  const formatCurrency = (amount: number) => formatCurrencyMXN(amount);

  const getFrequencyBadge = (frequency: string) => {
    const labels: Record<string, string> = { weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual', custom: 'Personalizado' };
    return <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">{labels[frequency] || frequency}</span>;
  };

  const getPolicyBadge = (policyType: string) => {
    if (policyType === '50_percent') return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">50% Penalización</span>;
    return <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full font-medium">Sin Reembolso</span>;
  };

  const getPaymentStatusBadge = (tour: CompletedTourData | CompletedReceptivoSlotData) => {
    if (tour.payment_status === 'processed') return <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-medium">Pagado</span>;
    if (tour.payment_status === 'partial') return <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full font-medium">Pago Parcial</span>;
    if (tour.payment_status === 'no_commissions') return <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full font-medium">Sin Comisiones</span>;
    if (tour.ready_for_payout) return <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">Listo para Pago</span>;
    return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">En Espera</span>;
  };

  const filteredPenalties = penaltyRecords.filter(r => {
    if (penaltyFilter === 'pending') return r.status === 'pending';
    if (penaltyFilter === 'processed') return r.status === 'processed';
    return true;
  });

  const filterTours = (tours: CompletedTourData[]) => {
    if (tourFilter === 'pending') return tours.filter(t => t.payment_status === 'pending' || t.payment_status === 'partial' || t.payment_status === 'no_commissions');
    if (tourFilter === 'processed') return tours.filter(t => t.payment_status === 'processed');
    return tours;
  };

  const filterSlots = (slots: CompletedReceptivoSlotData[]) => {
    if (tourFilter === 'pending') return slots.filter(s => s.payment_status === 'pending' || s.payment_status === 'partial' || s.payment_status === 'no_commissions');
    if (tourFilter === 'processed') return slots.filter(s => s.payment_status === 'processed');
    return slots;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Gestión de Pagos</h1>
        <p className="mt-2 text-gray-600">Administra y procesa pagos a agencias</p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex gap-4 mb-6 flex-wrap">
          <button onClick={() => setView('by-agency')} className={`px-6 py-3 rounded-lg font-medium transition-colors ${view === 'by-agency' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Por Agencia</button>
          <button onClick={() => setView('by-tour')} className={`px-6 py-3 rounded-lg font-medium transition-colors ${view === 'by-tour' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Por Tour Completado</button>
          <button onClick={() => setView('penalties')} className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors ${view === 'penalties' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            <ShieldAlert className="h-4 w-4" />Penalizaciones por Cancelación
          </button>
        </div>

        {/* ── VISTA: POR AGENCIA ── */}
        {view === 'by-agency' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agencia</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">A Pagar a Agencia</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comisión ToursRed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Penalizaciones Pendientes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total a Pagar</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Último Pago</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frecuencia</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Próximo Pago</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {agencySummaries.length === 0 ? (
                  <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">No hay pagos pendientes</td></tr>
                ) : agencySummaries.map((agency) => (
                  <tr key={agency.agency_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4"><div className="text-sm font-medium text-gray-900">{agency.agency_name}</div></td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-green-700">{formatCurrency(agency.total_pending_commissions)}</div>
                      <div className="text-xs text-gray-400">{agency.commission_records_count} registros</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-blue-700">{formatCurrency(agency.total_pending_platform_commission)}</div>
                      <div className="text-xs text-gray-400">ganancia plataforma</div>
                    </td>
                    <td className="px-6 py-4">
                      {agency.total_pending_penalties > 0 ? (
                        <>
                          <div className="text-sm font-semibold text-orange-600">{formatCurrency(agency.total_pending_penalties)}</div>
                          <div className="text-xs text-gray-400">{agency.penalty_records_count} penalizaciones</div>
                        </>
                      ) : <span className="text-sm text-gray-400">-</span>}
                    </td>
                    <td className="px-6 py-4"><div className="text-sm font-bold text-blue-700">{formatCurrency(agency.total_pending)}</div></td>
                    <td className="px-6 py-4">
                      {agency.last_payout_date ? (
                        <div>
                          <div className="text-sm text-gray-900">{format(new Date(agency.last_payout_date), 'dd/MM/yyyy')}</div>
                          <div className="text-xs text-gray-500">Hace {agency.days_since_last_payout} días</div>
                        </div>
                      ) : <span className="text-sm text-gray-500">Sin pagos previos</span>}
                    </td>
                    <td className="px-6 py-4">{getFrequencyBadge(agency.frequency)}</td>
                    <td className="px-6 py-4">
                      {agency.next_scheduled_payout ? (
                        <div className="text-sm text-gray-900">{format(new Date(agency.next_scheduled_payout), 'dd/MM/yyyy')}</div>
                      ) : <span className="text-sm text-gray-500">-</span>}
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => { setSelectedAgency(agency.agency_id); setShowProcessModal(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">Procesar Pago</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── VISTA: POR TOUR COMPLETADO ── */}
        {view === 'by-tour' && (
          <div>
            {creationMessage && (
              <div className={`mb-4 p-4 rounded-lg ${creationMessage.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                <div className="flex items-center gap-2">
                  {creationMessage.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                  <p className="text-sm font-medium">{creationMessage.text}</p>
                </div>
              </div>
            )}

            {/* Sub-tabs: Excursiones vs Receptivos */}
            <div className="flex gap-3 mb-5 border-b border-gray-200">
              <button
                onClick={() => setTourViewTab('excursion')}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tourViewTab === 'excursion' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <Calendar className="h-4 w-4" />
                Excursiones
                <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${tourViewTab === 'excursion' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {filterTours(completedTours).length}
                </span>
              </button>
              <button
                onClick={() => setTourViewTab('receptivo')}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tourViewTab === 'receptivo' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <MapPin className="h-4 w-4" />
                Receptivos (por Slot)
                <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${tourViewTab === 'receptivo' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {filterSlots(completedReceptivoSlots).length}
                </span>
              </button>
            </div>

            {/* Filtros de estado */}
            <div className="flex gap-2 mb-4">
              {(['pending', 'processed', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setTourFilter(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tourFilter === f
                    ? f === 'pending' ? 'bg-yellow-500 text-white' : f === 'processed' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'pending' ? 'Pendientes de Pago' : f === 'processed' ? 'Pagados' : 'Todos'}
                </button>
              ))}
            </div>

            {/* Tabla de Excursiones */}
            {tourViewTab === 'excursion' && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tour</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agencia</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Fin</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dias Completado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reservas</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">A Pagar</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comisión ToursRed</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(() => {
                      const filtered = filterTours(completedTours);
                      if (filtered.length === 0) return (
                        <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                          {tourFilter === 'processed' ? 'No hay excursiones con pagos procesados' : tourFilter === 'pending' ? 'No hay excursiones pendientes de pago' : 'No hay excursiones completadas'}
                        </td></tr>
                      );
                      return filtered.map((tour) => (
                        <tr key={tour.tour_id} className="hover:bg-gray-50">
                          <td className="px-6 py-4"><div className="text-sm font-medium text-gray-900">{tour.tour_name}</div></td>
                          <td className="px-6 py-4"><div className="text-sm text-gray-900">{tour.agency_name}</div></td>
                          <td className="px-6 py-4"><div className="text-sm text-gray-900">{format(new Date(tour.end_date), 'dd/MM/yyyy')}</div></td>
                          <td className="px-6 py-4"><div className="text-sm text-gray-900">{tour.days_completed} dias</div></td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">{tour.bookings_count}</div>
                            {tour.commission_records_exist && <div className="text-xs text-gray-500">{tour.commission_records_count} comisiones</div>}
                          </td>
                          <td className="px-6 py-4">
                            {tour.payment_status === 'processed' ? (
                              <div><div className="text-sm font-bold text-blue-600">{formatCurrency(tour.total_commission_processed)}</div><div className="text-xs text-gray-400">pagado</div></div>
                            ) : tour.commission_records_exist ? (
                              <div>
                                <div className="text-sm font-bold text-green-600">{formatCurrency(tour.total_commission_pending)}</div>
                                {tour.payment_status === 'partial' && <div className="text-xs text-gray-400">+{formatCurrency(tour.total_commission_processed)} pagado</div>}
                              </div>
                            ) : <span className="text-sm text-gray-400">-</span>}
                          </td>
                          <td className="px-6 py-4">
                            {tour.commission_records_exist ? (
                              <div>
                                {tour.payment_status === 'processed' ? (
                                  <div><div className="text-sm font-bold text-blue-700">{formatCurrency(tour.total_platform_commission_processed)}</div><div className="text-xs text-gray-400">cobrada</div></div>
                                ) : (
                                  <div>
                                    <div className="text-sm font-bold text-blue-700">{formatCurrency(tour.total_platform_commission_pending)}</div>
                                    {tour.payment_status === 'partial' && <div className="text-xs text-gray-400">+{formatCurrency(tour.total_platform_commission_processed)} cobrada</div>}
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-sm text-gray-400">-</span>}
                          </td>
                          <td className="px-6 py-4">{getPaymentStatusBadge(tour)}</td>
                          <td className="px-6 py-4">
                            {tour.payment_status === 'processed' ? (
                              <div className="flex items-center gap-2 text-sm text-blue-600"><CheckCircle className="h-4 w-4" /><span>Completado</span></div>
                            ) : !tour.commission_records_exist && tour.can_create_commissions ? (
                              <button onClick={() => createCommissionRecords(tour.tour_id)} disabled={isCreatingCommissions} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                                {isCreatingCommissions ? <><RefreshCw className="h-4 w-4 animate-spin" />Creando...</> : <><Plus className="h-4 w-4" />Crear Comisiones</>}
                              </button>
                            ) : tour.ready_for_payout ? (
                              <button onClick={() => { setSelectedTour(tour.tour_id); setSelectedAgency(tour.agency_id); setShowProcessModal(true); }} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium">
                                <DollarSign className="h-4 w-4" />Procesar Pago
                              </button>
                            ) : tour.commission_records_exist && tour.payment_status === 'pending' ? (
                              <div className="flex items-center gap-2 text-sm text-gray-500"><Clock className="h-4 w-4" /><span>Esperando {3 - tour.days_completed} dias</span></div>
                            ) : <span className="text-sm text-gray-400">-</span>}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tabla de Slots Receptivos */}
            {tourViewTab === 'receptivo' && (
              <div>
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    Los tours receptivos se pagan por <strong>salida completada</strong>. Cada fila representa una fecha de operacion con sus reservas confirmadas.
                    Las comisiones se generan automaticamente a las 02:00 hrs del dia siguiente a cada salida.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tour</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agencia</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha de Salida</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dias Completado</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reservas</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">A Pagar</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comisión ToursRed</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(() => {
                        const filtered = filterSlots(completedReceptivoSlots);
                        if (filtered.length === 0) return (
                          <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                            {tourFilter === 'processed' ? 'No hay salidas receptivas con pagos procesados' : tourFilter === 'pending' ? 'No hay salidas receptivas pendientes de pago' : 'No hay salidas receptivas completadas'}
                          </td></tr>
                        );
                        return filtered.map((slot) => (
                          <tr key={slot.slot_id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">{slot.tour_name}</div>
                              <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                <MapPin className="h-3 w-3" />Receptivo
                              </div>
                            </td>
                            <td className="px-6 py-4"><div className="text-sm text-gray-900">{slot.agency_name}</div></td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">{format(new Date(slot.slot_date), 'dd/MM/yyyy')}</div>
                              {slot.selected_time && <div className="text-xs text-gray-500">{slot.selected_time.slice(0, 5)} hrs</div>}
                            </td>
                            <td className="px-6 py-4"><div className="text-sm text-gray-900">{slot.days_completed} dias</div></td>
                            <td className="px-6 py-4">
                              <div className="text-sm text-gray-900">{slot.bookings_count}</div>
                              {slot.commission_records_exist && <div className="text-xs text-gray-500">{slot.commission_records_count} comisiones</div>}
                            </td>
                            <td className="px-6 py-4">
                              {slot.payment_status === 'processed' ? (
                                <div><div className="text-sm font-bold text-blue-600">{formatCurrency(slot.total_commission_processed)}</div><div className="text-xs text-gray-400">pagado</div></div>
                              ) : slot.commission_records_exist ? (
                                <div>
                                  <div className="text-sm font-bold text-green-600">{formatCurrency(slot.total_commission_pending)}</div>
                                  {slot.payment_status === 'partial' && <div className="text-xs text-gray-400">+{formatCurrency(slot.total_commission_processed)} pagado</div>}
                                </div>
                              ) : <span className="text-sm text-gray-400">-</span>}
                            </td>
                            <td className="px-6 py-4">
                              {slot.commission_records_exist ? (
                                <div>
                                  {slot.payment_status === 'processed' ? (
                                    <div><div className="text-sm font-bold text-blue-700">{formatCurrency(slot.total_platform_commission_processed)}</div><div className="text-xs text-gray-400">cobrada</div></div>
                                  ) : (
                                    <div>
                                      <div className="text-sm font-bold text-blue-700">{formatCurrency(slot.total_platform_commission_pending)}</div>
                                      {slot.payment_status === 'partial' && <div className="text-xs text-gray-400">+{formatCurrency(slot.total_platform_commission_processed)} cobrada</div>}
                                    </div>
                                  )}
                                </div>
                              ) : <span className="text-sm text-gray-400">-</span>}
                            </td>
                            <td className="px-6 py-4">{getPaymentStatusBadge(slot)}</td>
                            <td className="px-6 py-4">
                              {slot.payment_status === 'processed' ? (
                                <div className="flex items-center gap-2 text-sm text-blue-600"><CheckCircle className="h-4 w-4" /><span>Completado</span></div>
                              ) : !slot.commission_records_exist && slot.can_create_commissions ? (
                                <button onClick={() => createReceptivoSlotCommissions(slot.slot_id)} disabled={isCreatingCommissions} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                                  {isCreatingCommissions ? <><RefreshCw className="h-4 w-4 animate-spin" />Creando...</> : <><Plus className="h-4 w-4" />Crear Comisiones</>}
                                </button>
                              ) : slot.ready_for_payout ? (
                                <button onClick={() => { setSelectedSlot(slot.slot_id); setSelectedAgency(slot.agency_id); setShowProcessModal(true); }} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium">
                                  <DollarSign className="h-4 w-4" />Procesar Pago
                                </button>
                              ) : slot.commission_records_exist && slot.payment_status === 'pending' ? (
                                <div className="flex items-center gap-2 text-sm text-gray-500"><Clock className="h-4 w-4" /><span>Esperando {3 - slot.days_completed} dias</span></div>
                              ) : <span className="text-sm text-gray-400">-</span>}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── VISTA: PENALIZACIONES ── */}
        {view === 'penalties' && (
          <div>
            <div className="flex gap-2 mb-4">
              {(['pending', 'processed', 'all'] as const).map((f) => (
                <button key={f} onClick={() => setPenaltyFilter(f)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${penaltyFilter === f
                  ? f === 'pending' ? 'bg-orange-500 text-white' : f === 'processed' ? 'bg-green-600 text-white' : 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                  {f === 'pending' ? 'Pendientes' : f === 'processed' ? 'Pagadas' : 'Todas'}
                </button>
              ))}
            </div>

            {filteredPenalties.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <ShieldAlert className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No hay penalizaciones {penaltyFilter === 'pending' ? 'pendientes' : penaltyFilter === 'processed' ? 'pagadas' : ''}</p>
                <p className="text-sm text-gray-400 mt-2">Las penalizaciones se generan automaticamente cuando un viajero cancela con politica de 50% o sin reembolso.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agencia</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tour</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Política</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto Bruto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Neto Agencia</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredPenalties.map((record) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">{format(new Date(record.created_at), 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{record.agencies?.name || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{record.tours?.name || '-'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full font-medium ${record.cancellation_type === 'full' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {record.cancellation_type === 'full' ? 'Total' : 'Parcial'}
                          </span>
                        </td>
                        <td className="px-6 py-4">{getPolicyBadge(record.cancellation_policy_type)}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">{formatCurrency(Number(record.gross_penalty))}</td>
                        <td className="px-6 py-4 text-sm font-bold text-orange-700">{formatCurrency(Number(record.agency_net_amount))}</td>
                        <td className="px-6 py-4">
                          {record.status === 'pending'
                            ? <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">Pendiente</span>
                            : <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">Pagada</span>}
                        </td>
                        <td className="px-6 py-4">
                          {record.status === 'pending' ? (
                            <button onClick={() => { setSelectedPenaltyIds([record.id]); setSelectedAgency(record.agency_id); setShowPenaltyModal(true); }} className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 text-sm font-medium">
                              <DollarSign className="h-4 w-4" />Pagar
                            </button>
                          ) : (
                            <div className="text-sm text-gray-500">{record.processed_at ? format(new Date(record.processed_at), 'dd/MM/yyyy') : '-'}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr className="font-bold">
                      <td colSpan={5} className="px-6 py-4 text-sm text-gray-900">TOTALES</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatCurrency(filteredPenalties.reduce((s, r) => s + Number(r.gross_penalty), 0))}</td>
                      <td className="px-6 py-4 text-sm text-orange-700">{formatCurrency(filteredPenalties.reduce((s, r) => s + Number(r.agency_net_amount), 0))}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showProcessModal && (
        <ProcessPaymentModal
          isOpen={showProcessModal}
          onClose={() => { setShowProcessModal(false); setSelectedAgency(null); setSelectedTour(null); setSelectedSlot(null); }}
          agencyId={selectedAgency}
          tourId={selectedTour}
          slotId={selectedSlot}
          onSuccess={async () => { await fetchPayoutData(); setShowProcessModal(false); setSelectedAgency(null); setSelectedTour(null); setSelectedSlot(null); }}
        />
      )}

      {showPenaltyModal && (
        <ProcessPenaltyModal
          isOpen={showPenaltyModal}
          penaltyIds={selectedPenaltyIds}
          onClose={() => { setShowPenaltyModal(false); setSelectedPenaltyIds([]); setSelectedAgency(null); }}
          onSuccess={async () => { await fetchPayoutData(); setShowPenaltyModal(false); setSelectedPenaltyIds([]); setSelectedAgency(null); }}
        />
      )}
    </div>
  );
};

interface ProcessPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agencyId: string | null;
  tourId: string | null;
  slotId: string | null;
  onSuccess: () => void;
}

const ProcessPaymentModal: React.FC<ProcessPaymentModalProps> = ({ isOpen, onClose, agencyId, tourId, slotId, onSuccess }) => {
  const formatCurrency = (amount: number) => formatCurrencyMXN(amount);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'check' | 'paypal' | 'mercadopago' | 'other'>('bank_transfer');
  const [billNumber, setBillNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadPaymentDetails = async () => {
      if (!isOpen) return;
      try {
        let query = supabase.from('commission_records').select('*, agencies!inner(id, name), tours!inner(id, name)').eq('status', 'pending');

        if (slotId) {
          const { data: slotBookings } = await supabase.from('bookings').select('id').eq('slot_id', slotId);
          const bookingIds = (slotBookings || []).map((b: any) => b.id);
          if (bookingIds.length > 0) {
            query = query.in('booking_id', bookingIds);
          }
        } else if (tourId) {
          query = query.eq('tour_id', tourId);
        } else if (agencyId) {
          query = query.eq('agency_id', agencyId);
        }

        const { data, error } = await query;
        if (error) throw error;

        let penaltyQuery = supabase.from('cancellation_penalty_records').select('*, agencies!inner(id, name)').eq('status', 'pending');
        if (agencyId) penaltyQuery = penaltyQuery.eq('agency_id', agencyId);
        const { data: penalties } = await penaltyQuery;

        const commissionTotal = data?.reduce((sum, r) => sum + Number(r.agency_net_amount), 0) || 0;
        const platformCommissionTotal = data?.reduce((sum, r) => sum + Number(r.agency_commission_amount), 0) || 0;
        const totalTourPrice = data?.reduce((sum, r) => sum + Number(r.total_tour_price), 0) || 0;
        const penaltyTotal = slotId ? 0 : (penalties?.reduce((sum, r) => sum + Number(r.agency_net_amount), 0) || 0);

        setPaymentDetails({
          records: data,
          penalties: slotId ? [] : (penalties || []),
          totalAmount: commissionTotal + penaltyTotal,
          commissionTotal, platformCommissionTotal, totalTourPrice, penaltyTotal,
          recordsCount: data?.length || 0,
          penaltiesCount: slotId ? 0 : (penalties?.length || 0),
          agencyName: data?.[0]?.agencies?.name || penalties?.[0]?.agencies?.name || '',
          tourName: data?.[0]?.tours?.name || '',
          isSlotPayment: !!slotId,
        });
      } catch (error) {
        console.error('Error fetching payment details:', error);
      }
    };
    loadPaymentDetails();
  }, [isOpen, agencyId, tourId, slotId]);

  const processPayment = async () => {
    if (!paymentDetails) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      let receiptUrl = null;
      let receiptFilename = null;
      if (receiptFile) {
        setUploadingReceipt(true);
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${agencyId || tourId || slotId}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(fileName, receiptFile);
        if (uploadError) throw new Error('Error al subir comprobante: ' + uploadError.message);
        const { data: { publicUrl } } = supabase.storage.from('payment-receipts').getPublicUrl(fileName);
        receiptUrl = publicUrl;
        receiptFilename = receiptFile.name;
        setUploadingReceipt(false);
      }

      if (paymentDetails.records?.length > 0) {
        const commissionIds = paymentDetails.records.map((r: any) => r.id);
        const { error: updateError } = await supabase.from('commission_records').update({
          status: 'processed', processed_at: new Date().toISOString(),
          payment_method: paymentMethod, payment_notes: notes || null,
          payment_receipt_url: receiptUrl, payment_receipt_filename: receiptFilename,
          notified_at: new Date().toISOString()
        }).in('id', commissionIds);
        if (updateError) throw updateError;
      }

      if (paymentDetails.penalties?.length > 0) {
        const penaltyIds = paymentDetails.penalties.map((r: any) => r.id);
        const { error: penaltyUpdateError } = await supabase.from('cancellation_penalty_records').update({
          status: 'processed', processed_at: new Date().toISOString(),
          payment_method: paymentMethod, payment_notes: notes || null,
          payment_receipt_url: receiptUrl, payment_receipt_filename: receiptFilename,
        }).in('id', penaltyIds);
        if (penaltyUpdateError) throw penaltyUpdateError;
      }

      const agencyIdToNotify = agencyId || paymentDetails.records?.[0]?.agency_id;
      if (agencyIdToNotify && paymentDetails.records?.length > 0) {
        await supabase.functions.invoke('send-payout-confirmation', {
          body: {
            agency_id: agencyIdToNotify,
            commission_ids: paymentDetails.records.map((r: any) => r.id),
            total_amount: paymentDetails.totalAmount,
            payment_method: paymentMethod, payment_notes: notes, receipt_url: receiptUrl
          }
        });

        try {
          const { data: cfdiSettings } = await supabase
            .from('platform_settings')
            .select('pac_provider')
            .maybeSingle();
          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== 'none') {
            const payoutCode = `PAY-${Date.now()}`;
            const { data: newPayout } = await supabase
              .from('agency_payouts')
              .insert({
                agency_id: agencyIdToNotify,
                amount: paymentDetails.totalAmount,
                net_amount: paymentDetails.totalAmount,
                platform_commission_amount: paymentDetails.platformCommissionTotal,
                payment_method: paymentMethod,
                notes: notes || null,
                receipt_url: receiptUrl || null,
                payout_code: payoutCode,
                bill_number: billNumber.trim() || null,
                status: 'completed',
                commission_records_count: paymentDetails.records?.length || 0,
              })
              .select('id')
              .single();
            if (newPayout?.id) {
              await supabase.functions.invoke('generate-commission-cfdi', {
                body: { payout_id: newPayout.id }
              });
              // Sync payout to accounting system (fire and forget)
              supabase.functions.invoke('sync-payout-to-accounting', {
                body: { payout_id: newPayout.id }
              }).catch((err) => console.error('Error syncing payout to accounting:', err));
            }
          }
        } catch (cfdiErr) {
          console.error('Error triggering commission CFDI:', cfdiErr);
        }
      }

      onSuccess();
    } catch (error: any) {
      setErrorMessage(error.message || 'Error desconocido al procesar el pago');
    } finally {
      setIsProcessing(false);
      setUploadingReceipt(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="mb-6">
          <h3 className="text-2xl font-bold text-gray-900">Procesar Pago</h3>
          {paymentDetails && (
            <p className="mt-2 text-gray-600">
              {paymentDetails.isSlotPayment ? `Salida receptiva: ${paymentDetails.tourName}` : tourId ? `Tour: ${paymentDetails.tourName}` : `Agencia: ${paymentDetails.agencyName}`}
            </p>
          )}
        </div>

        {paymentDetails ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800">Total a transferir a la agencia</p>
                    <p className="text-xs text-green-600 mt-0.5">{paymentDetails.recordsCount} registros{paymentDetails.penaltiesCount > 0 ? ` + ${paymentDetails.penaltiesCount} penalizaciones` : ''}</p>
                  </div>
                  <p className="text-3xl font-bold text-green-700">{formatCurrency(paymentDetails.totalAmount)}</p>
                </div>
              </div>

              {paymentDetails.recordsCount > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Desglose</p>
                  {paymentDetails.totalTourPrice > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Precio total cobrado a viajeros</span>
                      <span className="font-medium text-gray-800">{formatCurrency(paymentDetails.totalTourPrice)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Comisión retenida por ToursRed</span>
                    <span className="font-semibold text-blue-700">− {formatCurrency(paymentDetails.platformCommissionTotal)}</span>
                  </div>
                  <div className="border-t border-gray-300 pt-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">Neto a pagar</span>
                    <span className="font-bold text-green-700">{formatCurrency(paymentDetails.commissionTotal)}</span>
                  </div>
                  {paymentDetails.penaltyTotal > 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-gray-300 pt-2">
                      <span className="text-gray-600">Penalizaciones por cancelación</span>
                      <span className="font-semibold text-orange-600">{formatCurrency(paymentDetails.penaltyTotal)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Método de Pago</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="bank_transfer">Transferencia Bancaria</option>
                <option value="check">Cheque</option>
                <option value="paypal">PayPal</option>
                <option value="mercadopago">Mercado Pago</option>
                <option value="other">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                No. de Factura / Referencia Contable <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">Se usará como número de factura proveedor en Zoho Books. Ej: P2, FAC-001.</p>
              <input
                type="text"
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
                placeholder="Ej: P2"
                maxLength={32}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Comprobante de Pago (opcional)</label>
              <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
              <p className="mt-1 text-xs text-gray-500">Formatos permitidos: JPG, PNG, PDF</p>
              {receiptFile && <p className="mt-2 text-sm text-green-600">Archivo seleccionado: {receiptFile.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notas (opcional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Agregar notas sobre este pago..." />
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">Al confirmar, los registros se marcarán como procesados. Asegúrate de haber realizado la transferencia antes de continuar.</p>
              </div>
            </div>

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-800"><p className="font-medium mb-1">Error:</p><p>{errorMessage}</p></div>
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={onClose} disabled={isProcessing} className="flex-1 bg-gray-200 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-300 font-medium disabled:opacity-50">Cancelar</button>
              <button onClick={processPayment} disabled={isProcessing || uploadingReceipt} className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {uploadingReceipt ? <><Upload className="h-5 w-5 animate-pulse" />Subiendo...</> : isProcessing ? <><RefreshCw className="h-5 w-5 animate-spin" />Procesando...</> : <><CheckCircle className="h-5 w-5" />Confirmar Pago</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12"><RefreshCw className="h-8 w-8 animate-spin text-blue-600" /></div>
        )}
      </div>
    </div>
  );
};

interface ProcessPenaltyModalProps {
  isOpen: boolean;
  penaltyIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const ProcessPenaltyModal: React.FC<ProcessPenaltyModalProps> = ({ isOpen, penaltyIds, onClose, onSuccess }) => {
  const formatCurrency = (amount: number) => formatCurrencyMXN(amount);
  const [isProcessing, setIsProcessing] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'check' | 'paypal' | 'mercadopago' | 'other'>('bank_transfer');
  const [notes, setNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!isOpen || penaltyIds.length === 0) return;
      const { data } = await supabase.from('cancellation_penalty_records').select('*, agencies(name), tours(name)').in('id', penaltyIds);
      const total = data?.reduce((s, r) => s + Number(r.agency_net_amount), 0) || 0;
      setDetails({ records: data, total, agencyName: data?.[0]?.agencies?.name || '' });
    };
    load();
  }, [isOpen, penaltyIds]);

  const processPayment = async () => {
    if (!details) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      let receiptUrl = null;
      let receiptFilename = null;
      if (receiptFile) {
        setUploadingReceipt(true);
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `penalty_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(fileName, receiptFile);
        if (uploadError) throw new Error('Error al subir comprobante: ' + uploadError.message);
        const { data: { publicUrl } } = supabase.storage.from('payment-receipts').getPublicUrl(fileName);
        receiptUrl = publicUrl;
        receiptFilename = receiptFile.name;
        setUploadingReceipt(false);
      }
      const { error } = await supabase.from('cancellation_penalty_records').update({
        status: 'processed', processed_at: new Date().toISOString(),
        payment_method: paymentMethod, payment_notes: notes || null,
        payment_receipt_url: receiptUrl, payment_receipt_filename: receiptFilename,
      }).in('id', penaltyIds);
      if (error) throw error;
      onSuccess();
    } catch (error: any) {
      setErrorMessage(error.message || 'Error al procesar el pago');
    } finally {
      setIsProcessing(false);
      setUploadingReceipt(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="mb-6">
          <h3 className="text-2xl font-bold text-gray-900">Pagar Penalización</h3>
          {details && <p className="mt-2 text-gray-600">Agencia: {details.agencyName}</p>}
        </div>
        {details ? (
          <div className="space-y-5">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-gray-600">Total de Penalización a Pagar</p>
              <p className="text-2xl font-bold text-orange-600">{formatCurrency(details.total)}</p>
              <p className="text-xs text-gray-500 mt-1">{penaltyIds.length} registro(s)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Método de Pago</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="bank_transfer">Transferencia Bancaria</option>
                <option value="check">Cheque</option>
                <option value="paypal">PayPal</option>
                <option value="mercadopago">Mercado Pago</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Comprobante (opcional)</label>
              <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
              {receiptFile && <p className="mt-2 text-sm text-green-600">{receiptFile.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notas (opcional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Notas adicionales..." />
            </div>
            {errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                <AlertCircle className="h-4 w-4 inline mr-2" />{errorMessage}
              </div>
            )}
            <div className="flex gap-4">
              <button onClick={onClose} disabled={isProcessing} className="flex-1 bg-gray-200 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-300 font-medium disabled:opacity-50">Cancelar</button>
              <button onClick={processPayment} disabled={isProcessing || uploadingReceipt} className="flex-1 bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {uploadingReceipt ? <><Upload className="h-5 w-5 animate-pulse" />Subiendo...</> : isProcessing ? <><RefreshCw className="h-5 w-5 animate-spin" />Procesando...</> : <><CheckCircle className="h-5 w-5" />Confirmar Pago</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12"><RefreshCw className="h-8 w-8 animate-spin text-orange-600" /></div>
        )}
      </div>
    </div>
  );
};

export default AdminPayouts;
