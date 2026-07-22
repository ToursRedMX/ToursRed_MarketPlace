import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Gift, Check, Mail, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function GiftCardSuccessPage() {
  const [searchParams] = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const isFree = searchParams.get('free');
    const giftCardId = searchParams.get('gift_card_id');

    const provider = searchParams.get('provider');

    if (isFree === 'true' && giftCardId) {
      supabase.functions.invoke('send-gift-card-email', {
        body: { giftCardId }
      }).then(() => {
        setIsProcessing(false);
      }).catch((error) => {
        console.error('Error sending gift card email:', error);
        setIsProcessing(false);
      });
    } else if (giftCardId && (provider === 'mercadopago' || provider === 'paypal')) {
      setIsProcessing(false);
    } else if (sessionId) {
      setTimeout(() => {
        setIsProcessing(false);
      }, 2000);
    } else {
      setIsProcessing(false);
    }
  }, [searchParams]);

  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-xl text-gray-700">Procesando tu compra...</p>
        </div>
      </div>
    );
  }

  const isFree = searchParams.get('free') === 'true';

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
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 mb-8">
              <div className="flex items-center space-x-4 mb-4">
                <div className="flex-shrink-0">
                  <Gift className="w-12 h-12 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Tu Tarjeta de Regalo ToursRed
                  </h2>
                  <p className="text-gray-600">
                    Revisa tu correo electrónico
                  </p>
                </div>
              </div>
            </div>

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
                    Hemos enviado la tarjeta de regalo al email que indicaste. Si elegiste enviarla como regalo, el destinatario también recibirá una copia.
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
                    Te recomendamos guardar el email o hacer una captura de pantalla del código para tener una referencia.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Gift className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    Válida por 1 Año
                  </h3>
                  <p className="text-gray-600 text-sm">
                    La tarjeta de regalo puede ser canjeada en cualquier momento durante el próximo año.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
              <h3 className="font-semibold text-blue-900 mb-3">
                ¿Cómo se canjea la tarjeta?
              </h3>
              <ol className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">1.</span>
                  <span>El destinatario debe crear una cuenta en ToursRed (si no tiene una)</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">2.</span>
                  <span>Ingresar el código de la tarjeta en la sección "Canjear Tarjeta de Regalo"</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 flex-shrink-0">3.</span>
                  <span>El monto se agregará automáticamente a su ToursRed Cash</span>
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
            ¿Necesitas ayuda o no recibiste el email?
          </p>
          <Link
            to="/contact"
            className="text-green-600 hover:text-green-700 font-semibold"
          >
            Contáctanos
          </Link>
        </div>
      </div>
    </div>
  );
}
