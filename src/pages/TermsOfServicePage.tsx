import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Scale } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Seo from '../components/Seo';

interface ActiveTerms {
  id: string;
  version_number: number;
  title: string;
  content: string;
  published_at: string;
}

export default function TermsOfServicePage() {
  const [terms, setTerms] = useState<ActiveTerms | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: 'traveler' }).then(({ data }) => {
      if (data && data.length > 0) setTerms(data[0]);
      setLoading(false);
    });
  }, []);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50">
      <Seo
        title="Términos y Condiciones de Servicio | ToursRed"
        description="Términos y condiciones de servicio de ToursRed. Reglas y políticas para el uso de nuestra plataforma de tours y excursiones."
        type="website"
      />
      <div className="bg-gradient-to-r from-green-600 to-green-800 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="h-12 w-12" />
            <h1 className="text-4xl font-bold">Términos y Condiciones de Servicio</h1>
          </div>
          {loading ? (
            <p className="text-xl text-green-100">Cargando...</p>
          ) : terms ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-green-100">
              <span className="text-lg font-medium">{terms.title}</span>
              <span className="hidden sm:inline text-green-300">·</span>
              <span>Versión {terms.version_number} · Vigente desde {formatDate(terms.published_at)}</span>
            </div>
          ) : (
            <p className="text-xl text-green-100">Última actualización: 23 de diciembre de 2024</p>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : terms ? (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-8 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Scale className="h-4 w-4 text-green-600" />
                <span>Documento oficial de ToursRed</span>
              </div>
              <span className="text-xs text-gray-400 bg-gray-200 px-2 py-1 rounded-full">
                v{terms.version_number} · {formatDate(terms.published_at)}
              </span>
            </div>
            <div
              className="p-8 prose prose-sm sm:prose max-w-none text-gray-700"
              dangerouslySetInnerHTML={{ __html: terms.content }}
            />
            <div className="border-t px-8 py-6">
              <p className="text-sm text-gray-500 text-center">
                Al utilizar ToursRed, usted reconoce que ha leído, entendido y aceptado estos Términos y Condiciones de Servicio (Versión {terms.version_number}).
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-8">
            <p className="text-gray-500 text-center">No hay términos y condiciones publicados actualmente.</p>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link to="/" className="text-green-600 hover:text-green-700 font-medium">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
