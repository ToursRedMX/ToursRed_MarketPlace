import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Shield, Tag, Calendar, CreditCard, Award, ArrowRight, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

const MAX_POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 2000;

const ExtrasSuccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookingData, setBookingData] = useState<any>(null);
  const [bosData, setBosData] = useState<any>(null);

  const extraType = searchParams.get('type'); // 'insurance' | 'optional_service'
  const bookingId = searchParams.get('booking_id');
  const bosId = searchParams.get('bos_id');

  useEffect(() => {
    if (!extraType) {
      setError('Tipo de extra no especificado');
      setIsLoading(false);
      return;
    }
    if (extraType === 'insurance') {
      if (!bookingId) { setError('ID de reserva no encontrado'); setIsLoading(false); return; }
      pollInsurance(bookingId, 0);
    } else if (extraType === 'optional_service') {
      if (!bosId) { setError('ID de servicio no encontrado'); setIsLoading(false); return; }
      pollOptionalService(bosId, 0);
    } else {
      setError('Tipo de extra no válido');
      setIsLoading(false);
    }
  }, []);

  const pollInsurance = async (bId: string, attempt: number) => {
    try {
      const { data } = await supabase
        .from('bookings')
        .select(`
          id, booking_code, travel_insurance_included, travel_insurance_cost,
          travelers_count, selected_date,
          tours!inner(name, destination, image_url, agencies(name))
        `)
        .eq('id', bId)
        .maybeSingle();

      if (!data) { setError('Reserva no encontrada'); setIsLoading(false); return; }

      if (data.travel_insurance_included) {
        setBookingData(data);
        setIsLoading(false);
        return;
      }

      if (attempt < MAX_POLL_ATTEMPTS) {
        setTimeout(() => pollInsurance(bId, attempt + 1), POLL_INTERVAL_MS);
      } else {
        setBookingData(data);
        setIsLoading(false);
      }
    } catch {
      setError('Error al cargar los detalles del seguro');
      setIsLoading(false);
    }
  };

  const pollOptionalService = async (bos: string, attempt: number) => {
    try {
      const { data } = await supabase
        .from('booking_optional_services')
        .select(`
          id, quantity, unit_price, subtotal, created_at,
          tour_optional_services!inner(name, description),
          bookings!inner(
            booking_code, travelers_count,
            tours!inner(name, destination, image_url, agencies(name))
          )
        `)
        .eq('id', bos)
        .maybeSingle();

      if (!data) {
        if (attempt < MAX_POLL_ATTEMPTS) {
          setTimeout(() => pollOptionalService(bos, attempt + 1), POLL_INTERVAL_MS);
        } else {
          setError('Servicio no encontrado');
          setIsLoading(false);
        }
        return;
      }

      setBosData(data);
      setIsLoading(false);
    } catch {
      setError('Error al cargar los detalles del servicio');
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

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-md p-8">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link to="/traveler/bookings" className="btn btn-primary">Ver Mis Reservas</Link>
        </div>
      </div>
    );
  }

  const methodLabel: Record<string, string> = {
    stripe: 'Tarjeta de Crédito/Débito',
    toursred_cash: 'ToursRed Cash',
    points: 'Puntos ToursRed',
    mercadopago: 'MercadoPago',
    paypal: 'PayPal',
  };

  // ── Insurance success ─────────────────────────────────────────────────
  if (extraType === 'insurance' && bookingData) {
    const tour = bookingData.tours;
    const agency = tour?.agencies;
    const confirmed = bookingData.travel_insurance_included;
    const insuranceCost = Number(bookingData.travel_insurance_cost || 0);

    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {confirmed ? '¡Seguro Activado!' : 'Pago Recibido'}
            </h1>
            <p className="text-lg text-gray-600">
              {confirmed
                ? 'Tu seguro de asistencia de viaje ha sido contratado.'
                : 'Tu pago está siendo procesado. El seguro se activará en breve.'}
            </p>
          </div>

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
                  <p className="font-bold text-blue-600 tracking-wide text-lg">{bookingData.booking_code}</p>
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

          <div className="bg-white rounded-xl shadow-md p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-lg">Seguro de Asistencia de Viaje</p>
                <p className="text-sm text-gray-500 mt-0.5">Cobertura completa durante tu viaje</p>
                <p className="text-sm text-gray-600 mt-1">
                  Viajeros: <span className="font-medium">{bookingData.travelers_count || 1}</span>
                </p>
              </div>
            </div>

            {insuranceCost > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex justify-between text-base font-bold">
                  <span className="text-green-600">Total Pagado:</span>
                  <span className="text-green-600">{formatCurrencyMXN(insuranceCost)}</span>
                </div>
              </div>
            )}

            {confirmed && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-blue-700 font-medium text-sm">
                  Seguro activo — recibirás más detalles por correo.
                </span>
              </div>
            )}
          </div>

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
  }

  // ── Optional service success ──────────────────────────────────────────
  if (extraType === 'optional_service' && bosData) {
    const tour = (bosData.bookings as any)?.tours;
    const agency = tour?.agencies;
    const booking = bosData.bookings as any;
    const serviceInfo = bosData.tour_optional_services as any;
    const subtotal = Number(bosData.subtotal || Number(bosData.unit_price) * bosData.quantity);

    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">¡Servicio Agregado!</h1>
            <p className="text-lg text-gray-600">Tu servicio opcional ha sido confirmado.</p>
          </div>

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

          <div className="bg-white rounded-xl shadow-md p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-teal-100 rounded-lg">
                <Tag className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-lg">{serviceInfo?.name}</p>
                {serviceInfo?.description && <p className="text-sm text-gray-500 mt-0.5">{serviceInfo.description}</p>}
                <p className="text-sm text-gray-600 mt-1">Cantidad: <span className="font-medium">{bosData.quantity}</span></p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{bosData.quantity} × {formatCurrencyMXN(Number(bosData.unit_price))}</span>
                <span className="font-medium">{formatCurrencyMXN(subtotal)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 mt-2 text-base font-bold">
                <span className="text-green-600">Total Pagado:</span>
                <span className="text-green-600">{formatCurrencyMXN(subtotal)}</span>
              </div>
            </div>

            {bosData.created_at && (
              <div className="border-t border-gray-100 pt-4 text-sm">
                <p className="text-gray-500 text-xs mb-0.5 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Fecha de Compra
                </p>
                <p className="font-medium text-gray-800">
                  {format(new Date(bosData.created_at), "d 'de' MMMM yyyy", { locale: es })}
                </p>
              </div>
            )}
          </div>

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
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full text-center bg-white rounded-xl shadow-md p-8">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Pago Procesado</h2>
        <p className="text-gray-600 mb-6">Tu pago fue recibido exitosamente.</p>
        <Link to="/traveler/bookings" className="inline-flex items-center gap-2 bg-teal-600 text-white font-semibold px-6 py-2.5 rounded-xl hover:bg-teal-700 transition-colors">
          Ver Mis Reservas <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};

export default ExtrasSuccessPage;
