import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

const SentryFallback: React.FC<{ resetError: () => void }> = ({ resetError }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">
          Algo salió mal
        </h1>
        <p className="text-slate-500 mb-8">
          Ocurrió un error inesperado. Nuestro equipo ya fue notificado automáticamente.
          Puedes intentar recargar la página o volver al inicio.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={resetError}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Home className="w-4 h-4" />
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
};

export default SentryFallback;
