import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { XCircle, ArrowLeft, Home, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

const BookingCancelPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get('booking_id');

    if (id) {
      updateBookingStatus(id);
    } else {
      setIsLoading(false);
    }
  }, [searchParams]);

  const updateBookingStatus = async (id: string) => {
    try {
      setIsLoading(true);

      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-payment-cancellation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ booking_id: id }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error('Error processing cancellation:', result.error || response.status);
      }

      if (result.booking_code) {
        setBookingCode(result.booking_code);
      }
    } catch (err: any) {
      console.error('Error in updateBookingStatus:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryPayment = () => {
    window.history.back();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-6">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
          
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Pago Cancelado
          </h2>
          
          <p className="text-gray-600 mb-6">
            Tu pago fue cancelado. No se realizaron cargos a tu tarjeta.
            {bookingCode && ' Tu reserva ha sido marcada como cancelada.'}
          </p>

          {bookingCode && (
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <h3 className="text-sm font-medium text-gray-900 mb-2">ID de Reserva</h3>
              <p className="text-xs font-mono text-gray-600">{bookingCode}</p>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleRetryPayment}
              className="w-full flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Intentar de Nuevo
            </button>
            
            <Link
              to="/tours"
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Explorar Otros Tours
            </Link>

            <Link
              to="/"
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Home className="mr-2 h-4 w-4" />
              Volver al Inicio
            </Link>
          </div>

          <div className="mt-6 text-xs text-gray-500">
            <p>
              Si tienes problemas con el pago o necesitas ayuda, 
              <a href="/contact" className="text-primary-600 hover:text-primary-700 ml-1">
                contáctanos
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingCancelPage;