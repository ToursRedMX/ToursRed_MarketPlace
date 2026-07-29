import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle, RefreshCw, Check, X, Search, Building2, QrCode,
  ArrowUpCircle, Clock, FileText, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface WebhookEvent {
  id: string;
  event_type: string;
  transaction_id: string | null;
  order_id: string | null;
  raw_payload: any;
  processing_status: string;
  processing_result: string | null;
  processing_error: string | null;
  received_at: string;
  processed_at: string | null;
}

interface TopupRecord {
  id: string;
  user_id: string;
  amount: number;
  payment_method_type: 'spei' | 'codi';
  status: string;
  order_id: string;
  provider_charge_id: string | null;
  conciliation_status: string | null;
  error_message: string | null;
  created_at: string;
  users?: { first_name: string; last_name: string; email: string } | null;
}

type Tab = 'pending' | 'all-topups' | 'all-webhooks';

const AdminOpenPayConciliation: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [topups, setTopups] = useState<TopupRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignAmount, setAssignAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'pending') {
        const { data, error } = await supabase
          .from('openpay_webhook_events')
          .select('*')
          .in('processing_status', ['no_reconocido', 'requiere_conciliacion_manual', 'error'])
          .order('received_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        setWebhookEvents(data || []);
      } else if (activeTab === 'all-webhooks') {
        let query = supabase
          .from('openpay_webhook_events')
          .select('*')
          .order('received_at', { ascending: false })
          .limit(100);
        if (statusFilter !== 'all') {
          query = query.eq('processing_status', statusFilter);
        }
        const { data, error } = await query;
        if (error) throw error;
        setWebhookEvents(data || []);
      } else if (activeTab === 'all-topups') {
        let query = supabase
          .from('openpay_wallet_topups')
          .select('*, users:first_name,last_name,email')
          .order('created_at', { ascending: false })
          .limit(100);
        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }
        const { data, error } = await query;
        if (error) throw error;
        setTopups(data || []);
      }
    } catch (err) {
      console.error('Error loading conciliation data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleManualCredit = async (topupId: string) => {
    setIsProcessing(true);
    setActionResult(null);
    try {
      const { data: topup } = await supabase
        .from('openpay_wallet_topups')
        .select('*')
        .eq('id', topupId)
        .single();

      if (!topup) {
        setActionResult('Recarga no encontrada');
        return;
      }

      const transactionType = topup.payment_method_type === 'codi' ? 'topup_codi' : 'topup_spei';
      const referenceType = topup.payment_method_type === 'codi'
        ? 'openpay_codi_topup'
        : 'openpay_spei_topup';

      const { error: creditError } = await supabase.rpc('update_wallet_balance', {
        p_user_id: topup.user_id,
        p_amount: topup.amount,
        p_type: transactionType,
        p_description: 'Recarga acreditada manualmente por admin',
        p_reference_id: topup.id,
        p_reference_type: referenceType,
        p_idempotency_key: topup.provider_charge_id || `manual_${topup.id}`,
      });

      if (creditError) {
        if (creditError.message?.includes('idempotency')) {
          setActionResult('Esta recarga ya fue acreditada anteriormente');
        } else {
          setActionResult(`Error: ${creditError.message}`);
        }
      } else {
        await supabase
          .from('openpay_wallet_topups')
          .update({
            status: 'completed',
            credited_at: new Date().toISOString(),
            conciliation_status: 'resuelto_acreditado',
          })
          .eq('id', topupId);

        setActionResult('Saldo acreditado exitosamente');
        await loadData();
      }
    } catch (err: any) {
      setActionResult(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveWithoutCredit = async (eventId: string, topupId?: string) => {
    setIsProcessing(true);
    setActionResult(null);
    try {
      await supabase
        .from('openpay_webhook_events')
        .update({
          processing_status: 'processed',
          processing_result: 'Resuelto sin acreditar por admin',
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventId);

      if (topupId) {
        await supabase
          .from('openpay_wallet_topups')
          .update({ conciliation_status: 'resuelto_sin_acreditar' })
          .eq('id', topupId);
      }

      setActionResult('Evento marcado como resuelto sin acreditar');
      setSelectedEvent(null);
      await loadData();
    } catch (err: any) {
      setActionResult(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAssignToUser = async () => {
    if (!assignUserId || !assignAmount || !selectedEvent) return;
    setIsProcessing(true);
    setActionResult(null);
    try {
      const amount = parseFloat(assignAmount);
      if (isNaN(amount) || amount <= 0) {
        setActionResult('Monto invalido');
        return;
      }

      const { error: creditError } = await supabase.rpc('update_wallet_balance', {
        p_user_id: assignUserId,
        p_amount: amount,
        p_type: 'topup_spei',
        p_description: 'Deposito asignado manualmente por admin (conciliacion)',
        p_reference_id: null,
        p_reference_type: 'manual_conciliation',
        p_idempotency_key: `manual_event_${selectedEvent.id}`,
      });

      if (creditError) {
        setActionResult(`Error: ${creditError.message}`);
        return;
      }

      await supabase
        .from('openpay_webhook_events')
        .update({
          processing_status: 'processed',
          processing_result: `Asignado manualmente a usuario ${assignUserId} - $${amount}`,
          processed_at: new Date().toISOString(),
        })
        .eq('id', selectedEvent.id);

      setActionResult('Deposito asignado y acreditado exitosamente');
      setSelectedEvent(null);
      setAssignUserId('');
      setAssignAmount('');
      await loadData();
    } catch (err: any) {
      setActionResult(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredWebhooks = webhookEvents.filter((event) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      event.transaction_id?.toLowerCase().includes(search) ||
      event.order_id?.toLowerCase().includes(search) ||
      event.event_type?.toLowerCase().includes(search)
    );
  });

  const filteredTopups = topups.filter((topup) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      topup.order_id?.toLowerCase().includes(search) ||
      topup.provider_charge_id?.toLowerCase().includes(search) ||
      topup.users?.email?.toLowerCase().includes(search) ||
      `${topup.users?.first_name} ${topup.users?.last_name}`.toLowerCase().includes(search)
    );
  });

  const statusBadge = (status: string) => {
    const config: Record<string, string> = {
      received: 'bg-gray-100 text-gray-700',
      processed: 'bg-green-100 text-green-700',
      no_reconocido: 'bg-red-100 text-red-700',
      requiere_conciliacion_manual: 'bg-amber-100 text-amber-700',
      ignored: 'bg-gray-100 text-gray-500',
      error: 'bg-red-100 text-red-700',
      pending: 'bg-gray-100 text-gray-700',
      awaiting_transfer: 'bg-amber-100 text-amber-700',
      completed: 'bg-green-100 text-green-700',
      expired: 'bg-gray-100 text-gray-500',
      cancelled: 'bg-red-100 text-red-700',
      failed: 'bg-red-100 text-red-700',
      resuelto_acreditado: 'bg-green-100 text-green-700',
      resuelto_sin_acreditar: 'bg-gray-100 text-gray-500',
    };
    return config[status] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Conciliacion OpenPay</h1>
      <p className="text-gray-600 mb-6">
        Gestion de recargas SPEI/CoDi, webhooks no reconocidos y conciliacion manual.
      </p>

      {actionResult && (
        <div className={`mb-4 p-4 rounded-lg flex items-center gap-2 ${
          actionResult.includes('Error') || actionResult.includes('invalido')
            ? 'bg-red-50 text-red-800 border border-red-200'
            : 'bg-green-50 text-green-800 border border-green-200'
        }`}>
          {actionResult.includes('Error') ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" />}
          <span className="font-medium">{actionResult}</span>
          <button onClick={() => setActionResult(null)} className="ml-auto text-current opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'pending'
              ? 'border-accent-600 text-accent-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Pendientes de Conciliacion
        </button>
        <button
          onClick={() => setActiveTab('all-topups')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'all-topups'
              ? 'border-accent-600 text-accent-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Todas las Recargas
        </button>
        <button
          onClick={() => setActiveTab('all-webhooks')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'all-webhooks'
              ? 'border-accent-600 text-accent-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Todos los Webhooks
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por ID, orden, email..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500"
          />
        </div>
        {activeTab !== 'pending' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500"
          >
            <option value="all">Todos los estados</option>
            {activeTab === 'all-webhooks' && (
              <>
                <option value="received">Recibido</option>
                <option value="processed">Procesado</option>
                <option value="no_reconocido">No reconocido</option>
                <option value="requiere_conciliacion_manual">Requiere conciliacion</option>
                <option value="ignored">Ignorado</option>
                <option value="error">Error</option>
              </>
            )}
            {activeTab === 'all-topups' && (
              <>
                <option value="pending">Pendiente</option>
                <option value="awaiting_transfer">Esperando transferencia</option>
                <option value="completed">Completada</option>
                <option value="expired">Vencida</option>
                <option value="cancelled">Cancelada</option>
                <option value="failed">Fallida</option>
              </>
            )}
          </select>
        )}
        <button
          onClick={loadData}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <RefreshCw className="h-8 w-8 text-gray-400 mx-auto animate-spin" />
          <p className="text-gray-500 mt-2">Cargando...</p>
        </div>
      ) : activeTab === 'all-topups' ? (
        /* Topups Table */
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Usuario</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Metodo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Monto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Conciliacion</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredTopups.map((topup) => (
                <tr key={topup.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {format(new Date(topup.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {topup.users ? `${topup.users.first_name} ${topup.users.last_name}` : 'N/A'}
                    <div className="text-xs text-gray-500">{topup.users?.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {topup.payment_method_type === 'spei' ? (
                      <span className="inline-flex items-center gap-1 text-accent-700">
                        <Building2 className="h-4 w-4" /> SPEI
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-blue-700">
                        <QrCode className="h-4 w-4" /> CoDi
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {formatCurrencyMXN(Number(topup.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusBadge(topup.status)}`}>
                      {topup.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {topup.conciliation_status ? (
                      <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusBadge(topup.conciliation_status)}`}>
                        {topup.conciliation_status}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {topup.status !== 'completed' && (
                      <button
                        onClick={() => handleManualCredit(topup.id)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                      >
                        <ArrowUpCircle className="h-4 w-4" />
                        Acreditar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredTopups.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No hay recargas para mostrar
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Webhook Events List */
        <div className="space-y-3">
          {filteredWebhooks.map((event) => (
            <div key={event.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`px-2 py-1 text-xs font-medium rounded-full ${statusBadge(event.processing_status)}`}>
                    {event.processing_status}
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{event.event_type}</span>
                  {event.transaction_id && (
                    <span className="text-xs text-gray-500 font-mono">{event.transaction_id}</span>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {format(new Date(event.received_at), 'dd/MM/yyyy HH:mm:ss', { locale: es })}
                </span>
              </div>

              {event.processing_error && (
                <p className="text-sm text-red-600 mb-2">{event.processing_error}</p>
              )}
              {event.processing_result && (
                <p className="text-sm text-gray-600 mb-2">{event.processing_result}</p>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <FileText className="h-3 w-3" />
                  Ver payload
                </button>
                {(event.processing_status === 'no_reconocido' || event.processing_status === 'requiere_conciliacion_manual' || event.processing_status === 'error') && (
                  <>
                    <button
                      onClick={() => handleResolveWithoutCredit(event.id)}
                      disabled={isProcessing}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Resolver sin acreditar
                    </button>
                  </>
                )}
              </div>

              {selectedEvent?.id === event.id && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                  <pre className="text-xs text-gray-700 overflow-x-auto max-h-60">
                    {JSON.stringify(event.raw_payload, null, 2)}
                  </pre>

                  {event.processing_status === 'no_reconocido' && (
                    <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                      <p className="text-sm font-semibold text-amber-900 mb-2">Asignar a usuario manualmente:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={assignUserId}
                          onChange={(e) => setAssignUserId(e.target.value)}
                          placeholder="User ID (UUID)"
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        />
                        <input
                          type="number"
                          value={assignAmount}
                          onChange={(e) => setAssignAmount(e.target.value)}
                          placeholder="Monto"
                          className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        />
                        <button
                          onClick={handleAssignToUser}
                          disabled={isProcessing || !assignUserId || !assignAmount}
                          className="px-4 py-2 text-sm font-medium text-white bg-accent-600 rounded-lg hover:bg-accent-700 transition-colors disabled:opacity-50"
                        >
                          Acreditar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredWebhooks.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No hay eventos para mostrar
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminOpenPayConciliation;
