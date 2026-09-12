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
  // Las cuatro son FK opcionales —una factura cuelga de UNA cosa: una reserva,
  // un suplemento, un servicio o una parcialidad— y los `select` de este
  // archivo no siempre las piden. Declararlas obligatorias hacia que
  // `comoFactura(inv)` fallara en los cinco sitios: para TypeScript el
  // objeto de la consulta no se parecia lo bastante al tipo.
  checkin_charge_id?: string | null;
  booking_supplement_id?: string | null;
  booking_optional_service_id?: string | null;
  installment_id?: string | null;
  bookings?: { booking_code: string | null; travel_insurance_included: boolean | null; travel_insurance_cost: number | null; tours?: { name: string } | null } | null;
  booking_supplements?: { tour_supplements?: { name: string } | null } | null;
  booking_optional_services?: { tour_optional_service?: { name: string } | null } | null;
  booking_payment_plan_installments?: { label: string; installment_number: number } | null;
}

/**
 * Convierte una fila de `cfdi_invoices` en `CfdiInvoice`.
 *
 * POR QUE HACE FALTA PASAR POR `unknown`
 *
 * supabase-js, sin tipos generados de la base, NO sabe la cardinalidad de las
 * relaciones y las infiere siempre como ARRAY. Aqui `bookings` es una relacion
 * a-uno y PostgREST devuelve un OBJETO — comprobado contra la base el
 * 11-sep-2026, no supuesto.
 *
 * O sea que el tipo inferido dice `bookings: {...}[]` donde el dato real es
 * `bookings: {...}`. Los dos no se solapan, y por eso un `as CfdiInvoice` a
 * secas lo rechaza: hay que decirle explicitamente que se descarta la
 * inferencia.
 *
 * Se usa en los SIETE sitios que convierten filas aqui, no solo en los cinco
 * que daban error: los otros dos tienen el mismo problema y solo se libraban
 * por como estaba escrito el `select`.
 *
 * El dia que el cliente lleve `<Database>`, esto sobra: la cardinalidad vendria
 * bien desde el principio.
 */
