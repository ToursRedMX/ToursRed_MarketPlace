import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Shield, ShieldCheck, KeyRound, Loader2, AlertTriangle, Check, X, RefreshCw,
  Copy, Download, KeySquare,
} from 'lucide-react';

interface MfaFactor {
  id: string;
  friendly_name: string | null;
  factor_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

async function callEdgeFunction(path: string, body: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'Apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

export const MfaSettingsSection: React.FC = () => {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [newFactorId, setNewFactorId] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Recovery codes state
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState<number | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [savedCodesConfirmed, setSavedCodesConfirmed] = useState(false);
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState('');
  const [regenerating, setRegenerating] = useState(false);

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

  const loadRecoveryCodesRemaining = useCallback(async () => {
    try {
      const { count } = await supabase
        .from('mfa_recovery_codes')
        .select('id', { count: 'exact', head: true })
        .is('used_at', null);
      setRecoveryCodesRemaining(count ?? 0);
    } catch {
      setRecoveryCodesRemaining(null);
    }
  }, []);

  useEffect(() => {
    loadFactors();
    supabase.from('users').select('is_super_admin').maybeSingle().then(({ data }) => {
      setIsSuperAdmin(data?.is_super_admin ?? false);
    }).catch(() => {});
  }, [loadFactors]);

  useEffect(() => {
    const verified = factors.filter((f) => f.status === 'verified');
    if (verified.length > 0) {
      loadRecoveryCodesRemaining();
    } else {
      setRecoveryCodesRemaining(null);
    }
  }, [factors, loadRecoveryCodesRemaining]);

  // Borra factores TOTP unverified que hayan quedado colgando de un intento
  // anterior. Devuelve cuantos limpio.
  //
  // OJO con listFactors(): `data.totp` trae SOLO los verified —auth-js filtra
  // por status al armarlo— y los unverified aparecen unicamente en `data.all`.
  // Filtrar sobre `.totp`, que es lo que usa loadFactors(), no encontraria
  // nunca un huerfano y esta limpieza no haria nada.
  const cleanupOrphanFactors = useCallback(async (): Promise<number> => {
    const { data } = await supabase.auth.mfa.listFactors();
    const orphans = (data?.all ?? []).filter(
      (f) => f.factor_type === 'totp' && f.status !== 'verified',
    );
    let removed = 0;
    for (const orphan of orphans) {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: orphan.id });
      if (!unenrollError) removed++;
    }
    return removed;
  }, []);

