import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { hasConsent, setConsent, recordConsent, clearNonEssentialCookies } from '../lib/cookieManager';
import { useAuth } from '../context/AuthContext';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!hasConsent()) {
      setVisible(true);
    }
  }, []);

  const handleAcceptAll = async () => {
    setConsent('all');
    setVisible(false);
    await recordConsent('all', user?.id || null);
  };

  const handleEssentialOnly = async () => {
    setConsent('essential-only');
    await recordConsent('essential-only', user?.id || null);
    clearNonEssentialCookies();
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-blue-600 shadow-2xl z-50 animate-slide-up">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1 pr-4">
            <p className="text-gray-800 text-sm leading-relaxed">
              Utilizamos cookies esenciales para el funcionamiento del sitio y cookies analíticas para mejorar tu experiencia.
              Al hacer clic en "Aceptar todas", aceptas el uso de todas las cookies.
              Puedes elegir "Solo esenciales" para usar únicamente las cookies necesarias.{' '}
              <Link to="/politica-cookies" className="text-blue-600 hover:text-blue-700 underline font-medium">
                Más información
              </Link>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button
              onClick={handleEssentialOnly}
              className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
            >
              Solo esenciales
            </button>
            <button
              onClick={handleAcceptAll}
              className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors duration-200 shadow-md"
            >
              Aceptar todas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
