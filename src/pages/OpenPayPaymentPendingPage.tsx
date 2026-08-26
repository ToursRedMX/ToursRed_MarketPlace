import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Clock, Landmark, Banknote, ExternalLink, Download, AlertCircle,
  CheckCircle, ArrowRight, Home, Loader2, Calendar, Mail,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrencyMXN } from '../utils/formatCurrency';

interface PaymentTransactionMeta {
  openpay_method?: string;
  openpay_charge_id?: string;
  openpay_status?: string;
  clabe?: string;
  bank?: string;
  reference?: string;
  store?: string;
  expiry_date?: string;
  barcode_url?: string;
  spei_pdf_url?: string;
  cash_pdf_url?: string;
}

interface ContextSummary {
  title: string;
  tourName: string;
  destination?: string;
  imageUrl?: string;
  bookingCode?: string;
  amount: number;
}

const OpenPayPaymentPendingPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [searchParams] = useSearchParams();
  const rawContext = searchParams.get('context') || 'booking_deposit';
  const context = rawContext === 'booking' ? 'booking_deposit' : rawContext;

  const [summary, setSummary] = useState<ContextSummary | null>(null);
  const [transaction, setTransaction] = useState<PaymentTransactionMeta | null>(null);
  const [txStatus, setTxStatus] = useState<string>('');
  const [txAmount, setTxAmount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bookingId) {
      setError('ID no encontrado');
      setIsLoading(false);
      return;
    }
    fetchData(bookingId, context);
  }, [bookingId, context]);

  const fetchData = async (id: string, ctx: string) => {
    try {
      // For featured_slot, metadata lives on featured_tour_slots, not payment_transactions
      if (ctx === 'featured_slot') {
        const { data: slot, error: slotError } = await supabase
          .from('featured_tour_slots')
          .select(`
            id, total_amount, pending_payment_metadata,
            tours ( name, destination, image_url ),
            featured_plans ( name )
          `)
          .eq('id', id)
          .maybeSingle();

        if (slotError) throw slotError;
        if (!slot) throw new Error('Slot no encontrado');

        const meta = slot.pending_payment_metadata as PaymentTransactionMeta | null;
        if (meta) setTransaction(meta);

        setSummary({
          title: 'Tour destacado activado correctamente',
          tourName: (slot.tours as any)?.name || 'Tour destacado',
          destination: (slot.tours as any)?.destination,
          imageUrl: (slot.tours as any)?.image_url,
          amount: Number(slot.total_amount) || 0,
        });
        setTxAmount(Number(slot.total_amount) || 0);
        setTxStatus(meta?.openpay_status || 'pending');
        setIsLoading(false);
        return;
      }

      // gift_card context: use server function to bypass RLS for anonymous users
      if (ctx === 'gift_card') {
        await fetchGiftCardSummary(id);
        return;
      }

      // All other contexts: query payment_transactions by charge_reference_id + charge_context
      const { data: txData, error: txError } = await supabase
        .from('payment_transactions')
        .select('metadata, status, amount, payment_processor')
        .eq('charge_reference_id', id)
        .eq('charge_context', ctx)
        .eq('payment_processor', 'openpay')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (txError) throw txError;
      if (txData?.metadata) {
        setTransaction(txData.metadata as PaymentTransactionMeta);
      }
      if (txData?.status) {
        setTxStatus(txData.status);
      }
      if (txData?.amount) {
        setTxAmount(Number(txData.amount));
      }

      // Fetch context-specific summary
      await fetchContextSummary(id, ctx, txData?.amount);
    } catch (err: any) {
      setError(err.message || 'Error al cargar la información');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchContextSummary = async (id: string, ctx: string, txAmount: number | undefined) => {
    try {
      if (ctx === 'booking_deposit' || ctx === 'insurance') {
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .select(`
            id, booking_code, total_price, deposit_amount, user_payment,
            status, payment_status,
            tours ( name, destination, image_url )
          `)
          .eq('id', id)
          .maybeSingle();

        if (bookingError) throw bookingError;
        if (!bookingData) throw new Error('Reserva no encontrada');

        const amount = ctx === 'insurance'
          ? (txAmount ?? 0)
          : (bookingData.user_payment ?? bookingData.deposit_amount ?? 0);

        setSummary({
          title: ctx === 'insurance'
            ? 'Seguro de viaje agregado correctamente'
            : 'Reserva creada correctamente',
          tourName: (bookingData.tours as any)?.name || 'Tour',
          destination: (bookingData.tours as any)?.destination,
          imageUrl: (bookingData.tours as any)?.image_url,
          bookingCode: bookingData.booking_code,
          amount,
        });
        setTxAmount(amount);
      } else if (ctx === 'supplement') {
        const { data: supp, error: suppError } = await supabase
          .from('booking_supplements')
          .select(`
            id, total_paid,
            tour_supplements ( name ),
            bookings ( booking_code, tours ( name, destination, image_url ) )
          `)
          .eq('id', id)
          .maybeSingle();

        if (suppError) throw suppError;
        if (!supp) throw new Error('Suplemento no encontrado');

        const booking = (supp as any).bookings;
        setSummary({
          title: 'Suplemento creado correctamente',
          tourName: booking?.tours?.name || 'Tour',
          destination: booking?.tours?.destination,
          imageUrl: booking?.tours?.image_url,
          bookingCode: booking?.booking_code,
          amount: Number((supp as any).total_paid) || txAmount || 0,
        });
        setTxAmount(Number((supp as any).total_paid) || txAmount || 0);
      } else if (ctx === 'optional_service') {
        const { data: os, error: osError } = await supabase
          .from('booking_optional_services')
          .select(`
            id, total_paid,
            tour_optional_services ( name ),
            bookings ( booking_code, tours ( name, destination, image_url ) )
          `)
          .eq('id', id)
          .maybeSingle();

        if (osError) throw osError;
        if (!os) throw new Error('Servicio opcional no encontrado');

        const booking = (os as any).bookings;
        setSummary({
          title: 'Servicio opcional agregado correctamente',
          tourName: booking?.tours?.name || 'Tour',
          destination: booking?.tours?.destination,
          imageUrl: booking?.tours?.image_url,
          bookingCode: booking?.booking_code,
          amount: Number((os as any).total_paid) || txAmount || 0,
        });
        setTxAmount(Number((os as any).total_paid) || txAmount || 0);
      } else if (ctx === 'payment_plan_installment') {
        const { data: plan, error: planError } = await supabase
          .from('booking_payment_plans')
          .select(`
            id,
            bookings ( booking_code, tours ( name, destination, image_url ) )
          `)
          .eq('id', id)
          .maybeSingle();

        if (planError) throw planError;
        if (!plan) throw new Error('Plan de pago no encontrado');

        const booking = (plan as any).bookings;
        setSummary({
          title: 'Abono registrado correctamente',
          tourName: booking?.tours?.name || 'Tour',
          destination: booking?.tours?.destination,
          imageUrl: booking?.tours?.image_url,
          bookingCode: booking?.booking_code,
          amount: txAmount || 0,
        });
      } else if (ctx === 'gift_card') {
        const { data: gc, error: gcError } = await supabase
          .from('gift_cards')
          .select('id, amount, recipient_name')
          .eq('id', id)
          .maybeSingle();

        if (gcError) throw gcError;
        if (!gc) throw new Error('Tarjeta de regalo no encontrada');

        setSummary({
          title: 'Tarjeta de regalo creada correctamente',
          tourName: `Tarjeta de Regalo ToursRed`,
          amount: Number(gc.amount) || txAmount || 0,
        });
        setTxAmount(Number(gc.amount) || txAmount || 0);
      } else {
        setSummary({
          title: 'Pago en proceso',
          tourName: 'Pago',
          amount: txAmount || 0,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar la información');
    }
  };

  const fetchGiftCardSummary = async (id: string) => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-gift-card-status`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ gift_card_id: id }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al consultar la tarjeta de regalo');
      }

      const data = await response.json();

      if (data.payment_instructions) {
        const instr = data.payment_instructions;
        setTransaction({
          openpay_method: instr.openpay_method || undefined,
          openpay_status: instr.openpay_status || undefined,
          clabe: instr.clabe || undefined,
          bank: instr.bank || undefined,
          reference: instr.reference || undefined,
          store: instr.store || undefined,
          expiry_date: instr.expiry_date || undefined,
          barcode_url: instr.barcode_url || undefined,
          spei_pdf_url: instr.spei_pdf_url || undefined,
          cash_pdf_url: instr.cash_pdf_url || undefined,
        });
      }

      setTxStatus(data.tx_status || data.payment_status || 'pending');
      const effectiveAmount = (Number(data.amount) || 0) - (Number(data.discount_amount) || 0);
      setTxAmount(data.tx_amount || effectiveAmount);

      setSummary({
        title: 'Tarjeta de regalo creada correctamente',
        tourName: `Tarjeta de Regalo ToursRed`,
        amount: effectiveAmount,
      });
    } catch (err: any) {
      setError(err.message || 'Error al cargar la información');
    }
  };

  const openPdf = () => {
    const pdfUrl = isSpei ? transaction?.spei_pdf_url : transaction?.cash_pdf_url;
    if (!pdfUrl) return;
    setIsOpeningPdf(true);
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => setIsOpeningPdf(false), 1500);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error || 'No se pudo cargar la información'}</p>
          <Link to="/traveler/bookings" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
            Ver mis reservas
          </Link>
        </div>
      </div>
    );
  }

  const isSpei = transaction?.openpay_method === 'spei';
  const isCash = transaction?.openpay_method === 'cash';
  const amount = txAmount || summary.amount || 0;
  const isTxPending = txStatus === 'pending' || !txStatus;
  const pdfUrl = isSpei ? transaction?.spei_pdf_url : transaction?.cash_pdf_url;
  const canDownloadPdf = isTxPending && !!pdfUrl;
  const isFeaturedSlot = context === 'featured_slot';
  const isGiftCard = context === 'gift_card';
  const backLink = isFeaturedSlot ? '/agency/tours' : isGiftCard ? '/' : '/traveler/bookings';
  const backLabel = isFeaturedSlot ? 'Mis tours' : isGiftCard ? 'Ir al inicio' : 'Ver mis reservas';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Success header */}
        <div className="text-center mb-6">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{summary.title}</h1>
          {summary.bookingCode && (
            <p className="text-gray-600">
              Tu código de reserva es{' '}
              <span className="font-bold text-primary-600 tracking-wide">{summary.bookingCode}</span>
            </p>
          )}
        </div>

        {/* 3-day deadline alert — solo si el pago sigue pendiente */}
        {isTxPending ? (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Tienes 3 días para completar el pago</p>
                <p className="text-sm text-amber-800 mt-1">
                  {context === 'gift_card'
                    ? 'Tu tarjeta de regalo no será cancelada por falta de pago durante este período.'
                    : context === 'featured_slot'
                      ? 'Tu slot destacado no será cancelado por falta de pago durante este período.'
                      : 'Tu reserva no será cancelada por falta de pago durante este período.'}
                  Una vez que recibamos y validemos tu pago, te enviaremos un correo electrónico
                  con la confirmación.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900">Tu pago fue confirmado</p>
                <p className="text-sm text-green-800 mt-1">
                  {context === 'gift_card'
                    ? 'Tu tarjeta de regalo ya está activa. Revisa tu correo para ver el código y los detalles.'
                    : context === 'featured_slot'
                      ? 'Tu tour destacado ya está activo.'
                      : 'Recibirás un correo electrónico con la confirmación y todos los detalles.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tour summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          {summary.imageUrl && (
            <div className="relative h-32">
              <img
                src={summary.imageUrl}
                alt={summary.tourName}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 flex items-end">
                <div className="p-4 text-white">
                  <h2 className="text-lg font-bold">{summary.tourName}</h2>
                  {summary.destination && <p className="text-sm">{summary.destination}</p>}
                </div>
              </div>
            </div>
          )}
          <div className="p-4 flex justify-between items-center">
            <span className="text-sm text-gray-600">Monto a pagar</span>
            <span className="text-xl font-bold text-primary-600">{formatCurrencyMXN(amount)}</span>
          </div>
        </div>

        {/* Payment instructions */}
        {transaction && (isSpei || isCash) ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              {isSpei ? (
                <Landmark className="w-5 h-5 text-blue-600" />
              ) : (
                <Banknote className="w-5 h-5 text-blue-600" />
              )}
              <h3 className="font-bold text-gray-900">
                {isSpei ? 'Instrucciones de Transferencia SPEI' : 'Instrucciones de Pago en Efectivo'}
              </h3>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              {isSpei
                ? 'Realiza una transferencia bancaria usando los siguientes datos:'
                : 'Acude a cualquiera de las tiendas afiliadas y proporciona la siguiente referencia:'}
            </p>

            <div className="space-y-3">
              {/* SPEI data */}
              {isSpei && transaction.clabe && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">CLABE interbancaria</span>
                  <span className="font-mono font-semibold text-gray-900">{transaction.clabe}</span>
                </div>
              )}
              {isSpei && transaction.bank && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Banco</span>
                  <span className="font-semibold text-gray-900">{transaction.bank}</span>
                </div>
              )}
              {isSpei && transaction.reference && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Referencia</span>
                  <span className="font-mono font-semibold text-gray-900">{transaction.reference}</span>
                </div>
              )}

              {/* Cash data */}
              {isCash && transaction.reference && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Referencia de pago</span>
                  <span className="font-mono font-semibold text-gray-900">{transaction.reference}</span>
                </div>
              )}
              {isCash && transaction.store && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Establecimientos aceptados</span>
                  <span className="font-semibold text-gray-900">{transaction.store}</span>
                </div>
              )}
              {isCash && transaction.expiry_date && (
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Vence el</span>
                  <span className="font-semibold text-gray-900">{transaction.expiry_date}</span>
                </div>
              )}
            </div>

            {/* Barcode for cash payments */}
            {isCash && transaction.barcode_url && (
              <div className="mt-4 text-center">
                <div className="p-4 bg-white border-2 border-gray-200 rounded-lg inline-block">
                  <img
                    src={transaction.barcode_url}
                    alt="Código de barras"
                    className="h-32 mx-auto"
                  />
                  <p className="text-xs text-gray-500 mt-2">Muestra este código en la tienda</p>
                </div>
              </div>
            )}

            {/* PDF download — Openpay only serves the PDF while the transaction is pending */}
            {canDownloadPdf ? (
              <button
                type="button"
                onClick={openPdf}
                disabled={isOpeningPdf}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors w-full justify-center"
              >
                <Download className="w-4 h-4" />
                {isOpeningPdf ? 'Abriendo PDF...' : 'Descargar instrucciones (PDF)'}
              </button>
            ) : pdfUrl && !isTxPending ? (
              <p className="mt-4 text-sm text-gray-500 text-center">
                El recibo de pago ya no está disponible porque la transacción ya no está pendiente.
              </p>
            ) : null}
          </div>
        ) : isTxPending ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900">Pago en proceso</p>
                <p className="text-sm text-gray-600 mt-1">
                  Tu pago está siendo procesado. Recibirás un correo de confirmación
                  una vez que se haya completado.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900">Pago completado con tarjeta</p>
                <p className="text-sm text-gray-600 mt-1">
                  Tu pago fue procesado exitosamente.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Email confirmation notice */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-blue-900">
                <strong>¿Qué pasa después?</strong> Una vez que tu pago sea confirmado,
                recibirás un correo electrónico con la confirmación y
                todos los detalles.
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            to={backLink}
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition-colors"
          >
            {backLabel}
            <ArrowRight className="w-4 h-4" />
          </Link>
          {!isFeaturedSlot && (
            <Link
              to="/tours"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              Explorar más tours
            </Link>
          )}
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Home className="w-4 h-4" />
            Inicio
          </Link>
        </div>
      </div>
    </div>
  );
};

export default OpenPayPaymentPendingPage;
