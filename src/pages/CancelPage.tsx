import React from 'react';
import { Link } from 'react-router-dom';
import { XCircle, ArrowLeft, Home, CreditCard } from 'lucide-react';

const CancelPage: React.FC = () => {
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
            Tu pago fue cancelado. No se ha realizado ningún cargo a tu cuenta.
          </p>

          <div className="space-y-4">
            <button
              onClick={() => window.history.back()}
              className="w-full flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Intentar de Nuevo
            </button>
            
            <Link
              to="/"
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Home className="mr-2 h-4 w-4" />
              Volver al Inicio
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelPage;