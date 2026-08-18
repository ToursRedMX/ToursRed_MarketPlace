import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Shield, ShieldCheck, KeyRound, Smartphone, Loader2, AlertTriangle, Check, X, RefreshCw } from 'lucide-react';

interface MfaFactor {
  id: string;
  friendly_name: string | null;
  factor_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export const MfaSettingsSection: React.FC = () => {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [newFactorId, setNewFactorId] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      setFactors((data?.totp ?? []) as MfaFactor[]);
    } catch {
      setFactors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFactors();
    supabase.from('users').select('is_super_admin').maybeSingle().then(({ data }) => {
      setIsSuperAdmin(data?.is_super_admin ?? false);
    }).catch(() => {});
  }, [loadFactors]);

  const handleStartEnrollment = async () => {
    setError('');
    setSuccess('');
    setIsEnrolling(true);
    setQrUrl('');
    setVerifyCode('');
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'ToursRed',
      });
      if (enrollError) throw enrollError;
      setNewFactorId(data.id);
      setTotpSecret(data.totp.secret);
      setQrUrl(data.totp.qr_code);
    } catch (err: any) {
      setError(err.message || 'Error al crear factor MFA');
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleVerifyEnrollment = async () => {
    setError('');
    if (verifyCode.length !== 6) {
      setError('El codigo debe tener 6 digitos');
      return;
    }
    try {
      const { error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: newFactorId,
      });
      if (challengeError) throw challengeError;

      const { data: challengeData } = await supabase.auth.mfa.challenge({ factorId: newFactorId });

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: newFactorId,
        challengeId: challengeData?.id,
        code: verifyCode,
      });
      if (verifyError) throw verifyError;

      setSuccess('Autenticacion de dos pasos activada correctamente');
      setQrUrl('');
      setVerifyCode('');
      setTotpSecret('');
      await loadFactors();
    } catch (err: any) {
      setError(err.message || 'Codigo incorrecto');
    }
  };

  const handleDeleteFactor = async (factorId: string) => {
    setError('');
    setSuccess('');
    try {
      const { error: deleteError } = await supabase.auth.mfa.unenroll({
        factorId,
      });
      if (deleteError) throw deleteError;
      setSuccess('Factor eliminado');
      await loadFactors();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar factor');
    }
  };

  const verifiedFactors = factors.filter((f) => f.status === 'verified');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Autenticacion en dos pasos (TOTP)</h3>
          <p className="text-sm text-slate-500">Protege tu cuenta con una app autenticadora</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 text-green-600 text-sm bg-green-50 rounded-lg p-3">
          <Check className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {verifiedFactors.length === 0 ? (
              <div className="bg-amber-50 rounded-lg p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">No tienes MFA configurado</p>
                  <p className="text-xs text-amber-600 mt-1">
                    {isSuperAdmin
                      ? 'Configura MFA ahora. Sin esto, no podras activar el requisito de MFA para administradores.'
                      : 'Te recomendamos configurar MFA para mayor seguridad.'}
                  </p>
                </div>
              </div>
            ) : (
              verifiedFactors.map((factor) => (
                <div key={factor.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {factor.friendly_name || 'App autenticadora'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Configurado {new Date(factor.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteFactor(factor.id)}
                    className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    title="Eliminar factor"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {!qrUrl ? (
            <button
              onClick={handleStartEnrollment}
              disabled={isEnrolling}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isEnrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {verifiedFactors.length > 0 ? 'Agregar otro factor' : 'Configurar MFA'}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <img src={qrUrl} alt="QR MFA" className="w-44 h-44 rounded-lg border border-slate-200" />
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Clave manual:</p>
                <p className="font-mono text-xs text-slate-600 break-all">{totpSecret}</p>
              </div>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Codigo de 6 digitos"
                className="w-full text-center text-xl tracking-widest font-mono border border-slate-300 rounded-lg py-2.5 focus:ring-2 focus:ring-blue-500"
                maxLength={6}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setQrUrl(''); setVerifyCode(''); setTotpSecret(''); }}
                  className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleVerifyEnrollment}
                  disabled={verifyCode.length !== 6}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" /> Activar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
