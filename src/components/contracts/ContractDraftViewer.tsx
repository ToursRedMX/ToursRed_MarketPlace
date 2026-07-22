import React, { useEffect, useState, useRef } from 'react';
import { FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import contractTemplate from './contrato_agencia_template.html?raw';

interface Props {
  agencyId: string;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const ContractDraftViewer: React.FC<Props> = ({ agencyId }) => {
  const [html, setHtml]       = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data: agency, error: agencyErr } = await supabase
          .from('agencies')
          .select('id, name, razon_social, rfc, representante_legal_nombre, contact_email, commission_percentage, street, exterior_number, interior_number, colony, city, state, postal_code, country')
          .eq('id', agencyId)
          .maybeSingle();

        if (agencyErr || !agency) { setError('No se pudieron obtener los datos de la agencia'); return; }

        const { data: acceptance } = await supabase
          .from('contract_acceptances')
          .select('folio_contrato, contract_version')
          .eq('agency_id', agencyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const now = new Date();
        const folio = acceptance?.folio_contrato ?? '—';
        const version = acceptance?.contract_version ?? '1.0';

        const replacements: Record<string, string> = {
          razon_social:           agency.razon_social ?? agency.name ?? '—',
          rfc_agencia:            agency.rfc ?? '—',
          representante_legal:    agency.representante_legal_nombre ?? '—',
          email_contacto:         agency.contact_email ?? '—',
          domicilio_fiscal:       [agency.street, agency.exterior_number && `#${agency.exterior_number}`, agency.interior_number && `Int. ${agency.interior_number}`].filter(Boolean).join(' ') +
                                 (agency.colony ? `, ${agency.colony}` : '') +
                                 (agency.city ? `, ${agency.city}` : '') +
                                 (agency.state ? `, ${agency.state}` : '') +
                                 (agency.postal_code ? ` ${agency.postal_code}` : '') +
                                 (agency.country ? `, ${agency.country}` : '') || '—',
          fecha_dia:              String(now.getDate()).padStart(2, '0'),
          fecha_mes:              MESES[now.getMonth()],
          fecha_anio:             String(now.getFullYear()),
          folio_contrato:         folio,
          version_contrato:       version,
          fecha_hora_aceptacion:  'Pendiente de firma',
          ip_aceptacion:          'Pendiente de firma',
          user_agent_aceptacion:  'Pendiente de firma',
          otp_estatus:            'Pendiente de firma',
          hash_documento:        'Pendiente de firma',
        };

        let template = contractTemplate;

        for (const [key, value] of Object.entries(replacements)) {
          template = template.replaceAll(`{{${key}}}`, value);
        }

        if (!cancelled) setHtml(template);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Error al cargar el contrato');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [agencyId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        Cargando contrato…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 text-amber-700 rounded-xl p-4 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-100">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700">Borrador del contrato de colaboración</span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title="Borrador del contrato"
          className="w-full border-0"
          style={{ minHeight: '600px', background: '#f4f4f2' }}
          onLoad={() => {
            try {
              const iframe = iframeRef.current;
              if (iframe?.contentWindow) {
                const height = iframe.contentWindow.document.body.scrollHeight;
                iframe.style.height = `${Math.max(height + 40, 600)}px`;
              }
            } catch {
              // cross-origin fallback: keep min height
            }
          }}
        />
      </div>
    </div>
  );
};

export default ContractDraftViewer;
