import React, { useEffect, useState } from 'react';
import { XCircle, Mail, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface AgencyData {
  rejection_category: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  fraude:                 'Indicios de fraude',
  documentos_invalidos:   'Documentos inválidos o ilegibles',
  negocio_no_elegible:    'Negocio no elegible para la plataforma',
  otro:                   'Otro motivo',
};

interface Props {
  agencyId: string;
  supportCategoryId: string | null;
}

const OnboardingRejectedStep: React.FC<Props> = ({ agencyId, supportCategoryId }) => {
  const [agency, setAgency] = useState<AgencyData | null>(null);

  useEffect(() => {
    supabase
      .from('agencies')
      .select('rejection_category, rejection_reason, rejected_at')
      .eq('id', agencyId)
      .maybeSingle()
      .then(({ data }) => setAgency(data));
  }, [agencyId]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-red-400 to-red-500" />
      <div className="p-8">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Solicitud rechazada</h2>
        <p className="text-gray-500 text-center text-sm mb-8">
          Tu solicitud de registro como agencia fue revisada y no pudo ser aprobada en esta ocasión.
        </p>

        {agency && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 space-y-2">
            {agency.rejection_category && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Motivo</p>
                  <p className="text-sm text-red-900">{CATEGORY_LABELS[agency.rejection_category] ?? agency.rejection_category}</p>
                </div>
              </div>
            )}
            {agency.rejection_reason && (
              <div className="pl-6">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Detalle</p>
                <p className="text-sm text-red-800">{agency.rejection_reason}</p>
              </div>
            )}
          </div>
        )}

        <div className="bg-amber-50 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800 leading-relaxed">
            <strong>¿Crees que fue un error?</strong> Puedes presentar una apelación a través de nuestro centro de soporte. Adjunta cualquier evidencia o aclaración pertinente.
          </p>
        </div>

        <div className="space-y-3">
          {supportCategoryId && (
            <a
              href={`/soporte?categoria=${supportCategoryId}&tipo=apelacion`}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Apelar esta decisión
            </a>
          )}
          <a
            href="mailto:contacto@toursred.com"
            className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Contactar por correo
          </a>
        </div>
      </div>
    </div>
  );
};

export default OnboardingRejectedStep;
