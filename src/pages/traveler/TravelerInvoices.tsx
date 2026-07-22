import React, { useState, useEffect } from 'react';
import { FileText, Download, ExternalLink, CheckCircle, AlertCircle, Clock, XCircle, RefreshCw, Receipt, Star, Shield, Wallet, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
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
  invoice_type: 'booking' | 'commission' | 'membership' | 'checkin_wallet' | 'supplement' | 'post_booking_insurance' | 'optional_service' | 'booking_installment' | 'post_booking_extras' | 'manual';
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
  booking_id: string | null;
  membership_id: string | null;
  checkin_charge_id: string | null;
  booking_supplement_id: string | null;
  booking_optional_service_id: string | null;
  installment_id: string | null;
  bookings?: { booking_code: string | null; travel_insurance_included: boolean | null; travel_insurance_cost: number | null; tours?: { name: string } | null } | null;
  booking_supplements?: { tour_supplements?: { name: string } | null } | null;
  booking_optional_services?: { tour_optional_service?: { name: string } | null } | null;
  booking_payment_plan_installments?: { label: string; installment_number: number } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  stamped: { label: 'Timbrado', color: 'bg-success-100 text-success-700', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Procesando', color: 'bg-warning-100 text-warning-700', icon: <Clock className="h-3.5 w-3.5" /> },
  error: { label: 'Error', color: 'bg-error-100 text-error-700', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500', icon: <XCircle className="h-3.5 w-3.5" /> },
};

const TravelerInvoices: React.FC = () => {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<CfdiInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'stamped' | 'pending' | 'error' | 'cancelled'>('all');

  const fetchInvoices = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // Facturas de reservas del viajero
      const { data: bookingInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'booking')
        .order('created_at', { ascending: false })
        .limit(100);

      const bookingMine: CfdiInvoice[] = [];
      if (bookingInvoices) {
        await Promise.all(
          bookingInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) bookingMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de membresías del viajero
      const { data: membershipInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id`)
        .eq('invoice_type', 'membership')
        .order('created_at', { ascending: false })
        .limit(50);

      const membershipMine: CfdiInvoice[] = [];
      if (membershipInvoices) {
        await Promise.all(
          membershipInvoices.map(async (inv) => {
            if (!inv.membership_id) return;
            const { data: mem } = await supabase
              .from('memberships')
              .select('user_id')
              .eq('id', inv.membership_id)
              .maybeSingle();
            if (mem?.user_id === user.id) membershipMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de cobros en check-in del viajero
      const { data: checkinInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'checkin_wallet')
        .order('created_at', { ascending: false })
        .limit(100);

      const checkinMine: CfdiInvoice[] = [];
      if (checkinInvoices) {
        await Promise.all(
          checkinInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) checkinMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de suplementos del viajero
      const { data: supplementInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_supplements(tour_supplements(name)), bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'supplement')
        .order('created_at', { ascending: false })
        .limit(100);

      const supplementMine: CfdiInvoice[] = [];
      if (supplementInvoices) {
        await Promise.all(
          supplementInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) supplementMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de seguro post-reserva del viajero
      const { data: insuranceInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_optional_service_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'post_booking_insurance')
        .order('created_at', { ascending: false })
        .limit(100);

      const insuranceMine: CfdiInvoice[] = [];
      if (insuranceInvoices) {
        await Promise.all(
          insuranceInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) insuranceMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de servicios opcionales del viajero
      const { data: optionalInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_optional_service_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'optional_service')
        .order('created_at', { ascending: false })
        .limit(100);

      const optionalMine: CfdiInvoice[] = [];
      if (optionalInvoices) {
        await Promise.all(
          optionalInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) optionalMine.push(inv as CfdiInvoice);
          })
        );
      }

      // Facturas de parcialidades de plan de pago del viajero
      const { data: installmentInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, installment_id, bookings(booking_code, tours(name)), booking_payment_plan_installments(label, installment_number)`)
        .eq('invoice_type', 'booking_installment')
        .order('created_at', { ascending: false })
        .limit(100);

      const installmentMine: CfdiInvoice[] = [];
      if (installmentInvoices) {
        await Promise.all(
          installmentInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            const { data: booking } = await supabase
              .from('bookings')
              .select('user_id')
              .eq('id', inv.booking_id)
              .maybeSingle();
            if (booking?.user_id === user.id) installmentMine.push(inv as unknown as CfdiInvoice);
          })
        );
      }

      const all = [...bookingMine, ...membershipMine, ...checkinMine, ...supplementMine, ...insuranceMine, ...optionalMine, ...installmentMine].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setInvoices(all);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, [user?.id]);

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter);

  const counts = {
    all: invoices.length,
    stamped: invoices.filter(i => i.status === 'stamped').length,
    pending: invoices.filter(i => i.status === 'pending').length,
    error: invoices.filter(i => i.status === 'error').length,
    cancelled: invoices.filter(i => i.status === 'cancelled').length,
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary-600" />
            Mis Facturas (CFDI)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Comprobantes fiscales digitales de tus reservas y membresias, validos ante el SAT.
          </p>
        </div>
        <button
          onClick={fetchInvoices}
          disabled={isLoading}
          className="btn btn-outline btn-sm flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(['all', 'stamped', 'pending', 'error', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'Todos' : STATUS_CONFIG[f]?.label}
            <span className="ml-1.5 text-xs opacity-75">({counts[f]})</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {filter === 'all'
              ? 'Aun no tienes comprobantes fiscales generados.'
              : `No hay facturas con estado "${STATUS_CONFIG[filter]?.label}".`}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Las facturas se generan automaticamente al confirmar tu pago cuando la configuracion fiscal esta activa.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inv) => {
            const s = STATUS_CONFIG[inv.status];
            const booking = inv.bookings as { booking_code: string | null; travel_insurance_included: boolean | null; travel_insurance_cost: number | null; tours?: { name: string } | null } | null;
            const tourName = booking?.tours?.name;
            const bookingCode = booking?.booking_code;
            const isMembership = inv.invoice_type === 'membership';
            const isCheckin = inv.invoice_type === 'checkin_wallet';
            const isSupplement = inv.invoice_type === 'supplement';
            const isInsurance = inv.invoice_type === 'post_booking_insurance';
            const isOptional = inv.invoice_type === 'optional_service';
            const isInstallment = inv.invoice_type === 'booking_installment';
            const hasInsurance = inv.invoice_type === 'booking' && booking?.travel_insurance_included && (booking?.travel_insurance_cost ?? 0) > 0;
            const insuranceCost = hasInsurance ? (booking?.travel_insurance_cost ?? 0) : 0;
            const supplementName = (inv.booking_supplements as any)?.tour_supplements?.name;
            const optionalServiceName = (inv.booking_optional_services as any)?.tour_optional_service?.name;
            const installmentLabel = (inv.booking_payment_plan_installments as any)?.label;

            return (
              <div
                key={inv.id}
                className="bg-white rounded-xl border border-gray-200 hover:border-primary-200 hover:shadow-sm transition-all p-4 flex items-center gap-4"
              >
                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                  isMembership ? 'bg-amber-100' : isCheckin ? 'bg-teal-100' : isSupplement ? 'bg-purple-100' : isInsurance ? 'bg-emerald-100' : isOptional ? 'bg-orange-100' : isInstallment ? 'bg-sky-100' : 'bg-primary-100'
                }`}>
                  {isMembership
                    ? <Star className="h-5 w-5 text-amber-600" />
                    : isCheckin
                    ? <Wallet className="h-5 w-5 text-teal-600" />
                    : isSupplement
                    ? <Package className="h-5 w-5 text-purple-600" />
                    : isInsurance
                    ? <Shield className="h-5 w-5 text-emerald-600" />
                    : isOptional
                    ? <Package className="h-5 w-5 text-orange-600" />
                    : isInstallment
                    ? <Receipt className="h-5 w-5 text-sky-600" />
                    : <FileText className="h-5 w-5 text-primary-600" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
                      {s.icon}
                      {s.label}
                    </span>
                    {isMembership && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <Star className="h-3 w-3" />
                        Membresia ToursRed Plus
                      </span>
                    )}
                    {isCheckin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                        <Wallet className="h-3 w-3" />
                        Cobro en Check-in
                      </span>
                    )}
                    {isSupplement && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        <Package className="h-3 w-3" />
                        Suplemento
                      </span>
                    )}
                    {!isMembership && !isCheckin && !isSupplement && !isInsurance && !isOptional && !isInstallment && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        Reserva
                      </span>
                    )}
                    {isInstallment && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                        <Receipt className="h-3 w-3" />
                        {installmentLabel ? `Parcialidad: ${installmentLabel}` : 'Parcialidad de plan de pagos'}
                      </span>
                    )}
                    {isInsurance && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        <Shield className="h-3 w-3" />
                        Seguro de viaje
                      </span>
                    )}
                    {isOptional && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                        <Package className="h-3 w-3" />
                        Servicio adicional
                      </span>
                    )}
                    {bookingCode && (
                      <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                        {bookingCode}
                      </span>
                    )}
                  </div>
                  {tourName && !isSupplement && !isInsurance && !isOptional && (
                    <div className="text-sm font-semibold text-gray-800 truncate">{tourName}</div>
                  )}
                  {isMembership && !tourName && (
                    <div className="text-sm font-semibold text-gray-800">Suscripcion ToursRed Plus</div>
                  )}
                  {isCheckin && !tourName && (
                    <div className="text-sm font-semibold text-gray-800">Cobro de saldo restante en check-in</div>
                  )}
                  {isSupplement && (
                    <div className="text-sm font-semibold text-gray-800">
                      {supplementName ? `Suplemento: ${supplementName}` : 'Suplemento adicional'}
                      {tourName && <span className="font-normal text-gray-500"> · {tourName}</span>}
                    </div>
                  )}
                  {isInsurance && (
                    <div className="text-sm font-semibold text-gray-800">
                      Seguro de asistencia de viaje
                      {tourName && <span className="font-normal text-gray-500"> · {tourName}</span>}
                    </div>
                  )}
                  {isOptional && (
                    <div className="text-sm font-semibold text-gray-800">
                      {optionalServiceName ? `Servicio: ${optionalServiceName}` : 'Servicio adicional'}
                      {tourName && <span className="font-normal text-gray-500"> · {tourName}</span>}
                    </div>
                  )}
                  {inv.uuid_fiscal && (
                    <div className="text-xs font-mono text-gray-400 truncate mt-0.5">{inv.uuid_fiscal}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
                    {inv.serie && inv.folio && ` · ${inv.serie}-${inv.folio}`}
                    {inv.receptor_rfc && ` · RFC: ${inv.receptor_rfc}`}
                  </div>
                </div>

                <div className="text-right shrink-0 mr-2">
                  <div className="text-base font-bold text-gray-900">{formatCurrencyMXN(inv.total)}</div>
                  <div className="text-xs text-gray-400">IVA incl.</div>
                  {inv.iva_amount > 0 && (
                    <div className="text-xs text-gray-400">IVA: {formatCurrencyMXN(inv.iva_amount)}</div>
                  )}
                  {hasInsurance && (
                    <div className="flex items-center justify-end gap-0.5 mt-1">
                      <Shield size={10} className="text-emerald-600" />
                      <span className="text-xs text-emerald-600 font-medium">Seguro: {formatCurrencyMXN(insuranceCost)}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-1 shrink-0">
                  {inv.status === 'stamped' && (
                    <button
                      onClick={() => downloadCfdi(inv.id, 'xml')}
                      title="Descargar XML"
                      className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  {inv.status === 'stamped' && (
                    <button
                      onClick={() => downloadCfdi(inv.id, 'pdf')}
                      title="Ver PDF"
                      className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
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

export default TravelerInvoices;
