import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MP_STATUS_MESSAGES: Record<string, string> = {
  cc_rejected_bad_filled_card_number: 'Revisa el número de tarjeta.',
  cc_rejected_bad_filled_date: 'Revisa la fecha de vencimiento.',
  cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta.',
  cc_rejected_bad_filled_security_code: 'Revisa el código de seguridad (CVV).',
  cc_rejected_blacklist: 'La tarjeta no puede ser procesada.',
  cc_rejected_call_for_authorize: 'Debes autorizar el pago con tu banco antes de continuar.',
  cc_rejected_card_disabled: 'La tarjeta está deshabilitada. Contacta a tu banco.',
  cc_rejected_card_error: 'No se pudo procesar la tarjeta. Intenta con otra.',
  cc_rejected_duplicated_payment: 'Ya realizaste un pago con este monto. Espera unos minutos antes de reintentar.',
  cc_rejected_high_risk: 'El pago fue rechazado por seguridad. Intenta con otra tarjeta.',
  cc_rejected_insufficient_amount: 'Fondos insuficientes en la tarjeta.',
  cc_rejected_invalid_installments: 'Las cuotas seleccionadas no están disponibles para esta tarjeta.',
  cc_rejected_max_attempts: 'Has alcanzado el límite de intentos. Intenta con otra tarjeta.',
  cc_rejected_other_reason: 'La tarjeta fue rechazada. Intenta con otra tarjeta o contacta a tu banco.',
  pending_contingency: 'El pago está siendo procesado. Te notificaremos el resultado.',
  pending_review_manual: 'El pago está en revisión. Te notificaremos el resultado.',
  rejected_by_bank: 'El banco rechazó el pago. Contacta a tu banco.',
  rejected_insufficient_data: 'Datos de pago incompletos. Verifica la información.',
};

interface MercadoPagoBrickProps {
  preferenceId: string;
  publicKey: string;
  amount: number;
  bookingId?: string;
  supplementId?: string;
  onSuccess: () => void;
  onError: (error: string) => void;
  onPending?: () => void;
}

declare global {
  interface Window {
    MercadoPago: any;
  }
}

export default function MercadoPagoBrick({
  preferenceId,
  publicKey,
  amount,
  bookingId,
  supplementId,
  onSuccess,
  onError,
  onPending,
}: MercadoPagoBrickProps) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [brickReady, setBrickReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const brickControllerRef = useRef<any>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (brickControllerRef.current) {
        try {
          brickControllerRef.current.unmount();
        } catch (_) {}
        brickControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (window.MercadoPago) {
      setSdkLoaded(true);
      return;
    }

    const existing = document.querySelector('script[src="https://sdk.mercadopago.com/js/v2"]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (mountedRef.current) setSdkLoaded(true);
      });
      if (window.MercadoPago) setSdkLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.onload = () => {
      if (mountedRef.current) setSdkLoaded(true);
    };
    script.onerror = () => {
      if (mountedRef.current) setLoadError('No se pudo cargar el SDK de MercadoPago.');
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!sdkLoaded || !preferenceId || !publicKey || !amount || initializedRef.current) return;

    const initBrick = async () => {
      initializedRef.current = true;
      setLoadError(null);
      setBrickReady(false);

      try {
        if (brickControllerRef.current) {
          try { brickControllerRef.current.unmount(); } catch (_) {}
          brickControllerRef.current = null;
        }

        const mp = new window.MercadoPago(publicKey, { locale: 'es-MX' });
        const bricksBuilder = mp.bricks();

        const controller = await bricksBuilder.create('payment', 'mp-payment-brick-container', {
          initialization: {
            amount,
            preferenceId,
          },
          customization: {
            paymentMethods: {
              creditCard: 'all',
              debitCard: 'all',
              mercadoPago: 'all',
            },
            visual: {
              style: {
                theme: 'default',
              },
            },
            hidePaymentButton: false,
          },
          callbacks: {
            onReady: () => {
              if (mountedRef.current) setBrickReady(true);
            },
            onSubmit: async ({ formData }: any) => {
              // null formData means MP is handling payment via internal redirect (wallet/credit)
              // The back_urls flow in PaymentReturnPage will handle completion
              if (!formData) return;
              try {
                const { data: { session } } = await supabase.auth.getSession();

                let result: any;
                if (supplementId) {
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
                        booking_supplement_id: supplementId,
                        payment_method: 'mercadopago',
                        mp_form_data: formData,
                      }),
                    }
                  );
                  result = await response.json();
                  if (!response.ok || result.error) throw new Error(result.error || 'Error al procesar el pago');
                  onSuccess();
                  return;
                }

                const response = await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-mercadopago-brick-payment`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({ formData, preferenceId, bookingId }),
                  }
                );

                result = await response.json();

                if (!response.ok || result.error) {
                  throw new Error(result.error || 'Error al procesar el pago');
                }

                if (result.status === 'approved') {
                  onSuccess();
                } else if (result.status === 'in_process' || result.status === 'pending') {
                  if (onPending) onPending();
                  else onSuccess();
                } else {
                  const detail = result.status_detail || '';
                  const friendly = MP_STATUS_MESSAGES[detail] || 'El pago no fue aprobado. Intenta con otra tarjeta.';
                  if (mountedRef.current) setPaymentError(friendly);
                }
              } catch (err: any) {
                if (mountedRef.current) setPaymentError(err.message || 'Error al procesar el pago. Intenta de nuevo.');
              }
            },
            onError: (error: any) => {
              console.error('Brick error:', error);
              if (mountedRef.current && error?.type !== 'NON_FATAL') {
                setLoadError(error?.message || 'Error en el formulario de pago');
              }
            },
          },
        });

        brickControllerRef.current = controller;
      } catch (err: any) {
        console.error('Error initializing brick:', err);
        initializedRef.current = false;
        if (mountedRef.current) {
          setLoadError('No se pudo cargar el formulario de pago. Esto puede ser un problema temporal de MercadoPago.');
        }
      }
    };

    initBrick();
  }, [sdkLoaded, preferenceId, publicKey, amount, retryCount]);

  const handleRetry = () => {
    initializedRef.current = false;
    setLoadError(null);
    setRetryCount(c => c + 1);
  };

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
        <div className="flex items-start gap-3 w-full">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
        <button
          onClick={handleRetry}
          className="self-end px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {!brickReady && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          <span className="text-sm">Cargando formulario de pago...</span>
        </div>
      )}
      {paymentError && (
        <div className="flex items-start gap-3 p-4 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
          <div className="flex-1">
            <p className="font-medium">Pago rechazado</p>
            <p className="mt-0.5">{paymentError}</p>
          </div>
          <button onClick={() => setPaymentError(null)} className="text-red-400 hover:text-red-600">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}
      <div id="mp-payment-brick-container" />
    </div>
  );
}
