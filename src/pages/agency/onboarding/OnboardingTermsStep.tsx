import React, { useEffect, useState } from 'react';
import { FileText, CheckCircle, ChevronDown } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Props {
  agencyId: string;
  onAccepted: () => void;
}

const OnboardingTermsStep: React.FC<Props> = ({ agencyId, onAccepted }) => {
  const [scrolled, setScrolled]   = useState(false);
  const [checked, setChecked]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [termsHtml, setTermsHtml] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('terms_versions')
      .select('content')
      .eq('terms_type', 'agency')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => setTermsHtml(data?.content ?? null));
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) setScrolled(true);
  };

  const handleAccept = async () => {
    if (!checked || !scrolled) return;
    setLoading(true);
    setError('');
    try {
      const { error: err } = await supabase
        .from('agencies')
        .update({ terms_accepted_at: new Date().toISOString() })
        .eq('id', agencyId);
      if (err) throw err;
      onAccepted();
    } catch {
      setError('Error al guardar la aceptación. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-primary-500 to-primary-600" />
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Términos y Condiciones</h2>
            <p className="text-sm text-gray-500">Lee el contrato de agencia completo antes de continuar.</p>
          </div>
        </div>

        {/* Terms viewer */}
        <div
          onScroll={handleScroll}
          className="border border-gray-200 rounded-xl h-72 overflow-y-auto p-5 text-sm text-gray-700 leading-relaxed bg-gray-50 mb-4"
        >
          {termsHtml ? (
            <div dangerouslySetInnerHTML={{ __html: termsHtml }} />
          ) : (
            <div className="space-y-3 text-gray-600">
              <p><strong>Contrato de Colaboración — Agencias de Viaje</strong></p>
              <p>Al registrarte como agencia en ToursRed aceptas los siguientes términos: los tours publicados deben ser verídicos, los precios correctos, y los datos de la empresa válidos. ToursRed puede suspender o eliminar agencias que incumplan estas condiciones.</p>
              <p>La plataforma retiene una comisión sobre cada reserva confirmada según las tarifas vigentes. El pago se realiza en los plazos acordados.</p>
              <p>La agencia es responsable de la atención al viajero, el cumplimiento del itinerario y la gestión de cancelaciones según su propia política.</p>
              <p>ToursRed actúa como intermediario tecnológico y no es responsable de incumplimientos por parte de la agencia.</p>
              <p>Al aceptar estos términos, la agencia confirma que los datos proporcionados son verídicos y que cuenta con las licencias y permisos necesarios para operar.</p>
              <p className="mt-6 text-gray-400 text-xs">— Fin del documento. Puedes cerrar y revisarlo nuevamente cuando gustes. —</p>
            </div>
          )}
        </div>

        {!scrolled && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 mb-4">
            <ChevronDown className="w-4 h-4 animate-bounce" />
            Desplázate hasta el final para habilitar la aceptación
          </div>
        )}

        {/* Checkbox */}
        <label className={`flex items-start gap-3 cursor-pointer mb-6 ${!scrolled ? 'opacity-50 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-primary-600"
          />
          <span className="text-sm text-gray-700">
            He leído y acepto los <strong>Términos y Condiciones</strong> de ToursRed, incluyendo el contrato de colaboración de agencias.
          </span>
        </label>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <button
          onClick={handleAccept}
          disabled={!checked || !scrolled || loading}
          className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          Aceptar y continuar
        </button>
      </div>
    </div>
  );
};

export default OnboardingTermsStep;
