import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText, Search, Download, XCircle, RefreshCw, CheckCircle,
  AlertCircle, Clock, Filter, ChevronDown, ExternalLink, RotateCcw, Shield
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

const downloadCfdi = async (cfdiId: string, fileType: 'xml' | 'pdf') => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-cfdi?cfdi_id=${cfdiId}&file_type=${fileType}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  if (fileType === 'pdf') {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else {
    a.download = `factura-${cfdiId}.xml`;
  }
  a.click();
  URL.revokeObjectURL(objectUrl);
};

interface CfdiInvoice {
  id: string;
  invoice_type: 'booking' | 'commission' | 'membership' | 'checkin_wallet' | 'featured_slot';
  booking_id: string | null;
  payout_id: string | null;
  featured_slot_id: string | null;
  agency_id: string | null;
  pac_provider: string;
  uuid_fiscal: string | null;
  folio: string | null;
  serie: string | null;
  receptor_rfc: string;
  receptor_razon_social: string | null;
  receptor_uso_cfdi: string | null;
  subtotal: number;
  iva_amount: number;
  total: number;
  status: 'pending' | 'stamped' | 'cancelled' | 'error';
  xml_url: string | null;
  pdf_url: string | null;
  stamped_at: string | null;
  error_message: string | null;
  retry_count: number;
  email_sent: boolean;
  created_at: string;
  agencies?: { name: string } | null;
  bookings?: { booking_code: string | null; travel_insurance_included: boolean | null; travel_insurance_cost: number | null } | null;
  agency_payouts?: { payout_code: string | null } | null;
}

