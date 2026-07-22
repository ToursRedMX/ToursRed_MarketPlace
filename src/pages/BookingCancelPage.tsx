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

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('booking_code, user_id, points_used, toursred_cash_used')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error('Error fetching booking:', fetchError);
        setIsLoading(false);
        return;
      }

      setBookingCode(booking.booking_code);

      const pointsUsed = booking.points_used || 0;
      const toursRedCashUsed = parseFloat(booking.toursred_cash_used || '0');

      if (pointsUsed > 0) {
        const { error: pointsError } = await supabase.rpc('refund_points_for_cancelled_booking', {
          p_booking_id: id,
          p_points_to_refund: pointsUsed
        });

        if (pointsError) {
          console.error('Error refunding points:', pointsError);
        }
      }

      if (toursRedCashUsed > 0) {
        const { error: cashError } = await supabase.rpc('update_wallet_balance', {
          p_user_id: booking.user_id,
          p_amount: toursRedCashUsed,
          p_type: 'credit',
          p_description: `Reembolso de reserva cancelada #${booking.booking_code}`,
          p_reference_id: id,
          p_reference_type: 'booking_refund'
        });

        if (cashError) {
          console.error('Error refunding ToursRed Cash:', cashError);
        }
      }

      const { error } = await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          payment_status: 'canceled'
        })
        .eq('id', id);

      if (error) {
        console.error('Error updating booking status:', error);
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