import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Clock, Landmark, Banknote, ExternalLink, Download, AlertCircle,
  CheckCircle, ArrowRight, Home, Loader2, Calendar, Mail,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { jsPDF } from 'jspdf';

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

interface BookingInfo {
  id: string;
  booking_code: string;
  total_price: number;
  deposit_amount: number;
  user_payment: number;
  status: string;
  payment_status: string;
  tours: {
    name: string;
    destination: string;
    image_url: string;
  } | null;
}

const OpenPayPaymentPendingPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [transaction, setTransaction] = useState<PaymentTransactionMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bookingId) {
      setError('ID de reserva no encontrado');
      setIsLoading(false);
      return;
    }
    fetchData(bookingId);
  }, [bookingId]);

  const fetchData = async (id: string) => {
    try {
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

      setBooking(bookingData as BookingInfo);

      const { data: txData, error: txError } = await supabase
        .from('payment_transactions')
        .select('metadata, status, amount, payment_processor')
        .eq('booking_id', id)
        .eq('payment_processor', 'openpay')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (txError) throw txError;
      if (txData?.metadata) {
        setTransaction(txData.metadata as PaymentTransactionMeta);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar la información');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadInstructionsPdf = async () => {
    if (!booking || !transaction) return;

    setIsDownloading(true);
    try {
      const pdf = new jsPDF();
      const title = isCash ? 'Instrucciones de pago en efectivo' : 'Instrucciones de transferencia SPEI';
      const lines = [
        'ToursRed',
        title,
        `Reserva: ${booking.booking_code}`,
        `Tour: ${booking.tours?.name || 'Reserva de viaje'}`,
        `Monto a pagar: ${formatCurrencyMXN(booking.user_payment ?? booking.deposit_amount ?? 0)}`,
        '',
        ...(isCash
          ? [
              'Presenta esta referencia en una tienda afiliada:',
              `Referencia: ${transaction.reference || 'No disponible'}`,
              `Establecimiento: ${transaction.store || 'Consulta los establecimientos participantes'}`,
              transaction.expiry_date ? `Vigencia: ${transaction.expiry_date}` : '',
            ]
          : [
              'Realiza una transferencia usando estos datos:',
              `CLABE: ${transaction.clabe || 'No disponible'}`,
              `Banco: ${transaction.bank || 'No disponible'}`,
              `Referencia: ${transaction.reference || 'No disponible'}`,
            ]),
        '',
        'Completa tu pago dentro de un máximo de 3 días.',
        'Una vez validado el pago recibirás un correo con la confirmación de tu reserva.',
      ].filter(Boolean);

      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(lines[0], 20, 24);
      pdf.setFontSize(14);
      pdf.text(lines[1], 20, 36);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text(lines.slice(2), 20, 52, { maxWidth: 170, lineHeightFactor: 1.6 });

      if (isCash && transaction.barcode_url) {
        try {
          const barcodeResponse = await fetch(transaction.barcode_url);
          if (barcodeResponse.ok) {
            const barcodeBlob = await barcodeResponse.blob();
            const barcodeDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(barcodeBlob);
            });
            pdf.addImage(barcodeDataUrl, 'PNG', 35, 142, 140, 40);
            pdf.setFontSize(9);
            pdf.text('Muestra este código de barras en la tienda.', 105, 188, { align: 'center' });
          }
        } catch {
          // El PDF conserva la referencia aunque el proveedor bloquee la descarga de la imagen.
        }
      }

      pdf.save(`instrucciones-pago-${booking.booking_code}.pdf`);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error || 'No se pudo cargar la reserva'}</p>
          <Link to="/traveler/bookings" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
            Ver mis reservas
          </Link>
        </div>
      </div>
    );
  }

  const isSpei = transaction?.openpay_method === 'spei';
  const isCash = transaction?.openpay_method === 'cash';
  const amount = booking.user_payment ?? booking.deposit_amount ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Success header */}
        <div className="text-center mb-6">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Reserva creada correctamente</h1>
          <p className="text-gray-600">
            Tu código de reserva es{' '}
            <span className="font-bold text-primary-600 tracking-wide">{booking.booking_code}</span>
          </p>
        </div>

        {/* 3-day deadline alert */}
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Tienes 3 días para completar el pago</p>
              <p className="text-sm text-amber-800 mt-1">
                Tu reserva no será cancelada por falta de pago durante este período.
                Una vez que recibamos y validemos tu pago, te enviaremos un correo electrónico
                con la confirmación de tu reserva.
              </p>
            </div>
          </div>
        </div>

        {/* Tour summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          {booking.tours?.image_url && (
            <div className="relative h-32">
              <img
                src={booking.tours.image_url}
                alt={booking.tours.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 flex items-end">
                <div className="p-4 text-white">
                  <h2 className="text-lg font-bold">{booking.tours.name}</h2>
                  <p className="text-sm">{booking.tours.destination}</p>
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

            {/* PDF download */}
            <button
              type="button"
              onClick={downloadInstructionsPdf}
              disabled={isDownloading}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors w-full justify-center"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Preparando PDF...' : 'Descargar instrucciones (PDF)'}
            </button>
          </div>
        ) : (
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
        )}

        {/* Email confirmation notice */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-blue-900">
                <strong>¿Qué pasa después?</strong> Una vez que tu pago sea confirmado,
                recibirás un correo electrónico con la confirmación de tu reserva y
                todos los detalles de tu tour.
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            to="/traveler/bookings"
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition-colors"
          >
            Ver mis reservas
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/tours"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Explorar más tours
          </Link>
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