const comoFactura = (fila: unknown): CfdiInvoice => fila as CfdiInvoice;

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
  // F-1: esta pantalla lista COMPROBANTES FISCALES y no tenia un solo manejo de
  // error. Si cualquiera de las 14 consultas fallaba, la lista salia corta y
  // parecia completa: el sintoma es "no aparece mi factura", que en un CFDI es
  // un problema de soporte, no una molestia. Ahora, si algo falla, se dice.
  const [cargaIncompleta, setCargaIncompleta] = useState(false);

  const fetchInvoices = async () => {
    if (!user) return;
    const userId = user.id;
    setIsLoading(true);
    setCargaIncompleta(false);

    // Se anota cada consulta que falla. No se corta la carga: mas vale mostrar
    // las facturas que si se pudieron leer y avisar de que faltan, que no
    // mostrar nada.
    const fallos: string[] = [];

    // Cada factura se filtra consultando a quien pertenece su reserva o
    // membresia. Este patron estaba repetido siete veces, y en las siete se
    // ignoraba el error: al fallar, `data` llegaba null, la comparacion daba
    // false y la factura DEL PROPIO VIAJERO se descartaba en silencio. Falla
    // cerrado —nunca muestra una factura ajena, que es lo importante— pero
    // esconde las suyas, y eso hay que decirlo.
    const esDelViajero = async (tabla: 'bookings' | 'memberships', id: string) => {
      const { data, error } = await supabase
        .from(tabla)
        .select('user_id')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.error(`TravelerInvoices: no se pudo verificar el dueno en ${tabla}`, error);
        fallos.push(tabla);
        return false;
      }
      return data?.user_id === userId;
    };

    try {
      // Facturas de reservas del viajero
      const { data: bookingInvoices, error: error_bookingInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'booking')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_bookingInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de reservas', error_bookingInvoices);
        fallos.push('reservas');
      }

      const bookingMine: CfdiInvoice[] = [];
      if (bookingInvoices) {
        await Promise.all(
          bookingInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) bookingMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de membresías del viajero
      const { data: membershipInvoices, error: error_membershipInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id`)
        .eq('invoice_type', 'membership')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error_membershipInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de membresias', error_membershipInvoices);
        fallos.push('membresias');
      }

      const membershipMine: CfdiInvoice[] = [];
      if (membershipInvoices) {
        await Promise.all(
          membershipInvoices.map(async (inv) => {
            if (!inv.membership_id) return;
            if (await esDelViajero('memberships', inv.membership_id)) membershipMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de cobros en check-in del viajero
      const { data: checkinInvoices, error: error_checkinInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'checkin_wallet')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_checkinInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de cobros en check-in', error_checkinInvoices);
        fallos.push('cobros en check-in');
      }

      const checkinMine: CfdiInvoice[] = [];
      if (checkinInvoices) {
        await Promise.all(
          checkinInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) checkinMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de suplementos del viajero
      const { data: supplementInvoices, error: error_supplementInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_supplements(tour_supplements(name)), bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'supplement')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_supplementInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de suplementos', error_supplementInvoices);
        fallos.push('suplementos');
      }

      const supplementMine: CfdiInvoice[] = [];
      if (supplementInvoices) {
        await Promise.all(
          supplementInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) supplementMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de seguro post-reserva del viajero
      const { data: insuranceInvoices, error: error_insuranceInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_optional_service_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'post_booking_insurance')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_insuranceInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de seguro post-reserva', error_insuranceInvoices);
        fallos.push('seguro post-reserva');
      }

      const insuranceMine: CfdiInvoice[] = [];
      if (insuranceInvoices) {
        await Promise.all(
          insuranceInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) insuranceMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de servicios opcionales del viajero
      const { data: optionalInvoices, error: error_optionalInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, checkin_charge_id, booking_supplement_id, booking_optional_service_id, bookings(booking_code, travel_insurance_included, travel_insurance_cost, tours(name))`)
        .eq('invoice_type', 'optional_service')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_optionalInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de servicios opcionales', error_optionalInvoices);
        fallos.push('servicios opcionales');
      }

      const optionalMine: CfdiInvoice[] = [];
      if (optionalInvoices) {
        await Promise.all(
          optionalInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) optionalMine.push(comoFactura(inv));
          })
        );
      }

      // Facturas de parcialidades de plan de pago del viajero
      const { data: installmentInvoices, error: error_installmentInvoices } = await supabase
        .from('cfdi_invoices')
        .select(`id, invoice_type, uuid_fiscal, folio, serie, receptor_rfc, subtotal, iva_amount, total, status, xml_url, pdf_url, stamped_at, created_at, booking_id, membership_id, installment_id, bookings(booking_code, tours(name)), booking_payment_plan_installments(label, installment_number)`)
        .eq('invoice_type', 'booking_installment')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error_installmentInvoices) {
        console.error('TravelerInvoices: fallo la consulta de facturas de parcialidades', error_installmentInvoices);
        fallos.push('parcialidades');
      }

      const installmentMine: CfdiInvoice[] = [];
      if (installmentInvoices) {
        await Promise.all(
          installmentInvoices.map(async (inv) => {
            if (!inv.booking_id) return;
            if (await esDelViajero('bookings', inv.booking_id)) installmentMine.push(inv as unknown as CfdiInvoice);
          })
        );
      }

      const all = [...bookingMine, ...membershipMine, ...checkinMine, ...supplementMine, ...insuranceMine, ...optionalMine, ...installmentMine].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setInvoices(all);
      setCargaIncompleta(fallos.length > 0);
    } catch (e) {
      // Antes no habia catch: una excepcion dejaba la lista como estuviera,
      // sin decir nada.
      console.error('TravelerInvoices: excepcion cargando las facturas', e);
      setCargaIncompleta(true);
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

      {cargaIncompleta && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-warning-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-warning-800">
              No pudimos cargar todas tus facturas
            </p>
            <p className="text-warning-700 mt-0.5">
              Puede que falte alguna en la lista. Usa <strong>Actualizar</strong> para
              intentarlo de nuevo. Si sigue faltando una factura que esperas ver,
              escríbenos y la revisamos.
            </p>
          </div>
        </div>
      )}

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
        <div className="flex flex-col gap-y-3">
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
                className="bg-white rounded-xl border border-gray-200 hover:border-primary-200 hover:shadow-xs transition-all p-4 flex items-center gap-4"
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
