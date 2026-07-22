import React, { useState, useEffect, useRef } from 'react';
import { FileText, LogOut, Check, AlertTriangle, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ActiveTerms {
  id: string;
  terms_type: 'traveler' | 'agency';
  version_number: number;
  title: string;
  content: string;
  change_summary: string | null;
  published_at: string;
}

interface Props {
  termsType: 'traveler' | 'agency';
  onAccepted: () => void;
  onSignOut: () => void;
}

const TermsAcceptanceGate: React.FC<Props> = ({ termsType, onAccepted, onSignOut }) => {
  const [terms, setTerms] = useState<ActiveTerms | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc('get_active_terms', { p_type: termsType }).then(({ data }) => {
      if (data && data.length > 0) setTerms(data[0]);
      setLoading(false);
    });
  }, [termsType]);

  const handleAccept = async () => {
    if (!accepted) return;
    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión no válida');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-terms-acceptance`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ terms_type: termsType }),
        }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Error al registrar aceptación');
      onAccepted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!terms) {
    // No hay versión activa, permitir paso (no debe ocurrir en producción)
    onAccepted();
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Actualización de Términos y Condiciones</h1>
              <p className="text-xs text-gray-500">
                {termsType === 'traveler' ? 'Cuenta de Viajero' : 'Cuenta de Agencia'} · Versión {terms.version_number}
              </p>
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center py-8 px-4">
        <div className="w-full max-w-3xl space-y-5">
          {/* Notice banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Hemos actualizado nuestros Términos y Condiciones</p>
              {terms.change_summary && (
                <p className="text-sm text-amber-700 mt-1">{terms.change_summary}</p>
              )}
              <p className="text-xs text-amber-600 mt-2">
                Para continuar usando ToursRed debes leer y aceptar la nueva versión.
              </p>
            </div>
          </div>

          {/* Terms content */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{terms.title}</h2>
              <span className="text-xs text-gray-400">
                Versión {terms.version_number} · {new Date(terms.published_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </div>
            <div
              ref={contentRef}
              className="p-6 max-h-[420px] overflow-y-auto prose prose-sm max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: terms.content }}
            />
            <div className="bg-gray-50 border-t border-gray-100 px-5 py-2 flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <ChevronDown className="w-3.5 h-3.5" />
              Desplázate para leer el contenido completo
            </div>
          </div>

          {/* Checkbox */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                className="mt-0.5 h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
              />
              <span className="text-sm text-gray-700 leading-relaxed">
                He leído y acepto los <strong>Términos y Condiciones</strong> de ToursRed en su versión {terms.version_number}, vigente desde el{' '}
                {new Date(terms.published_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}.
                Entiendo que mi aceptación queda registrada con fecha, hora, dirección IP y datos de mi dispositivo con fines legales y de auditoría.
              </span>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm border border-red-200">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleAccept}
              disabled={!accepted || saving}
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {saving ? 'Registrando aceptación...' : 'Aceptar y continuar'}
            </button>
            <button
              onClick={onSignOut}
              className="w-full sm:w-auto px-6 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              No acepto — Cerrar sesión
            </button>
          </div>

          <p className="text-xs text-center text-gray-400 pb-4">
            Si no aceptas los nuevos términos, no podrás acceder a la plataforma. Para dudas contáctanos en{' '}
            <a href="mailto:contacto@toursred.com" className="underline hover:text-gray-600">contacto@toursred.com</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default TermsAcceptanceGate;
