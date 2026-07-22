import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ReturnStatus = 'loading' | 'success' | 'pending' | 'cancel' | 'error';

export default function PaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReturnStatus>('loading');
  const [message, setMessage] = useState('');

  const provider = searchParams.get('provider');
  const bookingId = searchParams.get('booking_id');
  const giftCardId = searchParams.get('gift_card_id');
  const bookingSupplementId = searchParams.get('booking_supplement_id');
  const paypalOrderId = searchParams.get('token');
  const planId = searchParams.get('plan_id');
  const payFullBalance = searchParams.get('pay_full_balance') === 'true';
  const returnUrlContext = searchParams.get('context');
  // Post-booking extras (insurance / optional_service)
  const extraType = searchParams.get('extra_type'); // 'insurance' | 'optional_service'
  const extraBosId = searchParams.get('bos_id');
  const extraTourOptionalServiceId = searchParams.get('tour_optional_service_id');
  const extraQuantity = searchParams.get('quantity');

  // Our custom status param, but MercadoPago may override 'status' with its own value
  // Use 'tr_status' as our param to avoid conflicts, falling back to 'status' for backwards compat
  const returnStatus = searchParams.get('tr_status') || searchParams.get('status');

  // MercadoPago sends collection_status on return (approved, null, rejected, etc.)
  const mpCollectionStatus = searchParams.get('collection_status');

  useEffect(() => {
    handleReturn();
  }, []);

  const handleReturn = async () => {
    // MercadoPago collection_status takes priority for MP payments
    if (mpCollectionStatus) {
      if (mpCollectionStatus === 'approved') {
        setStatus('success');
        if (giftCardId) {
          setMessage('Pago exitoso. Tu tarjeta de regalo fue procesada.');
          setTimeout(() => navigate(`/gift-card/success?gift_card_id=${giftCardId}&provider=mercadopago`), 2000);
        } else if (bookingSupplementId) {
          setMessage('Pago del suplemento exitoso.');
          const { data: { session } } = await supabase.auth.getSession();
          try {
            await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-supplement-payment`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({
                  booking_supplement_id: bookingSupplementId,
                  payment_method: 'mercadopago',
                }),
              }
            );
          } catch (_) { /* idempotent — ignore if already processed */ }
          setTimeout(() => navigate(`/supplement-success?supplement_id=${bookingSupplementId}`), 2000);
        } else if (extraType && bookingId) {
          // Post-booking extra (insurance or optional service) via MercadoPago
          setMessage('Pago del extra exitoso.');
          const { data: { session } } = await supabase.auth.getSession();
          try {
            await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/purchase-post-booking-extras`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({
                  booking_id: bookingId,
                  type: extraType,
                  payment_method: 'mercadopago',
                }),
              }
            );
          } catch (_) { /* idempotent */ }
          const successUrl = extraType === 'insurance'
            ? `/extras-success?type=insurance&booking_id=${bookingId}`
            : `/extras-success?type=optional_service&bos_id=${extraBosId}&booking_id=${bookingId}`;
          setTimeout(() => navigate(successUrl), 2000);
        } else if (bookingId) {
          setMessage('Pago exitoso. Tu reserva ha sido confirmada.');
          setTimeout(() => navigate(`/booking-success?booking_id=${bookingId}`), 2000);
        }
        return;
      } else if (mpCollectionStatus === 'pending' || mpCollectionStatus === 'in_process') {
        setStatus('pending');
        setMessage('Tu pago esta siendo procesado. Te notificaremos cuando sea confirmado.');
        return;
      } else {
        // null, rejected, cancelled — treat as cancel
        setStatus('cancel');
        setMessage('Cancelaste el proceso de pago. Tu reserva fue guardada pero no ha sido pagada.');
        return;
      }
    }

    if (returnStatus === 'cancel') {
      setStatus('cancel');
      setMessage('Cancelaste el proceso de pago. Tu reserva fue guardada pero no ha sido pagada.');
      return;
    }

    if (returnStatus === 'pending') {
      setStatus('pending');
      setMessage('Tu pago esta siendo procesado. Te notificaremos cuando sea confirmado.');
      return;
    }

    if (provider === 'paypal' && paypalOrderId && returnStatus === 'success') {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (bookingSupplementId) {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-supplement-payment`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                booking_supplement_id: bookingSupplementId,
                payment_method: 'paypal',
                paypal_order_id: paypalOrderId,
              }),
            }
          );
          const result = await response.json();
          if (result.success) {
            setStatus('success');
            setMessage('Pago del suplemento exitoso.');
            setTimeout(() => navigate('/traveler/bookings'), 2000);
          } else {
            setStatus('error');
            setMessage(result.error || 'Hubo un problema al confirmar tu pago. Contacta soporte si el cargo fue aplicado.');
          }
          return;
        }

        if (extraType && bookingId) {
          // Post-booking extra via PayPal
          const extrasBody: Record<string, unknown> = {
            booking_id: bookingId,
            type: extraType,
            payment_method: 'paypal',
            paypal_order_id: paypalOrderId,
          };
          if (extraType === 'optional_service' && extraTourOptionalServiceId) {
            extrasBody.tour_optional_service_id = extraTourOptionalServiceId;
            extrasBody.quantity = Number(extraQuantity) || 1;
          }
          const extrasResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/purchase-post-booking-extras`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify(extrasBody),
            }
          );
          const extrasResult = await extrasResponse.json();
          if (extrasResult.success) {
            setStatus('success');
            setMessage('Pago del extra exitoso.');
            const bosIdResult = extrasResult.booking_optional_service_id || extraBosId;
            const successUrl = extraType === 'insurance'
              ? `/extras-success?type=insurance&booking_id=${bookingId}`
              : `/extras-success?type=optional_service&bos_id=${bosIdResult}&booking_id=${bookingId}`;
            setTimeout(() => navigate(successUrl), 2000);
          } else {
            setStatus('error');
            setMessage(extrasResult.error || 'Hubo un problema al confirmar tu pago. Contacta soporte si el cargo fue aplicado.');
          }
          return;
        }

        if (returnUrlContext === 'payment_plan_installment' && planId) {
          const planAmount = searchParams.get('amount') || '0';
          const planResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-payment-plan-installment`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`,
              },
              body: JSON.stringify({
                plan_id: planId,
                amount: parseFloat(planAmount),
                payment_method: 'paypal',
                paypal_order_id: paypalOrderId,
                pay_full_balance: payFullBalance,
              }),
            }
          );
          const planResult = await planResponse.json();
          if (planResult.success) {
            setStatus('success');
            setMessage(planResult.message || 'Abono a tu plan de pagos completado.');
            setTimeout(() => navigate(`/payment-plan-success?plan_id=${planId}`), 2000);
          } else {
            setStatus('error');
            setMessage(planResult.error || 'Hubo un problema al confirmar tu abono. Contacta soporte si el cargo fue aplicado.');
          }
          return;
        }

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-paypal-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              orderId: paypalOrderId,
              bookingId: bookingId || undefined,
              giftCardId: giftCardId || undefined,
              context: giftCardId ? 'gift_card' : 'booking',
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          setStatus('success');
          if (giftCardId) {
            setMessage('Pago exitoso. Tu tarjeta de regalo fue procesada.');
            setTimeout(() => navigate(`/gift-card/success?gift_card_id=${giftCardId}&provider=paypal`), 2000);
          } else if (bookingId) {
            setMessage('Pago exitoso. Tu reserva ha sido confirmada.');
            setTimeout(() => navigate(`/booking-success?booking_id=${bookingId}`), 2000);
          }
        } else {
          setStatus('error');
          setMessage('Hubo un problema al confirmar tu pago de PayPal. Contacta soporte si el cargo fue aplicado.');
        }
      } catch (err) {
        console.error('Error capturing PayPal order:', err);
        setStatus('error');
        setMessage('Error al procesar el pago. Por favor contacta soporte.');
      }
      return;
    }

    if (provider === 'mercadopago' && returnStatus === 'success') {
      setStatus('success');
      if (giftCardId) {
        setMessage('Pago exitoso. Tu tarjeta de regalo fue procesada.');
        setTimeout(() => navigate(`/gift-card/success?gift_card_id=${giftCardId}&provider=mercadopago`), 2000);
      } else if (bookingSupplementId) {
        setMessage('Pago del suplemento exitoso.');
        setTimeout(() => navigate(`/supplement-success?supplement_id=${bookingSupplementId}`), 2000);
      } else if (extraType && bookingId) {
        setMessage('Pago del extra exitoso.');
        const successUrl = extraType === 'insurance'
          ? `/extras-success?type=insurance&booking_id=${bookingId}`
          : `/extras-success?type=optional_service&bos_id=${extraBosId}&booking_id=${bookingId}`;
        setTimeout(() => navigate(successUrl), 2000);
      } else if (bookingId) {
        setMessage('Pago exitoso. Tu reserva ha sido confirmada.');
        setTimeout(() => navigate(`/booking-success?booking_id=${bookingId}`), 2000);
      }
      return;
    }

    setStatus('error');
    setMessage('Parametros de retorno invalidos.');
  };

  const handleGoToBookings = () => navigate('/traveler/bookings');
  const handleGoHome = () => navigate('/');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {status === 'loading' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Procesando pago</h2>
            <p className="text-gray-500">Por favor espera mientras confirmamos tu pago...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago exitoso</h2>
            <p className="text-gray-500 mb-6">{message}</p>
            <p className="text-sm text-gray-400">Redirigiendo automaticamente...</p>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center">
                <Clock className="w-10 h-10 text-yellow-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago en proceso</h2>
            <p className="text-gray-500 mb-6">{message}</p>
            <button
              onClick={handleGoToBookings}
              className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors"
            >
              Ver mis reservas
            </button>
          </>
        )}

        {status === 'cancel' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                <XCircle className="w-10 h-10 text-gray-500" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago cancelado</h2>
            <p className="text-gray-500 mb-6">{message}</p>
            <div className="space-y-3">
              {bookingId && (
                <button
                  onClick={handleGoToBookings}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors"
                >
                  Ver mis reservas
                </button>
              )}
              <button
                onClick={handleGoHome}
                className="w-full py-3 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Volver al inicio
              </button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Error en el pago</h2>
            <p className="text-gray-500 mb-6">{message}</p>
            <div className="space-y-3">
              {bookingId && (
                <button
                  onClick={handleGoToBookings}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors"
                >
                  Ver mis reservas
                </button>
              )}
              <button
                onClick={handleGoHome}
                className="w-full py-3 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Volver al inicio
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