interface CfdiStats {
  total_stamped: number;
  total_pending: number;
  total_errors: number;
  total_cancelled: number;
  total_amount: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  stamped: { label: 'Timbrado', color: 'bg-success-100 text-success-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Pendiente', color: 'bg-warning-100 text-warning-700', icon: <Clock className="h-3.5 w-3.5" /> },
  error: { label: 'Error', color: 'bg-error-100 text-error-700', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-600', icon: <XCircle className="h-3.5 w-3.5" /> },
};

const MOTIVOS_CANCELACION = [
  { code: '01', label: '01 - Comprobante emitido con errores con relación' },
  { code: '02', label: '02 - Comprobante emitido con errores sin relación' },
  { code: '03', label: '03 - No se llevó a cabo la operación' },
  { code: '04', label: '04 - Operación nominativa relacionada en la factura global' },
];

const AdminCfdi: React.FC = () => {
  const [invoices, setInvoices] = useState<CfdiInvoice[]>([]);
  const [stats, setStats] = useState<CfdiStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState<{ cfdi: CfdiInvoice | null; motivo: string; uuidSustitucion: string }>({
    cfdi: null, motivo: '01', uuidSustitucion: ''
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableInnerRef = useRef<HTMLTableElement>(null);

  const syncScroll = (source: 'top' | 'table') => {
    if (source === 'top' && topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    } else if (source === 'table' && topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [invoicesRes, statsRes] = await Promise.all([
        supabase
          .from('cfdi_invoices')
          .select(`
            *,
            agencies(name),
            bookings(booking_code, travel_insurance_included, travel_insurance_cost),
            agency_payouts(payout_code)
          `)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.rpc('get_cfdi_stats')
      ]);

      if (invoicesRes.data) setInvoices(invoicesRes.data as CfdiInvoice[]);
      if (statsRes.data && statsRes.data[0]) setStats(statsRes.data[0]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = invoices.filter(inv => {
    const matchSearch = !search ||
      inv.uuid_fiscal?.toLowerCase().includes(search.toLowerCase()) ||
      inv.receptor_rfc?.toLowerCase().includes(search.toLowerCase()) ||
      inv.receptor_razon_social?.toLowerCase().includes(search.toLowerCase()) ||
      (inv.agencies as { name: string } | null)?.name?.toLowerCase().includes(search.toLowerCase()) ||
      (inv.bookings as { booking_code: string | null } | null)?.booking_code?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
    const matchType = typeFilter === 'all' || inv.invoice_type === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const handleRetryCfdi = async (cfdiId: string) => {
    setRetryingId(cfdiId);
    try {
      const { data, error } = await supabase.functions.invoke('retry-failed-cfdi', { body: { cfdi_id: cfdiId } });
      if (error) throw error;
      const result = data?.results?.[0];
      if (result?.success) {
        setMessage({ type: 'success', text: 'CFDI reintentado exitosamente.' });
      } else {
        setMessage({ type: 'error', text: result?.error ?? 'El reintento falló.' });
      }
      await fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: String(err) });
    } finally {
      setRetryingId(null);
    }
  };

  const handleCancelCfdi = async () => {
    if (!cancelModal.cfdi) return;
    setIsCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-cfdi', {
        body: {
          cfdi_invoice_id: cancelModal.cfdi.id,
          motivo: cancelModal.motivo,
          uuid_sustitucion: cancelModal.uuidSustitucion || undefined,
        }
      });
      if (error) throw error;
      setMessage({ type: 'success', text: 'CFDI cancelado correctamente.' });
      setCancelModal({ cfdi: null, motivo: '01', uuidSustitucion: '' });
      await fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: String(err) });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary-600" />
              Gestión CFDI
            </h1>
            <p className="text-gray-500 text-sm mt-1">Comprobantes Fiscales Digitales por Internet</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              className="btn btn-outline"
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-4 rounded-md flex items-center gap-2 ${message.type === 'success' ? 'bg-success-50 text-success-700' : 'bg-error-50 text-error-700'}`}>
            {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="ml-auto"><XCircle className="h-4 w-4" /></button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {[
              { label: 'Timbrados', value: stats.total_stamped, color: 'text-success-600', bg: 'bg-success-50' },
              { label: 'Pendientes', value: stats.total_pending, color: 'text-warning-600', bg: 'bg-warning-50' },
              { label: 'Errores', value: stats.total_errors, color: 'text-error-600', bg: 'bg-error-50' },
              { label: 'Cancelados', value: stats.total_cancelled, color: 'text-gray-600', bg: 'bg-gray-50' },
              { label: 'Monto Total', value: formatCurrencyMXN(stats.total_amount), color: 'text-primary-600', bg: 'bg-primary-50' },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} rounded-lg p-4 text-center`}>
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por UUID, RFC, razón social..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 w-full"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-44"
          >
            <option value="all">Todos los estados</option>
            <option value="stamped">Timbrados</option>
            <option value="pending">Pendientes</option>
            <option value="error">Errores</option>
            <option value="cancelled">Cancelados</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input w-44"
          >
            <option value="all">Todos los tipos</option>
            <option value="booking">Viajero (Reserva)</option>
            <option value="checkin_wallet">Cobro en Check-in</option>
            <option value="commission">Comisión (Agencia)</option>
            <option value="membership">Membresía</option>
            <option value="featured_slot">Tour Destacado</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p>No se encontraron CFDIs</p>
            </div>
          ) : (
            <>
              <div
                ref={topScrollRef}
                className="overflow-x-scroll border-b border-gray-200"
                style={{ scrollbarWidth: 'auto' }}
                onScroll={() => syncScroll('top')}
              >
                <div style={{ height: 1, minWidth: tableInnerRef.current?.scrollWidth ?? 800 }} />
              </div>
              <div
                ref={tableScrollRef}
                className="overflow-x-scroll"
                style={{ overflowX: 'scroll', scrollbarWidth: 'none' }}
                onScroll={() => syncScroll('table')}
              >
              <table ref={tableInnerRef} className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Tipo', 'UUID Fiscal', 'Receptor', 'Subtotal', 'IVA', 'Total', 'Estado', 'Fecha', 'Acciones'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((inv) => {
                    const statusInfo = STATUS_LABELS[inv.status];
                    const agencyName = (inv.agencies as { name: string } | null)?.name;
                    const bookingData = inv.bookings as { booking_code: string | null; travel_insurance_included: boolean | null; travel_insurance_cost: number | null } | null;
                    const bookingCode = bookingData?.booking_code;
                    const hasInsurance = bookingData?.travel_insurance_included && (bookingData?.travel_insurance_cost ?? 0) > 0;
                    const payoutCode = (inv.agency_payouts as { payout_code: string | null } | null)?.payout_code;
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            inv.invoice_type === 'booking'
                              ? 'bg-blue-100 text-blue-700'
                              : inv.invoice_type === 'membership'
                              ? 'bg-emerald-100 text-emerald-700'
                              : inv.invoice_type === 'checkin_wallet'
                              ? 'bg-teal-100 text-teal-700'
                              : inv.invoice_type === 'featured_slot'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {inv.invoice_type === 'booking'
                              ? 'Reserva'
                              : inv.invoice_type === 'membership'
                              ? 'Membresía'
                              : inv.invoice_type === 'checkin_wallet'
                              ? 'Check-in'
                              : inv.invoice_type === 'featured_slot'
                              ? 'Destacado'
                              : 'Comisión'}
                          </span>
                          {agencyName && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-24">{agencyName}</div>}
                          {bookingCode && <div className="text-xs text-gray-400">{bookingCode}</div>}
                          {hasInsurance && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              <Shield size={10} className="text-emerald-600" />
                              <span className="text-xs text-emerald-600 font-medium">Con seguro</span>
                            </div>
                          )}
                          {payoutCode && <div className="text-xs text-gray-400">{payoutCode}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {inv.uuid_fiscal ? (
                            <span className="text-xs font-mono text-gray-700 truncate block max-w-36" title={inv.uuid_fiscal}>
                              {inv.uuid_fiscal.substring(0, 18)}...
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                          {inv.serie && inv.folio && (
                            <div className="text-xs text-gray-400">{inv.serie}-{inv.folio}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-mono text-gray-800">{inv.receptor_rfc}</div>
                          {inv.receptor_razon_social && (
                            <div className="text-xs text-gray-500 truncate max-w-32">{inv.receptor_razon_social}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatCurrencyMXN(inv.subtotal)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatCurrencyMXN(inv.iva_amount)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrencyMXN(inv.total)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                            {statusInfo.icon}
                            {statusInfo.label}
                          </span>
                          {inv.status === 'error' && inv.error_message && (
                            <div className="text-xs text-error-600 mt-0.5 truncate max-w-32" title={inv.error_message}>
                              {inv.error_message.substring(0, 40)}
                            </div>
                          )}
                          {inv.retry_count > 0 && (
                            <div className="text-xs text-gray-400">{inv.retry_count} intentos</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {inv.status === 'error' && inv.retry_count < 3 && (
                              <button
                                onClick={() => handleRetryCfdi(inv.id)}
                                disabled={retryingId === inv.id}
                                className="p-1.5 text-gray-500 hover:text-warning-600 hover:bg-warning-50 rounded transition-colors"
                                title="Reintentar timbrado"
                              >
                                <RotateCcw className={`h-3.5 w-3.5 ${retryingId === inv.id ? 'animate-spin' : ''}`} />
                              </button>
                            )}
                            {inv.status === 'stamped' && (
                              <button
                                onClick={() => downloadCfdi(inv.id, 'xml')}
                                className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                title="Descargar XML"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {inv.status === 'stamped' && (
                              <button
                                onClick={() => downloadCfdi(inv.id, 'pdf')}
                                className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                title="Ver PDF"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {inv.status === 'stamped' && (
                              <button
                                onClick={() => setCancelModal({ cfdi: inv, motivo: '01', uuidSustitucion: '' })}
                                className="p-1.5 text-gray-500 hover:text-error-600 hover:bg-error-50 rounded transition-colors"
                                title="Cancelar CFDI"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-2 text-right">Mostrando {filtered.length} de {invoices.length} CFDIs</p>
      </div>

      {/* Cancel Modal */}
      {cancelModal.cfdi && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Cancelar CFDI</h3>
            <p className="text-sm text-gray-500 mb-4">
              UUID: <span className="font-mono text-xs">{cancelModal.cfdi.uuid_fiscal}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo de Cancelación *</label>
                <select
                  value={cancelModal.motivo}
                  onChange={(e) => setCancelModal(prev => ({ ...prev, motivo: e.target.value }))}
                  className="input"
                >
                  {MOTIVOS_CANCELACION.map(m => (
                    <option key={m.code} value={m.code}>{m.label}</option>
                  ))}
                </select>
              </div>

              {cancelModal.motivo === '01' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">UUID del CFDI Sustituto</label>
                  <input
                    type="text"
                    value={cancelModal.uuidSustitucion}
                    onChange={(e) => setCancelModal(prev => ({ ...prev, uuidSustitucion: e.target.value }))}
                    className="input font-mono"
                    placeholder="UUID del comprobante que sustituye a este"
                  />
                </div>
              )}

              <div className="bg-warning-50 border border-warning-200 rounded-md p-3 text-sm text-warning-700">
                Esta acción es irreversible. El CFDI quedará cancelado ante el SAT.
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setCancelModal({ cfdi: null, motivo: '01', uuidSustitucion: '' })}
                className="btn btn-outline"
                disabled={isCancelling}
              >
                Cerrar
              </button>
              <button
                onClick={handleCancelCfdi}
                className="btn bg-error-600 text-white hover:bg-error-700"
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelando...' : 'Cancelar CFDI'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCfdi;
