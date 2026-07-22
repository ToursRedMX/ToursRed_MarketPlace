import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ligature as FileSignature, Send, CheckCircle, RefreshCw, AlertCircle, FileText, ExternalLink, Percent } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Stage = 'loading' | 'no_amendment' | 'intro' | 'otp_sent' | 'signed';

const AgencyAmendmentSignaturePage: React.FC = () => {
  const navigate   = useNavigate();
  const [stage, setStage]     = useState<Stage>('loading');
  const [otp, setOtp]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const [pdfUrl, setPdfUrl]         = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [proposedPct, setProposedPct] = useState<number | null>(null);
  const [agencyName, setAgencyName] = useState('');
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [folio, setFolio]         = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: agencyRow } = await supabase
        .from('agencies')
        .select('id, name, pending_amendment_id, onboarding_status')
        .maybeSingle();

      if (!agencyRow?.pending_amendment_id) {
        if (!cancelled) setStage('no_amendment');
        return;
      }
      if (!cancelled) setAgencyName(agencyRow.name ?? '');

      // Load proposed commission from the pending acceptance
      const { data: acceptance } = await supabase
        .from('contract_acceptances')
        .select('commission_percentage_proposed')
        .eq('agency_id', agencyRow.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (!cancelled && acceptance?.commission_percentage_proposed != null) {
        setProposedPct(acceptance.commission_percentage_proposed);
      }

      // Load amendment PDF
      setPdfLoading(true);
      const { data: docRow } = await supabase
        .from('agency_documents')
        .select('storage_path')
        .eq('agency_id', agencyRow.id)
        .eq('document_type_key', 'contrato_agencia')
        .eq('is_current', true)
        .eq('status', 'pending_review')
        .maybeSingle();

      if (!cancelled && docRow?.storage_path) {
        const { data: signedData } = await supabase.storage
          .from('agency-documents')
          .createSignedUrl(docRow.storage_path, 1800);
        if (!cancelled && signedData?.signedUrl) {
          setPdfUrl(signedData.signedUrl);
        }
      }
      if (!cancelled) {
        setPdfLoading(false);
        setStage('intro');
      }
    };

    load().catch(() => { if (!cancelled) setStage('no_amendment'); });
    return () => { cancelled = true; };
  }, []);

  const requestOtp = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-contract-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 429 && result.retry_after) {
          setRetryAfter(result.retry_after);
        }
        setError(result.error ?? 'Error al enviar el código.');
        return;
      }
      setStage('otp_sent');
      setRetryAfter(null);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!/^\d{6}$/.test(otp)) { setError('Ingresa el código de 6 dígitos.'); return; }
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-contract-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ otp }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error ?? 'Código incorrecto.'); return; }
      setStage('signed');
      setFolio(result?.folio ?? null);
      setSignedUrl(result?.signed_url ?? null);
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (stage === 'no_amendment') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Sin enmiendas pendientes</h2>
          <p className="text-gray-500 text-sm mb-6">No tienes ninguna enmienda contractual pendiente de firma.</p>
          <button onClick={() => navigate('/agency/dashboard')} className="btn btn-primary">
            Ir al dashboard
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'signed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Enmienda firmada exitosamente</h2>
          <p className="text-gray-500 text-sm mb-2">
            La nueva comisión{proposedPct != null ? ` de ${proposedPct}%` : ''} entra en vigor a partir de ahora.
          </p>
          {folio && (
            <p className="text-gray-400 text-xs mb-2">Folio: <span className="font-mono font-semibold text-gray-600">{folio}</span></p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs mx-auto mb-6">
            <button
              onClick={() => {
                if (signedUrl) {
                  const a = document.createElement('a');
                  a.href = signedUrl;
                  a.download = `enmienda-${folio ?? 'firmada'}.pdf`;
                  a.target = '_blank';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }
              }}
              disabled={!signedUrl}
              className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                signedUrl ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <FileText className="w-4 h-4" />
              Descargar PDF
            </button>
            <button onClick={() => navigate('/agency/dashboard')} className="btn btn-primary">
              Ir al dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-2xl w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
          <div className="flex items-center gap-3 mb-2">
            <FileSignature className="h-7 w-7" />
            <h1 className="text-xl font-semibold">Enmienda de Comisión — Firma requerida</h1>
          </div>
          <p className="text-blue-100 text-sm">
            ToursRed ha actualizado las condiciones de comisión para tu agencia. Revisa el documento y firma para que entre en vigor.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Info de la enmienda */}
          {proposedPct != null && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
              <Percent className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-900">Nueva comisión acordada</p>
                <p className="text-2xl font-bold text-blue-700">{proposedPct}%</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Agencia: <span className="font-medium">{agencyName}</span>
                </p>
              </div>
            </div>
          )}

          {/* PDF viewer link */}
          {pdfLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-400" />
              Cargando documento...
            </div>
          ) : pdfUrl ? (
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-gray-700">
                  <FileText className="h-5 w-5" />
                  <span className="font-medium text-sm">Enmienda contractual</span>
                </div>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  <ExternalLink className="h-3.5 w-3.5" />Abrir en nueva pestaña
                </a>
              </div>
              <iframe src={pdfUrl} className="w-full h-64 rounded-lg border border-gray-100" title="Enmienda" />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              No se pudo cargar la vista previa. Puedes continuar con la firma.
            </div>
          )}

          {/* OTP flow */}
          {stage === 'intro' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Para confirmar la firma de esta enmienda, te enviaremos un código de verificación de 6 dígitos
                a tu correo registrado.
              </p>
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
                </div>
              )}
              {retryAfter && (
                <p className="text-xs text-amber-600">
                  Has alcanzado el límite de solicitudes. Espera {retryAfter} minutos antes de intentar nuevamente.
                </p>
              )}
              <button
                onClick={requestOtp}
                disabled={loading}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />Enviando código...</>
                  : <><Send className="h-4 w-4" />Enviar código de verificación</>}
              </button>
            </div>
          )}

          {stage === 'otp_sent' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                Código enviado a tu correo. Revisa también el spam.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código de verificación</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }}
                  placeholder="000000"
                  className="input text-center text-xl tracking-widest font-mono"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={requestOtp}
                  disabled={loading}
                  className="btn btn-outline flex items-center gap-2 text-sm"
                >
                  <RefreshCw className="h-4 w-4" />Reenviar
                </button>
                <button
                  onClick={verifyOtp}
                  disabled={loading || otp.length !== 6}
                  className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {loading
                    ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />Verificando...</>
                    : <><FileSignature className="h-4 w-4" />Confirmar y firmar enmienda</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgencyAmendmentSignaturePage;
