import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Tag, Calendar, CreditCard, Award, ArrowRight, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

const MAX_POLL_ATTEMPTS = 12; // ~24 seconds
const POLL_INTERVAL_MS = 2000;

const SupplementSuccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [supplement, setSupplement] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const supplementId = searchParams.get('supplement_id');
    if (!supplementId) {
      setError('ID de suplemento no encontrado');
      setIsLoading(false);
      return;
    }
    pollForPaidStatus(supplementId, 0);
  }, [searchParams]);

  const pollForPaidStatus = async (supplementId: string, attempt: number) => {
    try {
      const { data } = await supabase
        .from('booking_supplements')
        .select(`
          id, status, quantity, unit_price, service_charge, membership_exemption_used,
          total_paid, paid_at, payment_method, points_earned,
          tour_supplements(name, description),
          bookings!inner(
            booking_code,
            tours!inner(name, destination, image_url, agencies(name))
          )
        `)
        .eq('id', supplementId)
        .maybeSingle();

      if (!data) {
        setError('Suplemento no encontrado');
        setIsLoading(false);
        return;
      }

      if (data.status === 'paid') {
        setSupplement(data);
        setIsLoading(false);
        return;
      }

      // Webhook hasn't fired yet — keep polling
      if (attempt < MAX_POLL_ATTEMPTS) {
        setTimeout(() => pollForPaidStatus(supplementId, attempt + 1), POLL_INTERVAL_MS);
      } else {
        // Show partial data anyway
        setSupplement(data);
        setIsLoading(false);
      }
    } catch {
      setError('Error al cargar los detalles del suplemento');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Loader className="w-10 h-10 text-teal-600 animate-spin" />
        <p className="text-gray-600 font-medium">Confirmando tu pago...</p>
      </div>
    );
  }

  if (error || !supplement) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-md p-8">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error || 'No se pudieron cargar los detalles'}</p>
          <Link to="/traveler/bookings" className="btn btn-primary">Ver Mis Reservas</Link>
        </div>
      </div>
    );
  }

  const tour = (supplement.bookings as any)?.tours;
  const agency = tour?.agencies;
  const booking = supplement.bookings as any;
  const suppInfo = supplement.tour_supplements as any;
  const subtotal = Number(supplement.unit_price) * supplement.quantity;
  const serviceCharge = Number(supplement.service_charge ?? 0);
  const exemption = Number(supplement.membership_exemption_used ?? 0);
  const totalPaid = Number(supplement.total_paid ?? 0);
  const pointsEarned = Number(supplement.points_earned ?? 0);

  const methodLabel: Record<string, string> = {
    stripe: 'Tarjeta de Crédito/Débito',
    toursred_cash: 'ToursRed Cash',
    points: 'Puntos ToursRed',
    mercadopago: 'MercadoPago',
    paypal: 'PayPal',
  };

  const isPaid = supplement.status === 'paid';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {isPaid ? '¡Pago Exitoso!' : 'Pago Recibido'}
          </h1>
          <p className="text-lg text-gray-600">
            {isPaid
              ? 'Tu suplemento ha sido confirmado.'
              : 'Tu pago está siendo procesado. El suplemento se confirmará en breve.'}
          </p>
        </div>

        {/* Tour card */}
        {tour && (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {tour.image_url && (
              <div className="relative h-40">
                <img src={tour.image_url} alt={tour.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-end">
                  <div className="p-4 text-white">
                    <p className="font-bold text-lg">{tour.name}</p>
                    <p className="text-sm opacity-90">{tour.destination}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="p-5 flex items-center gap-3 border-t border-gray-100">
              <CreditCard className="w-5 h-5 text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Código de Reserva</p>
                <p className="font-bold text-blue-600 tracking-wide text-lg">{booking?.booking_code}</p>
              </div>
              {agency?.name && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-500">Agencia</p>
                  <p className="font-medium text-gray-800 text-sm">{agency.name}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Supplement details + cost breakdown */}
        <div className="bg-white rounded-xl shadow-md p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <Tag className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">{suppInfo?.name}</p>
              {suppInfo?.description && <p className="text-sm text-gray-500 mt-0.5">{suppInfo.description}</p>}
              <p className="text-sm text-gray-600 mt-1">Cantidad: <span className="font-medium">{supplement.quantity}</span></p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">{supplement.quantity} × {formatCurrencyMXN(Number(supplement.unit_price))}</span>
              <span className="font-medium">{formatCurrencyMXN(subtotal)}</span>
            </div>

            {exemption > 0 ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cargo por Servicio (5%):</span>
                  <span className="font-medium text-gray-400 line-through">{formatCurrencyMXN(serviceCharge + exemption)}</span>
                </div>
                <div className="flex justify-between bg-green-50 border border-green-200 rounded px-2 py-1.5 -mx-1">
                  <span className="text-green-700 font-medium">Desc. Cargo (ToursRed Plus):</span>
                  <span className="font-bold text-green-600">-{formatCurrencyMXN(exemption)}</span>
                </div>
                {serviceCharge > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cargo por Servicio (a pagar):</span>
                    <span className="font-medium">{formatCurrencyMXN(serviceCharge)}</span>
                  </div>
                )}
              </>
            ) : serviceCharge > 0 ? (
              <div className="flex justify-between">
                <span className="text-gray-600">Cargo por Servicio (5%):</span>
                <span className="font-medium">{formatCurrencyMXN(serviceCharge)}</span>
              </div>
            ) : null}

            <div className="flex justify-between border-t border-gray-200 pt-2 mt-2 text-base font-bold">
              <span className="text-green-600">Total Pagado:</span>
              <span className="text-green-600">{formatCurrencyMXN(totalPaid || subtotal + serviceCharge)}</span>
            </div>
          </div>

          {/* Payment method & date */}
          <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Método de Pago</p>
              <p className="font-medium text-gray-800">
                {methodLabel[supplement.payment_method] || supplement.payment_method || 'Tarjeta de Crédito/Débito'}
              </p>
            </div>
            {supplement.paid_at && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Fecha de Pago
                </p>
                <p className="font-medium text-gray-800">
                  {format(new Date(supplement.paid_at), "d 'de' MMMM yyyy", { locale: es })}
                </p>
              </div>
            )}
          </div>

          {pointsEarned > 0 && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <span className="text-green-700 font-medium flex items-center gap-1.5">
                <Award className="w-4 h-4" />
                Puntos ToursRed Ganados:
              </span>
              <span className="font-bold text-green-600">+{pointsEarned.toLocaleString()} puntos</span>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <Link
            to="/traveler/bookings"
            className="inline-flex items-center gap-2 bg-teal-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-teal-700 transition-colors shadow-sm"
          >
            Ver Mis Reservas
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SupplementSuccessPage;
