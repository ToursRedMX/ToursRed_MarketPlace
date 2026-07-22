import React, { useState } from 'react';
import { Ligature as FileSignature, Send, CheckCircle, RefreshCw, AlertCircle, Download, ArrowRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import ContractDraftViewer from '../../../components/contracts/ContractDraftViewer';

interface Props {
  agencyId: string;
  agencyEmail: string;
  onSigned: () => void;
}

type Stage = 'intro' | 'otp_sent' | 'signed';

const CONTRACT_VERSION = '1.0';

const OnboardingSignatureStep: React.FC<Props> = ({ agencyId, agencyEmail, onSigned }) => {
  const [stage, setStage]       = useState<Stage>('intro');
  const [otp, setOtp]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [folio, setFolio]       = useState<string | null>(null);

  const callFn = async (slug: string, body: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw { status: res.status, message: json.error, retry_after_minutes: json.retry_after_minutes };
    return json;
  };

  const handleSendOtp = async () => {
    setLoading(true);
    setError('');
    setRetryAfter(null);
    try {
      await callFn('request-contract-otp', { contract_version: CONTRACT_VERSION });
      setStage('otp_sent');
    } catch (err: any) {
      if (err.status === 429) {
        setRetryAfter(err.retry_after_minutes ?? null);
        setError(err.message ?? 'Demasiados intentos. Espera antes de solicitar otro código.');
      } else {
        setError(err.message ?? 'Error al enviar el código. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(otp)) { setError('Ingresa un código de 6 dígitos.'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await callFn('verify-contract-otp', { otp });
      setStage('signed');
      setFolio(result?.folio ?? null);
      setSignedUrl(result?.signed_url ?? null);
    } catch (err: any) {
      setError(err.message ?? 'Código incorrecto o expirado.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!signedUrl) return;
    const a = document.createElement('a');
    a.href = signedUrl;
    a.download = `contrato-${folio ?? 'firmado'}.pdf`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (stage === 'signed') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-green-400 to-green-500" />
        <div className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Contrato firmado!</h2>
          <p className="text-gray-500 text-sm mb-2">Tu cuenta ha sido activada exitosamente.</p>
          {folio && (
            <p className="text-gray-400 text-xs mb-6">Folio: <span className="font-mono font-semibold text-gray-600">{folio}</span></p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
            <button
              onClick={handleDownloadPdf}
              disabled={!signedUrl}
              className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                signedUrl ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Download className="w-4 h-4" />
              Descargar PDF
            </button>
            <button
              onClick={onSigned}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
            >
              Ir a mi panel
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {!signedUrl && (
            <p className="text-xs text-gray-400 mt-3">Preparando tu contrato en PDF...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-primary-500 to-primary-600" />
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <FileSignature className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Firma del contrato</h2>
            <p className="text-sm text-gray-500">Confirma tu identidad para firmar digitalmente.</p>
          </div>
        </div>

        {stage === 'intro' && (
          <>
            <div className="bg-gray-50 rounded-xl p-5 mb-5 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Contrato de Colaboración — Agencia</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Al firmar este contrato confirmas que eres el representante legal o apoderado autorizado de la agencia, que los datos proporcionados son verídicos, y que aceptas los términos de colaboración con ToursRed (comisiones, tiempos de pago, política de cancelaciones y uso de la plataforma).
              </p>
            </div>

            {/* Contract HTML preview — embedded */}
            <div className="mb-5">
              <ContractDraftViewer agencyId={agencyId} />
            </div>

            <div className="relative flex items-center mb-5">
              <div className="flex-grow border-t border-gray-200" />
              <span className="flex-shrink-0 mx-3 text-xs text-gray-400">Una vez revisado, procede a firmar</span>
              <div className="flex-grow border-t border-gray-200" />
            </div>

            <p className="text-sm text-gray-700 mb-5">
              Enviaremos un código de verificación (OTP) a{' '}
              <strong className="text-gray-900">{agencyEmail}</strong> para confirmar tu identidad.
            </p>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}{retryAfter ? ` (${retryAfter} min)` : ''}</span>
              </div>
            )}

            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar código de verificación
            </button>
          </>
        )}

        {stage === 'otp_sent' && (
          <>
            <div className="bg-green-50 rounded-xl p-4 mb-6 text-sm text-green-800">
              Código enviado a <strong>{agencyEmail}</strong>. Revisa tu bandeja de entrada (y spam).
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-2">Código de verificación (6 dígitos)</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-4"
            />

            {error && (
              <div className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleVerify}
              disabled={loading || otp.length !== 6}
              className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-3"
            >
              {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Firmar contrato
            </button>

            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full text-sm text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1.5 py-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reenviar código
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default OnboardingSignatureStep;
