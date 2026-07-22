import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, CheckCircle, XCircle, Eye, Download,
  AlertCircle, X, Search, FileText, Play, Calendar
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

interface Commission {
  id: string;
  executive_id: string;
  agency_id: string | null;
  commission_type: string;
  amount: number;
  period_month: number | null;
  period_year: number | null;
  status: string;
  cfdi_xml_url: string | null;
  cfdi_uuid_fiscal: string | null;
  cfdi_total: number | null;
  cfdi_uploaded_at: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  account_executives: { first_name: string; last_name: string; email: string } | null;
  agencies: { name: string } | null;
}

const TYPE_LABELS: Record<string, string> = {
  approval: 'Aprobación de agencia',
  first_tour_and_booking: 'Primer tour y reserva',
  platform_period: 'Comisión de periodo',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pendiente', color: 'text-gray-600', bg: 'bg-gray-100' },
  invoiced: { label: 'CFDI enviado', color: 'text-blue-700', bg: 'bg-blue-100' },
  approved: { label: 'Aprobado', color: 'text-green-700', bg: 'bg-green-100' },
  paid: { label: 'Pagado', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  rejected: { label: 'Rechazado', color: 'text-red-700', bg: 'bg-red-100' },
};

type StatusFilter = 'all' | 'invoiced' | 'approved' | 'paid' | 'pending' | 'rejected';

export default function AdminEjecutivosComisiones() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('invoiced');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Commission | null>(null);
  const [reviewModal, setReviewModal] = useState<{ commission: Commission; action: 'approve' | 'reject' | 'pay' } | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estado para generación de comisiones mensuales
  const currentDate = new Date();
  const [genMonth, setGenMonth] = useState(currentDate.getMonth() + 1);
  const [genYear, setGenYear] = useState(currentDate.getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenPanel, setShowGenPanel] = useState(false);

  const loadCommissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('executive_commissions')
        .select(`
          id, executive_id, agency_id, commission_type, amount,
          period_month, period_year, status,
          cfdi_xml_url, cfdi_uuid_fiscal, cfdi_total, cfdi_uploaded_at,
          payment_reference, paid_at,
          rejection_reason, notes, created_at,
          account_executives(first_name, last_name, email),
          agencies(name)
        `)
        .order('created_at', { ascending: false });
      setCommissions((data as any[]) || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadCommissions(); }, [loadCommissions]);

  const filteredCommissions = commissions.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const execName = `${c.account_executives?.first_name} ${c.account_executives?.last_name}`.toLowerCase();
    const agencyName = (c.agencies?.name || '').toLowerCase();
    return execName.includes(q) || agencyName.includes(q) || (c.cfdi_uuid_fiscal || '').toLowerCase().includes(q);
  });

  const counts = {
    all: commissions.length,
    invoiced: commissions.filter(c => c.status === 'invoiced').length,
    approved: commissions.filter(c => c.status === 'approved').length,
    paid: commissions.filter(c => c.status === 'paid').length,
    pending: commissions.filter(c => c.status === 'pending').length,
    rejected: commissions.filter(c => c.status === 'rejected').length,
  };

  const handleAction = async () => {
    if (!reviewModal) return;
    setIsSubmitting(true);
    try {
      const { commission, action } = reviewModal;

      if (action === 'approve') {
        const { error } = await supabase
          .from('executive_commissions')
          .update({ status: 'approved' })
          .eq('id', commission.id);
        if (error) throw error;
        setMessage({ type: 'success', text: 'CFDI aprobado. La comisión está lista para pago.' });
      } else if (action === 'reject') {
        if (!rejectionReason.trim()) {
          setMessage({ type: 'error', text: 'Debes indicar el motivo del rechazo.' });
          setIsSubmitting(false);
          return;
        }
        const { error } = await supabase
          .from('executive_commissions')
          .update({ status: 'rejected', rejection_reason: rejectionReason })
          .eq('id', commission.id);
        if (error) throw error;
        setMessage({ type: 'success', text: 'CFDI rechazado. El ejecutivo deberá corregir y reenviar.' });
      } else if (action === 'pay') {
        if (!paymentRef.trim()) {
          setMessage({ type: 'error', text: 'Debes indicar la referencia del pago.' });
          setIsSubmitting(false);
          return;
        }
        const { error } = await supabase
          .from('executive_commissions')
          .update({
            status: 'paid',
            payment_reference: paymentRef || null,
            paid_at: new Date().toISOString(),
          })
          .eq('id', commission.id);
        if (error) throw error;
        setMessage({ type: 'success', text: 'Pago registrado exitosamente.' });
      }

      setReviewModal(null);
      setPaymentRef('');
      setRejectionReason('');
      loadCommissions();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al procesar la acción.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openExecutiveFile = async (commissionId: string, fileType: 'xml' | 'pdf', uuid?: string | null) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-executive-cfdi?commission_id=${commissionId}&file_type=${fileType}`;
      const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (fileType === 'pdf') {
        window.open(objectUrl, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = uuid ? `CFDI-${uuid}.xml` : `CFDI-${commissionId}.xml`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch {
      // silenciar error de descarga
    }
  };

  const generatePlatformCommissions = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.rpc('generate_and_notify_platform_commissions', {
        p_month: genMonth,
        p_year: genYear,
      });
      if (error) throw error;
      const count = data as number;
      if (count === 0) {
        setMessage({ type: 'success', text: `No hay comisiones nuevas para ${genMonth}/${genYear}. Ya estaban generadas o no hubo actividad en ese período.` });
      } else {
        setMessage({ type: 'success', text: `Se generaron ${count} comisión(es) para ${genMonth}/${genYear}. Los ejecutivos ya recibieron su notificación por correo.` });
      }
      setShowGenPanel(false);
      loadCommissions();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al generar comisiones.' });
    } finally {
      setIsGenerating(false);
    }
  };

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'invoiced', label: 'CFDI Enviado' },
    { key: 'approved', label: 'Aprobados' },
    { key: 'paid', label: 'Pagados' },
    { key: 'pending', label: 'Pendientes' },
    { key: 'rejected', label: 'Rechazados' },
    { key: 'all', label: 'Todos' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comisiones de Ejecutivos</h1>
          <p className="text-gray-500 mt-1">Revisión y aprobación de CFDIs, registro de pagos</p>
        </div>
        <button
          onClick={() => setShowGenPanel(prev => !prev)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Generar comisiones mensuales
        </button>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Panel generación de comisiones mensuales */}
      {showGenPanel && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Generar comisiones de periodo</h3>
                <p className="text-sm text-gray-400">Calcula e inserta las comisiones de plataforma del mes seleccionado y notifica a los ejecutivos</p>
              </div>
            </div>
            <button onClick={() => setShowGenPanel(false)}><X className="h-5 w-5 text-gray-400" /></button>
          </div>

          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Mes</label>
              <select
                value={genMonth}
                onChange={e => setGenMonth(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Año</label>
              <select
                value={genYear}
                onChange={e => setGenYear(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {[currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={generatePlatformCommissions}
              disabled={isGenerating}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Play className="h-4 w-4" />
              {isGenerating ? 'Generando...' : 'Generar y notificar'}
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            Al ejecutar, se insertan las comisiones nuevas y se envía un correo de resumen a cada ejecutivo con el detalle de sus agencias. Las comisiones ya generadas para ese mes se omiten.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">CFDIs pendientes revisión</p>
          <p className="text-2xl font-bold text-blue-600">{counts.invoiced}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Aprobados sin pagar</p>
          <p className="text-2xl font-bold text-amber-600">{counts.approved}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Pagados este año</p>
          <p className="text-2xl font-bold text-green-600">{counts.paid}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total histórico registros</p>
          <p className="text-2xl font-bold text-gray-700">{counts.all}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-100">
          <div className="flex gap-1 flex-wrap">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === tab.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {tab.label}
                {counts[tab.key] > 0 && (
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {counts[tab.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar ejecutivo, agencia..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredCommissions.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <DollarSign className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No hay comisiones que mostrar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Ejecutivo</th>
                  <th className="px-4 py-3 font-medium">Agencia</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium text-right">Monto</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">CFDI</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredCommissions.map(comm => {
                  const exec = comm.account_executives;
                  const cfg = STATUS_CONFIG[comm.status] || STATUS_CONFIG.pending;
                  return (
                    <tr key={comm.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{exec ? `${exec.first_name} ${exec.last_name}` : '—'}</p>
                        <p className="text-xs text-gray-400">{exec?.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{comm.agencies?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-700">{TYPE_LABELS[comm.commission_type] || comm.commission_type}</span>
                        {comm.period_month && (
                          <p className="text-xs text-gray-400">{comm.period_month}/{comm.period_year}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrencyMXN(comm.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs font-medium px-2 py-1 rounded-full ${cfg.color} ${cfg.bg}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {comm.cfdi_xml_url ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openExecutiveFile(comm.id, 'xml', comm.cfdi_uuid_fiscal)}
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Descargar XML"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => openExecutiveFile(comm.id, 'pdf', comm.cfdi_uuid_fiscal)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Ver/Descargar PDF"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">Sin CFDI</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(comm.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {comm.status === 'invoiced' && (
                            <>
                              <button
                                onClick={() => { setReviewModal({ commission: comm, action: 'approve' }); setRejectionReason(''); }}
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                title="Aprobar CFDI"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setReviewModal({ commission: comm, action: 'reject' }); setRejectionReason(''); }}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Rechazar CFDI"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {comm.status === 'approved' && (
                            <button
                              onClick={() => { setReviewModal({ commission: comm, action: 'pay' }); setPaymentRef(''); }}
                              className="px-2.5 py-1 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                            >
                              Registrar pago
                            </button>
                          )}
                          <button
                            onClick={() => setSelected(selected?.id === comm.id ? null : comm)}
                            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Ver detalle"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Detalle de comisión</h3>
            <button onClick={() => setSelected(null)}>
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Ejecutivo</p>
              <p className="font-medium text-gray-900">
                {selected.account_executives ? `${selected.account_executives.first_name} ${selected.account_executives.last_name}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Agencia</p>
              <p className="font-medium text-gray-900">{selected.agencies?.name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Tipo</p>
              <p className="font-medium text-gray-900">{TYPE_LABELS[selected.commission_type] || selected.commission_type}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Monto comisión</p>
              <p className="font-bold text-gray-900">{formatCurrencyMXN(selected.amount)}</p>
            </div>
            {selected.cfdi_total && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total CFDI</p>
                <p className="font-medium text-gray-900">{formatCurrencyMXN(selected.cfdi_total)}</p>
              </div>
            )}
            {selected.cfdi_uuid_fiscal && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">UUID Fiscal</p>
                <p className="font-mono text-xs text-gray-700 break-all">{selected.cfdi_uuid_fiscal}</p>
              </div>
            )}
            {selected.cfdi_uploaded_at && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">CFDI enviado</p>
                <p className="text-gray-700">{new Date(selected.cfdi_uploaded_at).toLocaleDateString('es-MX')}</p>
              </div>
            )}
            {selected.payment_method && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Método de pago</p>
                <p className="text-gray-700">{selected.payment_method}</p>
              </div>
            )}
            {selected.payment_reference && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Referencia</p>
                <p className="font-mono text-xs text-gray-700">{selected.payment_reference}</p>
              </div>
            )}
            {selected.paid_at && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Pagado el</p>
                <p className="text-gray-700">{new Date(selected.paid_at).toLocaleDateString('es-MX')}</p>
              </div>
            )}
            {selected.rejection_reason && (
              <div className="col-span-full">
                <p className="text-xs text-gray-500 mb-0.5">Motivo de rechazo</p>
                <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{selected.rejection_reason}</p>
              </div>
            )}
            {selected.notes && (
              <div className="col-span-full">
                <p className="text-xs text-gray-500 mb-0.5">Notas</p>
                <p className="text-gray-700">{selected.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action modal */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">
              {reviewModal.action === 'approve' && (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Aprobar CFDI</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Vas a aprobar el CFDI de <strong>{reviewModal.commission.account_executives?.first_name} {reviewModal.commission.account_executives?.last_name}</strong> por{' '}
                    <strong>{formatCurrencyMXN(reviewModal.commission.amount)}</strong>.
                  </p>
                  {reviewModal.commission.cfdi_uuid_fiscal && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-xs text-blue-700">UUID: {reviewModal.commission.cfdi_uuid_fiscal}</p>
                      {reviewModal.commission.cfdi_total && (
                        <p className="text-xs text-blue-700 mt-1">
                          Total CFDI: {formatCurrencyMXN(reviewModal.commission.cfdi_total)}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-gray-600">Al aprobar, la comisión quedará lista para registrar el pago.</p>
                </>
              )}

              {reviewModal.action === 'reject' && (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Rechazar CFDI</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    El ejecutivo deberá corregir el CFDI y reenviar. Indica el motivo.
                  </p>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Motivo del rechazo *</label>
                  <textarea
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    rows={3}
                    placeholder="Ej: UUID inválido, monto incorrecto, tipo de CFDI erróneo..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </>
              )}

              {reviewModal.action === 'pay' && (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Registrar pago</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Pago a <strong>{reviewModal.commission.account_executives?.first_name} {reviewModal.commission.account_executives?.last_name}</strong> por{' '}
                    <strong>{formatCurrencyMXN(reviewModal.commission.amount)}</strong>.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Referencia / # de folio (SPEI, cheque, etc.) *</label>
                    <input
                      value={paymentRef}
                      onChange={e => setPaymentRef(e.target.value)}
                      placeholder="Ej: SPEI-XXXXXXXX"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3">
              <button
                onClick={() => setReviewModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleAction}
                disabled={isSubmitting}
                className={`px-5 py-2 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  reviewModal.action === 'reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isSubmitting
                  ? 'Procesando...'
                  : reviewModal.action === 'approve'
                  ? 'Aprobar CFDI'
                  : reviewModal.action === 'reject'
                  ? 'Rechazar CFDI'
                  : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
