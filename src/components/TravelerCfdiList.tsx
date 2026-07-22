import React, { useState, useEffect } from 'react';
import { FileText, Download, ExternalLink, CheckCircle, AlertCircle, Clock, XCircle, RefreshCw } from 'lucide-react';
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
  uuid_fiscal: string | null;
  folio: string | null;
  serie: string | null;
  receptor_rfc: string;
  subtotal: number;
  iva_amount: number;
  total: number;
  status: 'pending' | 'stamped' | 'cancelled' | 'error';
  xml_url: string | null;
  pdf_url: string | null;
  stamped_at: string | null;
  created_at: string;
  bookings?: { booking_code: string | null; tours?: { name: string } | null } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  stamped: { label: 'Timbrado', color: 'bg-success-100 text-success-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Procesando', color: 'bg-warning-100 text-warning-700', icon: <Clock className="h-3.5 w-3.5" /> },
  error: { label: 'Error', color: 'bg-error-100 text-error-700', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500', icon: <XCircle className="h-3.5 w-3.5" /> },
};

interface Props {
  userId: string;
}

const TravelerCfdiList: React.FC<Props> = ({ userId }) => {
  const [invoices, setInvoices] = useState<CfdiInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('cfdi_invoices')
        .select(`
          *,
          bookings(booking_code, tours(name))
        `)
        .eq('invoice_type', 'booking')
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) {
        const myInvoices = await Promise.all(
          data.map(async (inv) => {
            if (!inv.booking_id) return null;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            return booking?.user_id === userId ? inv : null;
          })
        );
        setInvoices(myInvoices.filter(Boolean) as CfdiInvoice[]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, [userId]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  if (invoices.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary-600" />
          Mis Comprobantes Fiscales (CFDI)
        </h2>
        <button onClick={fetchInvoices} className="btn btn-outline btn-sm">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Actualizar
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Descarga aquí los comprobantes fiscales digitales de tus reservas. El XML y el PDF son válidos ante el SAT.
      </p>

      <div className="space-y-2">
        {invoices.map((inv) => {
          const s = STATUS_CONFIG[inv.status];
          const booking = inv.bookings as { booking_code: string | null; tours?: { name: string } | null } | null;
          const tourName = booking?.tours?.name;
          const bookingCode = booking?.booking_code;

          return (
            <div key={inv.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-primary-100 hover:bg-primary-50/30 transition-colors">
              <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
                    {s.icon}
                    {s.label}
                  </span>
                  {bookingCode && <span className="text-xs font-mono text-gray-400">{bookingCode}</span>}
                </div>
                {tourName && <div className="text-sm font-medium text-gray-800 truncate">{tourName}</div>}
                {inv.uuid_fiscal && (
                  <div className="text-xs font-mono text-gray-400 truncate">{inv.uuid_fiscal}</div>
                )}
                <div className="text-xs text-gray-400">
                  {new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
                  {inv.serie && inv.folio && ` · ${inv.serie}-${inv.folio}`}
                </div>
              </div>
              <div className="text-right shrink-0 mr-2">
                <div className="text-sm font-semibold text-gray-900">{formatCurrencyMXN(inv.total)}</div>
                <div className="text-xs text-gray-400">IVA incl.</div>
              </div>
              <div className="flex gap-1 shrink-0">
                {inv.status === 'stamped' && (
                  <button
                    onClick={() => downloadCfdi(inv.id, 'xml')}
                    title="Descargar XML"
                    className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-100 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                )}
                {inv.status === 'stamped' && (
                  <button
                    onClick={() => downloadCfdi(inv.id, 'pdf')}
                    title="Ver PDF"
                    className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-100 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TravelerCfdiList;
