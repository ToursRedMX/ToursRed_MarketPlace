import React, { useState, useEffect } from 'react';
import { FileText, Download, ExternalLink, CheckCircle, AlertCircle, Clock, XCircle, RefreshCw, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrencyMXN } from '../utils/formatCurrency';

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
  invoice_type: 'booking' | 'commission' | 'checkin_wallet';
  uuid_fiscal: string | null;
  folio: string | null;
  serie: string | null;
  receptor_rfc: string;
  receptor_razon_social: string | null;
  subtotal: number;
  iva_amount: number;
  total: number;
  status: 'pending' | 'stamped' | 'cancelled' | 'error';
  xml_url: string | null;
  pdf_url: string | null;
  stamped_at: string | null;
  error_message: string | null;
  created_at: string;
  bookings?: { booking_code: string | null } | null;
  agency_payouts?: { payout_code: string | null } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  stamped: { label: 'Timbrado', color: 'bg-success-100 text-success-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Pendiente', color: 'bg-warning-100 text-warning-700', icon: <Clock className="h-3.5 w-3.5" /> },
  error: { label: 'Error', color: 'bg-error-100 text-error-700', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500', icon: <XCircle className="h-3.5 w-3.5" /> },
};

interface Props {
  agencyId: string;
}

const AgencyCfdiList: React.FC<Props> = ({ agencyId }) => {
  const [invoices, setInvoices] = useState<CfdiInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('cfdi_invoices')
        .select(`
          *,
          bookings(booking_code),
          agency_payouts(payout_code)
        `)
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data) setInvoices(data as CfdiInvoice[]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, [agencyId]);

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter);
  const stamped = invoices.filter(i => i.status === 'stamped');
  const totalMxn = stamped.reduce((sum, i) => sum + i.total, 0);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary-600" />
          Mis Facturas CFDI
        </h2>
        <button onClick={fetchInvoices} className="btn btn-outline btn-sm" disabled={isLoading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-success-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-success-600">{stamped.length}</div>
          <div className="text-xs text-gray-500">Timbradas</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-gray-700">{invoices.length}</div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
        <div className="bg-primary-50 rounded-lg p-3 text-center">
          <div className="text-sm font-bold text-primary-700">{formatCurrencyMXN(totalMxn)}</div>
          <div className="text-xs text-gray-500">Monto timbrado</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-3">
        {[
          { key: 'all', label: 'Todos' },
          { key: 'stamped', label: 'Timbrados' },
          { key: 'commission', label: 'Comisiones' },
          { key: 'error', label: 'Errores' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === tab.key
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay CFDIs en esta categoría</p>
          {invoices.length === 0 && (
            <p className="text-xs mt-1 text-gray-400">Los CFDIs se generan automáticamente al procesar pagos.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const s = STATUS_CONFIG[inv.status];
            const ref = inv.invoice_type === 'booking'
              ? (inv.bookings as { booking_code: string | null } | null)?.booking_code
              : (inv.agency_payouts as { payout_code: string | null } | null)?.payout_code;
            return (
              <div key={inv.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
                      {s.icon}
                      {s.label}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                      inv.invoice_type === 'booking'
                        ? 'bg-blue-100 text-blue-600'
                        : inv.invoice_type === 'checkin_wallet'
                        ? 'bg-teal-100 text-teal-600'
                        : 'bg-amber-100 text-amber-600'
                    }`}>
                      {inv.invoice_type === 'checkin_wallet' && <Wallet className="h-3 w-3" />}
                      {inv.invoice_type === 'booking' ? 'Reserva' : inv.invoice_type === 'checkin_wallet' ? 'Check-in' : 'Comisión'}
                    </span>
                    {ref && <span className="text-xs text-gray-400 font-mono">{ref}</span>}
                  </div>
                  {inv.uuid_fiscal ? (
                    <div className="text-xs font-mono text-gray-500 truncate">{inv.uuid_fiscal}</div>
                  ) : (
                    <div className="text-xs text-gray-400">
                      {inv.status === 'error' ? inv.error_message?.substring(0, 60) : 'UUID pendiente'}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {inv.serie && inv.folio && ` · ${inv.serie}-${inv.folio}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-gray-800">{formatCurrencyMXN(inv.total)}</div>
                  <div className="text-xs text-gray-400">IVA {formatCurrencyMXN(inv.iva_amount)}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {inv.status === 'stamped' && (
                    <button
                      onClick={() => downloadCfdi(inv.id, 'xml')}
                      className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                      title="Descargar XML"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  {inv.status === 'stamped' && (
                    <button
                      onClick={() => downloadCfdi(inv.id, 'pdf')}
                      className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                      title="Ver PDF"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgencyCfdiList;
