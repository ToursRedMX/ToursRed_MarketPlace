import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Mail, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

const UnsubscribePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No se proporciono un token de baja valido.');
      return;
    }

    const unsubscribe = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(`${supabaseUrl}/functions/v1/unsubscribe-newsletter?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = await response.json();

        if (!response.ok) {
          setStatus('error');
          setErrorMessage(data.error || 'Error al procesar la baja.');
          return;
        }

        if (data.already_unsubscribed) {
          setStatus('already');
        } else {
          setStatus('success');
        }
      } catch {
        setStatus('error');
        setErrorMessage('Error de conexion. Intenta nuevamente mas tarde.');
      }
    };

    unsubscribe();
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-[#b8dfe6] px-6 py-8 text-center">
            <img
              src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png"
              alt="ToursRed"
              className="max-w-[160px] mx-auto mb-2"
            />
          </div>

          {/* Content */}
          <div className="px-6 py-8 text-center">
            {status === 'loading' && (
              <>
                <Loader2 className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-spin" />
                <h1 className="text-xl font-bold text-gray-900 mb-2">Procesando tu baja...</h1>
                <p className="text-sm text-gray-500">Un momento por favor.</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Baja confirmada</h1>
                <p className="text-sm text-gray-600 mb-6">
                  Te has dado de baja correctamente del boletin de ToursRed. Ya no recibiras mas correos de nuestra parte.
                </p>
                <p className="text-xs text-gray-400 mb-6">
                  Si te suscribes nuevamente en el futuro, estaremos felices de tenerte de vuelta.
                </p>
                <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  Ir al inicio <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}

            {status === 'already' && (
              <>
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="h-8 w-8 text-gray-400" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Ya estabas dado de baja</h1>
                <p className="text-sm text-gray-600 mb-6">
                  Este correo ya no estaba suscrito al boletin de ToursRed. No recibiras mas correos.
                </p>
                <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  Ir al inicio <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-2">No se pudo procesar la baja</h1>
                <p className="text-sm text-gray-600 mb-6">{errorMessage}</p>
                <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  Ir al inicio <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </div>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">(c) {new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnsubscribePage;
