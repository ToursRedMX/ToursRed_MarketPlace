import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[calc(100vh-16rem)] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <MapPin className="w-16 h-16 text-primary-600" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Página No Encontrada</h1>
        <p className="text-lg text-gray-600 mb-8">
          ¡Ups! Parece que te has desviado del camino.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-600 hover:bg-primary-700"
        >
          Volver al Inicio
        </Link>
      </div>
    </div>
  );
};

export default NotFoundPage;