  const handleStartEnrollment = async () => {
    setError('');
    setSuccess('');
    setIsEnrolling(true);
    setQrUrl('');
    setVerifyCode('');
    try {
      // Red de seguridad. enroll() crea el factor en el servidor de inmediato
      // —asi es como Supabase genera el QR—, asi que un intento que muere sin
      // pasar por "Cancelar" (pestana cerrada, conexion caida) deja un factor
      // unverified huerfano. Como todos se crean con friendly_name vacio, el
      // siguiente enroll() choca con el huerfano y Auth responde
      //   A factor with the friendly name "" for this user already exists
      // dejando al usuario bloqueado sin nada que pueda hacer al respecto.
      // Se limpia antes de intentar crear el nuevo.
      await cleanupOrphanFactors();

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'ToursRed',
      });
      if (enrollError) throw enrollError;
      setNewFactorId(data.id);
      setTotpSecret(data.totp.secret);
      setQrUrl(data.totp.qr_code);
    } catch (err: any) {
      // Si aun asi choca con un duplicado, la limpieza fallo (sin red, sesion
      // expirada). El mensaje crudo de Auth no le dice nada al usuario.
      const raw = err?.message || '';
      setError(
        /already exists/i.test(raw)
          ? 'Quedo una configuracion de MFA a medias que no se pudo limpiar. Recarga la pagina e intentalo de nuevo.'
          : raw || 'Error al crear factor MFA',
      );
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleCancelEnrollment = async () => {
    const factorId = newFactorId;
    setError('');
    // Cancelar de verdad tiene que borrar el factor que enroll() ya creo en el
    // servidor; si no, queda huerfano y bloquea el siguiente intento.
    if (factorId) {
      setIsCancelling(true);
      try {
        await supabase.auth.mfa.unenroll({ factorId });
      } catch {
        // Best-effort a proposito: si falla, cleanupOrphanFactors lo recoge en
        // el proximo "Configurar MFA". No se atrapa al usuario en el modal por
        // una llamada de red que fallo cuando lo que pidio fue justamente salir.
      } finally {
        setIsCancelling(false);
      }
    }
    setQrUrl('');
    setVerifyCode('');
    setTotpSecret('');
    setNewFactorId('');
  };

  const handleVerifyEnrollment = async () => {
    setError('');
    if (verifyCode.length !== 6) {
      setError('El codigo debe tener 6 digitos');
      return;
    }
    try {
      // Un solo challenge — el ID se usa directamente en verify.
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: newFactorId,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: newFactorId,
        challengeId: challengeData.id,
        code: verifyCode,
      });
      if (verifyError) throw verifyError;

      setQrUrl('');
      setVerifyCode('');
      setTotpSecret('');
      // El factor ya esta verified: dejar su id en newFactorId apuntaria a un
      // factor activo, no a uno huerfano.
      setNewFactorId('');
      await loadFactors();

      // Generar codigos de recuperacion automaticamente tras activar MFA
      try {
        const genData = await callEdgeFunction('generate-recovery-codes');
        setRecoveryCodes(genData.codes || null);
        setSavedCodesConfirmed(false);
        setCopiedCodes(false);
      } catch (recErr: any) {
        setSuccess('Autenticacion de dos pasos activada correctamente');
        setError(`No se pudieron generar codigos de recuperacion: ${recErr.message}. Puedes intentarlo de nuevo desde aqui.`);
      }
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

      // Invalidar codigos de recuperacion al desactivar MFA
      try {
        await callEdgeFunction('invalidate-recovery-codes');
      } catch {
        /* best-effort */
      }

      setSuccess('Factor eliminado');
      setRecoveryCodes(null);
      setRecoveryCodesRemaining(null);
      await loadFactors();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar factor');
    }
  };

  const handleCopyCodes = () => {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join('\n')).then(() => {
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }).catch(() => {});
  };

  const handleDownloadCodes = () => {
    if (!recoveryCodes) return;
    const content = [
      'ToursRed',
      'Codigos de recuperacion',
      '',
      'Guarda estos codigos en un lugar seguro.',
      'Cada codigo puede utilizarse una sola vez.',
      '',
      ...recoveryCodes,
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'toursred-codigos-recuperacion.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCloseCodesModal = () => {
    setRecoveryCodes(null);
    setSuccess('Autenticacion de dos pasos activada correctamente. Guarda tus codigos de recuperacion en un lugar seguro.');
    loadRecoveryCodesRemaining();
  };

  const handleRegenerateCodes = async () => {
    if (regenerateCode.length !== 6) {
      setError('El codigo debe tener 6 digitos');
      return;
    }
    setRegenerating(true);
    setError('');
    try {
      const verifiedFactor = factors.find((f) => f.status === 'verified');
      if (!verifiedFactor) throw new Error('No tienes un factor MFA verificado');

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId: challengeData.id,
        code: regenerateCode,
      });
      if (verifyError) throw new Error('Codigo incorrecto');

      const genData = await callEdgeFunction('generate-recovery-codes');
      setRecoveryCodes(genData.codes || null);
      setSavedCodesConfirmed(false);
      setCopiedCodes(false);
      setRegenerateModalOpen(false);
      setRegenerateCode('');
    } catch (err: any) {
      setError(err.message || 'No se pudieron regenerar los codigos');
    } finally {
      setRegenerating(false);
    }
  };

  const verifiedFactors = factors.filter((f) => f.status === 'verified');

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Autenticacion en dos pasos (TOTP)</h3>
          <p className="text-sm text-slate-500">Protege tu cuenta, tu ToursRed Cash y tus puntos</p>
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
                      : 'Necesitas activar MFA para poder usar tu ToursRed Cash o canjear puntos.'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {verifiedFactors.map((factor) => (
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
                ))}

                {/* Recovery codes status */}
                <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <KeySquare className="w-5 h-5 text-slate-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">Codigos de recuperacion</p>
                      <p className="text-xs text-slate-400">
                        {recoveryCodesRemaining === null
                          ? 'Verificando...'
                          : `Codigos restantes: ${recoveryCodesRemaining} de 10`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRegenerateModalOpen(true)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Generar nuevos
                  </button>
                </div>
              </>
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
                  onClick={handleCancelEnrollment}
                  disabled={isCancelling}
                  className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {isCancelling ? 'Cancelando...' : 'Cancelar'}
                </button>
                <button
                  onClick={handleVerifyEnrollment}
                  disabled={verifyCode.length !== 6 || isCancelling}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" /> Activar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: mostrar codigos de recuperacion (una sola vez) */}
      {recoveryCodes && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <KeySquare className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Guarda tus codigos de recuperacion</h3>
            <p className="text-sm text-slate-600 mb-4">
              Estos codigos te permitiran acceder a tu cuenta si pierdes acceso a tu aplicacion de autenticacion.
              Cada codigo solo puede utilizarse una vez. No se volveran a mostrar.
            </p>
            <div className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((code) => (
                <div key={code} className="text-slate-700">{code}</div>
              ))}
            </div>
            <div className="flex gap-2 mb-4">
              <button
                onClick={handleCopyCodes}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                {copiedCodes ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                {copiedCodes ? 'Copiado' : 'Copiar codigos'}
              </button>
              <button
                onClick={handleDownloadCodes}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <Download className="w-4 h-4" /> Descargar
              </button>
            </div>
            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={savedCodesConfirmed}
                onChange={(e) => setSavedCodesConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-slate-600">Ya guarde mis codigos en un lugar seguro</span>
            </label>
            <button
              onClick={handleCloseCodesModal}
              disabled={!savedCodesConfirmed}
              className="w-full bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {/* Modal: regenerar codigos de recuperacion */}
      {regenerateModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 relative">
            <button
              onClick={() => { setRegenerateModalOpen(false); setRegenerateCode(''); setError(''); }}
              className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Generar nuevos codigos</h3>
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3 mb-4">
              Al generar nuevos codigos, todos tus codigos anteriores dejaran de funcionar.
            </p>
            <p className="text-sm text-slate-600 mb-3">Confirma con tu codigo de tu aplicacion de autenticacion:</p>
            <input
              type="text"
              value={regenerateCode}
              onChange={(e) => setRegenerateCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Codigo de 6 digitos"
              autoFocus
              className="w-full text-center text-xl tracking-widest font-mono border border-slate-300 rounded-lg py-2.5 mb-4 focus:ring-2 focus:ring-blue-500"
              maxLength={6}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setRegenerateModalOpen(false); setRegenerateCode(''); }}
                className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-600 font-medium rounded-lg hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRegenerateCodes}
                disabled={regenerateCode.length !== 6 || regenerating}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Generar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
