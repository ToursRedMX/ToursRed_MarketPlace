import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Estado = 'cargando' | 'listo' | 'invalido' | 'error';

/** Enlace del correo de "Avisame": cancela el aviso sin pedir sesion. */
const AvisoBajaPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const tokenValido = /^[0-9a-f-]{36}$/i.test(token);
  // El resultado queda atado al token al que responde: sin token valido no hay
  // llamada y `estado` se deriva (no se escribe estado dentro del efecto).
  const [resultado, setResultado] = useState<{ token: string; estado: Exclude<Estado, 'cargando'> } | null>(null);

  useEffect(() => {
    if (!tokenValido) return;
    let cancelado = false;
    supabase.rpc('unsubscribe_destination_alert', { p_token: token }).then(({ data, error }) => {
      if (cancelado) return;
      if (error) {
        console.warn('AvisoBajaPage: no se pudo cancelar el aviso', error);
        setResultado({ token, estado: 'error' });
      } else {
        setResultado({ token, estado: data ? 'listo' : 'invalido' });
      }
    });
    return () => { cancelado = true; };
  }, [token, tokenValido]);

  const estado: Estado = !tokenValido
    ? 'invalido'
    : resultado && resultado.token === token
      ? resultado.estado
      : 'cargando';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-100 px-6 py-8 text-center">
        {estado === 'cargando' && (
          <>
            <Loader2 className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-spin" />
            <h1 className="text-xl font-bold text-gray-900">Cancelando tu aviso…</h1>
          </>
        )}
        {estado === 'listo' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">Aviso cancelado</h1>
            <p className="text-sm text-gray-600 mb-6">Ya no te escribiremos sobre ese destino.</p>
          </>
        )}
        {(estado === 'invalido' || estado === 'error') && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {estado === 'error' ? 'No pudimos cancelar el aviso' : 'Enlace no válido'}
            </h1>
            <p className="text-sm text-gray-600 mb-6">
              {estado === 'error'
                ? 'Hubo un problema de conexión. Vuelve a abrir el enlace del correo en un momento.'
                : 'El enlace no corresponde a ningún aviso activo.'}
            </p>
          </>
        )}
        <Link to="/tours" className="btn btn-primary">Ver tours</Link>
      </div>
    </div>
  );
};

export default AvisoBajaPage;
