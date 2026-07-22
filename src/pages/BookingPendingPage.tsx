import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Clock, CheckCircle, MapPin, Users, Calendar, ArrowRight, Home, Bell } from 'lucide-react';
import { supabase, parseDateFromDB } from '../lib/supabase';
import { Booking, Tour } from '../types';
import { format } from 'date-fns';
import { formatCurrencyMXN } from '../utils/formatCurrency';

const BookingPendingPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (bookingId) {
      fetchBookingDetails(bookingId);
    } else {
      setError('ID de reserva no encontrado');
      setIsLoading(false);
    }
  }, [bookingId]);

  const fetchBookingDetails = async (bookingId: string) => {
    try {
      setIsLoading(true);
      
      // Fetch booking with tour details
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select(`
          *,
          tours(
            id,
            name,
            destination,
            image_url,
            start_date,
            end_date,
            agencies(name, contact_email)
          )
        `)
        .eq('id', bookingId)
        .maybeSingle();

      if (bookingError) {
        throw new Error(bookingError.message);
      }

      if (!bookingData) {
        throw new Error('Reserva no encontrada');
      }

      setBooking(bookingData);
      setTour(bookingData.tours);

    } catch (err: any) {
      setError(err.message || 'Error al cargar los detalles de la reserva');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to format dates consistently
  const formatDate = (dateString: string) => {
    try {
      const date = parseDateFromDB(dateString);
      return format(date, 'EEEE, d \'de\' MMMM \'de\' yyyy');
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return format(new Date(dateString), 'dd/MM/yyyy');
    }
  };

  const formatShortDate = (dateString: string) => {
    try {
      const date = parseDateFromDB(dateString);
      return format(date, 'd \'de\' MMMM');
    } catch (error) {
      console.error('Error formatting short date:', dateString, error);
      return format(new Date(dateString), 'dd/MM');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !booking || !tour) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-blue-100 rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
            <p className="text-gray-600 mb-4">{error || 'No se pudieron cargar los detalles de la reserva'}</p>
            <Link to="/traveler/bookings" className="btn btn-primary">
              Ver Mis Reservas
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Pending Header */}
        <div className="text-center mb-8">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100 mb-4">
            <Clock className="h-8 w-8 text-yellow-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            ¡Solicitud Enviada!
          </h1>
          <p className="text-lg text-gray-600">
            Tu solicitud de reserva ha sido enviada a la agencia y está pendiente de aprobación.
          </p>
        </div>

        {/* Booking Details */}
        <div className="bg-blue-100 rounded-lg shadow-md overflow-hidden mb-6">
          <div className="relative h-48">
            <img
              src={tour.image_url}
              alt={tour.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black bg-opacity-40 flex items-end">
              <div className="p-6 text-white">
                <h2 className="text-2xl font-bold mb-2">{tour.name}</h2>
                <div className="flex items-center">
                  <MapPin className="h-4 w-4 mr-1" />
                  <span>{tour.destination}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Detalles de tu Solicitud</h3>
                <div className="space-y-3">
                  <div className="flex items-start">
                    <Calendar className="h-5 w-5 text-gray-400 mr-3 mt-1" />
                    <div>
                      <div className="text-sm text-gray-500">Fecha Seleccionada</div>
                      <div className="font-medium">{formatDate(booking.booking_date)}</div>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <Calendar className="h-5 w-5 text-gray-400 mr-3 mt-1" />
                    <div>
                      <div className="text-sm text-gray-500">Duración del Tour</div>
                      <div className="font-medium">
                        {formatShortDate(tour.start_date)} - {formatShortDate(tour.end_date)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center">
                    <Users className="h-5 w-5 text-gray-400 mr-3" />
                    <div>
                      <div className="text-sm text-gray-500">Viajeros</div>
                      <div className="font-medium">{booking.travelers_count} {booking.travelers_count === 1 ? 'persona' : 'personas'}</div>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="h-5 w-5 text-gray-400 mr-3 mt-1 text-sm font-bold">🎫</div>
                    <div>
                      <div className="text-sm text-gray-500">Código de Reserva</div>
                      <div className="font-bold text-blue-600 text-lg tracking-wide">{booking.booking_code}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">Información de Pago</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Precio Total del Tour:</span>
                    <span className="font-medium">{formatCurrencyMXN(booking.total_price ?? 0)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Depósito a Pagar:</span>
                    <span className="font-medium">{formatCurrencyMXN(booking.deposit_amount ?? 0)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Cargo por Servicio:</span>
                    <span className="font-medium">{formatCurrencyMXN(booking.service_charge ?? 0)}</span>
                  </div>

                  {(booking as any).membership_purchased && (
                    <div className="flex justify-between text-indigo-700">
                      <span>Membresía ToursRed Plus ({(booking as any).membership_plan === 'monthly' ? 'Mensual' : 'Anual'}):</span>
                      <span className="font-medium">+{formatCurrencyMXN(Number((booking as any).membership_cost) || 0)}</span>
                    </div>
                  )}

                  {(booking as any).travel_insurance_cost > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Seguro de Viaje:</span>
                      <span className="font-medium">+{formatCurrencyMXN((booking as any).travel_insurance_cost)}</span>
                    </div>
                  )}

                  {(booking as any).points_used > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Puntos ToursRed ({(booking as any).points_used} pts):</span>
                      <span className="font-medium">-{formatCurrencyMXN((booking as any).points_used / 100)}</span>
                    </div>
                  )}

                  {(booking as any).toursred_cash_used > 0 && (
                    <div className="flex justify-between text-blue-700">
                      <span>ToursRed Cash:</span>
                      <span className="font-medium">-{formatCurrencyMXN((booking as any).toursred_cash_used)}</span>
                    </div>
                  )}

                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <div className="flex justify-between text-lg font-bold">
                      <span className="text-yellow-600">Total a Pagar (si se aprueba):</span>
                      <span className="text-yellow-600">{formatCurrencyMXN(booking.user_payment ?? 0)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-sm text-yellow-800">
                    <strong>Sin cargo por ahora:</strong> No se realizará ningún cargo hasta que la agencia apruebe tu solicitud.
                    {(() => {
                      const pointsValue = ((booking as any).points_used || 0) / 100;
                      const cashUsed = (booking as any).toursred_cash_used || 0;
                      const totalCovered = pointsValue + cashUsed;
                      const totalToPay = booking.user_payment ?? 0;
                      return totalToPay > 0 && totalCovered >= totalToPay
                        ? ' Al ser aprobada, el pago se procesará automáticamente con tus beneficios ToursRed.'
                        : null;
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Information */}
        <div className="bg-blue-100 rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Bell className="h-5 w-5 mr-2 text-yellow-600" />
            Estado de tu Solicitud
          </h3>
          
          <div className="space-y-4">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <CheckCircle className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <div className="font-medium text-green-800">Solicitud Enviada</div>
                <div className="text-sm text-gray-600">Tu solicitud ha sido enviada a {tour.agencies?.name}</div>
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-yellow-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <Clock className="h-4 w-4 text-yellow-600" />
              </div>
              <div>
                <div className="font-medium text-yellow-800">Pendiente de Aprobación</div>
                <div className="text-sm text-gray-600">La agencia revisará tu solicitud y te notificará su decisión</div>
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <span className="text-gray-400 text-sm font-bold">3</span>
              </div>
              <div>
                {(() => {
                  const pointsValue = ((booking as any).points_used || 0) / 100;
                  const cashUsed = (booking as any).toursred_cash_used || 0;
                  const totalCovered = pointsValue + cashUsed;
                  const totalToPay = booking.user_payment ?? 0;
                  const autoConfirm = totalToPay > 0 && totalCovered >= totalToPay;
                  return autoConfirm ? (
                    <>
                      <div className="font-medium text-gray-500">Confirmación Automática</div>
                      <div className="text-sm text-gray-500">Al aprobarse, tu reserva se confirmará automáticamente con tus puntos y saldo ToursRed</div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-gray-500">Pago (Pendiente)</div>
                      <div className="text-sm text-gray-500">Una vez aprobada, podrás proceder con el pago</div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-blue-100 rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">¿Qué Sigue?</h3>
          <div className="space-y-3">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <span className="text-primary-600 text-sm font-bold">1</span>
              </div>
              <div>
                <div className="font-medium">Espera la Respuesta</div>
                <div className="text-sm text-gray-600">
                  {tour.agencies?.name} revisará tu solicitud. Esto puede tomar desde unas horas hasta 1-2 días.
                </div>
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <span className="text-primary-600 text-sm font-bold">2</span>
              </div>
              <div>
                <div className="font-medium">Recibe Notificación</div>
                <div className="text-sm text-gray-600">
                  Te notificaremos por email y en la plataforma cuando la agencia responda
                </div>
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                <span className="text-primary-600 text-sm font-bold">3</span>
              </div>
              <div>
                {(() => {
                  const pointsValue = ((booking as any).points_used || 0) / 100;
                  const cashUsed = (booking as any).toursred_cash_used || 0;
                  const totalCovered = pointsValue + cashUsed;
                  const totalToPay = booking.user_payment ?? 0;
                  const autoConfirm = totalToPay > 0 && totalCovered >= totalToPay;
                  return autoConfirm ? (
                    <>
                      <div className="font-medium">Confirmación Automática</div>
                      <div className="text-sm text-gray-600">
                        Si tu solicitud es aprobada, tu reserva se confirmará y el pago se procesará automáticamente con tus beneficios ToursRed
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium">Procede con el Pago</div>
                      <div className="text-sm text-gray-600">
                        Si tu solicitud es aprobada, podrás completar el pago de forma segura
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        {tour.agencies?.contact_email && (
          <div className="bg-blue-100 rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Contacto Directo</h3>
            <p className="text-gray-600 mb-3">
              Si tienes preguntas urgentes sobre tu solicitud, puedes contactar directamente a la agencia:
            </p>
            <a
              href={`mailto:${tour.agencies.contact_email}?subject=Consulta sobre solicitud de reserva - ${tour.name}`}
              className="text-primary-600 hover:text-primary-700 font-medium"
            >
              {tour.agencies.contact_email}
            </a>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/traveler/bookings"
            className="btn btn-primary flex items-center justify-center"
          >
            Ver Mis Reservas
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          
          <Link
            to="/tours"
            className="btn btn-outline flex items-center justify-center"
          >
            Explorar Más Tours
          </Link>
          
          <Link
            to="/"
            className="btn btn-outline flex items-center justify-center"
          >
            <Home className="mr-2 h-4 w-4" />
            Volver al Inicio
          </Link>
        </div>
      </div>
    </div>
  );
};

export default BookingPendingPage;