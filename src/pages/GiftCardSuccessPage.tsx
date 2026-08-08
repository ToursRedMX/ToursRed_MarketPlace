import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Gift, Check, Mail, Download, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrencyMXN } from '../utils/formatCurrency';

interface GiftCardData {
  id: string;
  code: string;
  amount: number;
  currency: string;
  status: string;
  payment_status: string;
  email_sent: boolean;
  purchaser_email: string;
  recipient_email: string | null;
  expires_at: string;
  purchased_at: string;
}

export default function GiftCardSuccessPage() {
  const [searchParams] = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(true);
  const [giftCard, setGiftCard] = useState<GiftCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailResent, setEmailResent] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const giftCardId = searchParams.get('gift_card_id');
  const isFree = searchParams.get('free') === 'true';
  const provider = searchParams.get('provider');
  const sessionId = searchParams.get('session_id');

  const fetchGiftCard = useCallback(async (): Promise<boolean> => {
    if (!giftCardId) return false;

    const { data, error: fetchError } = await supabase
      .from('gift_cards')
      .select('id, code, amount, currency, status, payment_status, email_sent, purchaser_email, recipient_email, expires_at, purchased_at')
      .eq('id', giftCardId)
      .maybeSingle();

    if (fetchError || !data) return false;

    setGiftCard(data);
    return data.payment_status === 'paid';
  }, [giftCardId]);

  const sendEmailBackup = useCallback(async () => {
    if (!giftCardId) return;

    try {
      await supabase.functions.invoke('send-gift-card-email', {
        body: { giftCardId },
      });
      setEmailResent(true);
    } catch (err) {
      console.error('Error sending gift card email backup:', err);
    }
  }, [giftCardId]);

  useEffect(() => {
    const checkStatus = async () => {
      if (isFree && giftCardId) {
        try {
          await supabase.functions.invoke('send-gift-card-email', {
            body: { giftCardId },
          });
        } catch (err) {
          console.error('Error sending gift card email:', err);
        }
        await fetchGiftCard();
        setIsProcessing(false);
        return;
      }

      if (giftCardId && (provider === 'mercadopago' || provider === 'paypal')) {
        const isPaid = await fetchGiftCard();
        if (isPaid && !giftCard?.email_sent) {
          await sendEmailBackup();
        }
        setIsProcessing(false);
        return;
      }

      if (sessionId) {
        for (let i = 0; i < 10; i++) {
          if (giftCardId) {
            const isPaid = await fetchGiftCard();
            if (isPaid) {
              if (!giftCard?.email_sent) {
                await sendEmailBackup();
              }
              setIsProcessing(false);
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        setIsProcessing(false);
        return;
      }

      if (giftCardId) {
        await fetchGiftCard();
      }
      setIsProcessing(false);
    };

    checkStatus();
  }, [isFree, giftCardId, provider, sessionId, fetchGiftCard, sendEmailBackup]);

  const handleResendEmail = async () => {
    if (!giftCardId) return;
    setIsResending(true);
    try {
      await supabase.functions.invoke('send-gift-card-email', {
        body: { giftCardId },
      });
      setEmailResent(true);
    } catch (err) {
      console.error('Error resending email:', err);
      setError('No se pudo reenviar el correo. Intenta nuevamente.');
    } finally {
      setIsResending(false);
    }
  };

  const isPaymentConfirmed = giftCard?.payment_status === 'paid' || isFree;

  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-xl text-gray-700">Procesando tu compra...</p>
          <p className="text-sm text-gray-500 mt-2">Estamos confirmando tu pago. Esto puede tomar unos momentos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-16 text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-white rounded-full mb-6">
              <Check className="w-14 h-14 text-green-600" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-3">
              {isFree ? '¡Tarjeta Obtenida!' : '¡Compra Exitosa!'}
            </h1>
            <p className="text-green-100 text-lg">
              {isFree
                ? 'Tu tarjeta de regalo ha sido creada y enviada (100% descuento aplicado)'
                : 'Tu tarjeta de regalo ha sido creada y enviada'
              }
            </p>
          </div>

          <div className="p-8 md:p-12">
            {/* Show gift card code if payment is confirmed */}
            {isPaymentConfirmed && giftCard ? (
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 mb-8 border-2 border-amber-200">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="flex-shrink-0">
                    <Gift className="w-12 h-12 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900">
                      Tu Tarjeta de Regalo ToursRed
                    </h2>
                    <p className="text-gray-600 text-sm">
                      Guarda este codigo, tambien lo enviamos a tu correo
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 my-4 border border-amber-200">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 text-center">Codigo de Tarjeta</p>
                  <p className="text-3xl font-mono font-bold text-amber-700 text-center tracking-widest select-all">
                    {giftCard.code}
                  </p>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-amber-200">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Monto</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatCurrencyMXN(giftCard.amount)} {giftCard.currency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Valida hasta</p>
                    <p className="text-sm font-semibold text-gray-700">
                      {new Date(giftCard.expires_at).toLocaleDateString('es-MX', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-8">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      Pago en proceso
                    </h2>
                    <p className="text-gray-600 text-sm">
                      Tu pago esta siendo confirmado. Recibiras el codigo de tu tarjeta por correo
                      electronico una vez que se confirme. Esto puede tardar unos minutos.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Email status and resend */}
            {isPaymentConfirmed && giftCard && (
              <div className="mb-6">
                {emailResent ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center space-x-3">
                    <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      El correo ha sido reenviado exitosamente a {giftCard.recipient_email || giftCard.purchaser_email}
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleResendEmail}
                    disabled={isResending}
                    className="w-full bg-white text-amber-600 py-3 rounded-lg font-semibold border-2 border-amber-200 hover:bg-amber-50 transition-all text-center disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isResending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="w-5 h-5" />
                        <span>Reenviar correo con el codigo</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-6 mb-8">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Mail className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    Email Enviado
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Hemos enviado la tarjeta de regalo al email que indicaste. Si elegiste enviarla como regalo, el destinatario tambien recibira una copia.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Download className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    Guarda una Copia
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Te recomendamos guardar el codigo o hacer una captura de pantalla para tener una referencia.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Gift className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    Valida por 1 Ano
                  </h3>
                  <p className="text-gray-600 text-sm">
                    La tarjeta de regalo puede ser canjeada en cualquier momento durante el proximo ano.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
              <h3 className="font-semibold text-blue-900 mb-3">
                Como se canjea la tarjeta?
              </h3>
              <ol className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">1.</span>
                  <span>El destinatario debe crear una cuenta en ToursRed (si no tiene una)</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">2.</span>
                  <span>Ingresar el codigo de la tarjeta en la seccion "Canjear Tarjeta de Regalo"</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">3.</span>
                  <span>El monto se agregara automaticamente a su ToursRed Cash</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">4.</span>
                  <span>Puede usar el saldo para pagar cualquier tour en la plataforma</span>
                </li>
              </ol>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/tours"
                className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white py-4 rounded-xl font-bold text-center hover:from-amber-600 hover:to-orange-700 transition-all shadow-lg hover:shadow-xl"
              >
                Explorar Tours
              </Link>
              <Link
                to="/gift-cards"
                className="flex-1 bg-white text-amber-600 py-4 rounded-xl font-bold border-2 border-amber-200 hover:bg-amber-50 transition-all text-center"
              >
                Comprar Otra Tarjeta
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600 mb-2">
            Necesitas ayuda o no recibiste el email?
          </p>
          <Link
            to="/contact"
            className="text-green-600 hover:text-green-700 font-semibold"
          >
            Contactanos
          </Link>
        </div>
      </div>
    </div>
  );
}
