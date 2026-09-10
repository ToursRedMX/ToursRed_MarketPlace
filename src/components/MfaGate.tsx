import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Shield, ShieldCheck, KeyRound, Smartphone, AlertTriangle, Loader2, ArrowRight } from 'lucide-react';

type GateState = 'loading' | 'not_required' | 'needs_enrollment' | 'needs_challenge' | 'passed' | 'error';

export interface MfaGateProps {
  children: React.ReactNode;
}

export const MfaGate: React.FC<MfaGateProps> = ({ children }) => {
  const { user, isAdmin, isAccountant, isSuperAdmin } = useAuth();
  const [state, setState] = useState<GateState>('loading');
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [totpSecret, setTotpSecret] = useState<string>('');
  const [verifyCode, setVerifyCode] = useState('');
  const [challengeCode, setChallengeCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [factorId, setFactorId] = useState<string>('');

  const checkMfaStatus = useCallback(async () => {
    if (!user) {
      setState('not_required');
      return;
    }

    const requiresMfa = isAdmin || isSuperAdmin || isAccountant;
    if (!requiresMfa) {
      setState('not_required');
      return;
    }

    try {
      const { data: settings, error: errorSettings } = await supabase
        .from('platform_settings')
        .select('mfa_required_for_admins, mfa_required_for_accountant')
        .maybeSingle();

      // Si no podemos leer la configuracion no sabemos si el MFA es obligatorio.
      // Asumir que no lo es abriria el panel de administracion sin segundo factor,
      // asi que bloqueamos y pedimos reintentar.
      if (errorSettings) {
        console.error('MfaGate: no se pudo leer platform_settings', errorSettings);
        setError('No pudimos verificar la configuracion de seguridad. Reintenta en unos segundos.');
        setState('error');
        return;
      }

      const adminToggle = settings?.mfa_required_for_admins ?? false;
      const accountantToggle = settings?.mfa_required_for_accountant ?? false;

      const adminNeedsMfa = (isAdmin || isSuperAdmin) && adminToggle;
      const accountantNeedsMfa = isAccountant && accountantToggle;

      if (!adminNeedsMfa && !accountantNeedsMfa) {
        setState('not_required');
        return;
      }

      const { data: factors, error: errorFactors } = await supabase.auth.mfa.listFactors();
      if (errorFactors) {
        console.error('MfaGate: no se pudieron listar los factores MFA', errorFactors);
        setError('No pudimos verificar tu autenticacion en dos pasos. Reintenta en unos segundos.');
        setState('error');
        return;
      }

      const totpFactors = (factors?.totp ?? []).filter((f: any) => f.status === 'verified');

      if (totpFactors.length === 0) {
        setMfaFactors(factors?.totp ?? []);
        setState('needs_enrollment');
        return;
      }

      const { data: { session }, error: errorSession } = await supabase.auth.getSession();
      if (errorSession) {
        console.error('MfaGate: no se pudo leer la sesion', errorSession);
        setError('No pudimos verificar tu sesion. Reintenta en unos segundos.');
        setState('error');
        return;
      }

      // Un token ilegible no es prueba de aal2: ante la duda pedimos el codigo.
      let jwtAal = 'aal1';
      if (session?.access_token) {
        try {
          jwtAal = JSON.parse(atob(session.access_token.split('.')[1]))?.aal ?? 'aal1';
        } catch (errorToken) {
          console.error('MfaGate: no se pudo leer el aal del token', errorToken);
          jwtAal = 'aal1';
        }
      }

      if (jwtAal === 'aal2') {
        setState('passed');
        return;
      }

      setFactorId('');
      setState('needs_challenge');
    } catch (err: any) {
      // Cualquier fallo inesperado tambien bloquea: antes caia en 'not_required'
      // y dejaba entrar al panel sin segundo factor.
      console.error('MfaGate: fallo al verificar el estado de MFA', err);
      setError('No pudimos verificar tu autenticacion en dos pasos. Reintenta en unos segundos.');
      setState('error');
    }
  }, [user, isAdmin, isAccountant, isSuperAdmin]);

  useEffect(() => {
    checkMfaStatus();
  }, [checkMfaStatus]);

  const startEnrollment = useCallback(async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'ToursRed',
      });
      if (enrollError) throw enrollError;

      setFactorId(data.id);
      setTotpSecret(data.totp.secret);
      setQrUrl(data.totp.qr_code);
    } catch (err: any) {
      setError(err.message || 'Error al configurar MFA');
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const verifyEnrollment = useCallback(async () => {
    setError('');
    if (verifyCode.length !== 6) {
      setError('El codigo debe tener 6 digitos');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) throw challengeError;
      const challengeIdLocal = challengeData?.id;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeIdLocal,
        code: verifyCode,
      });
      if (verifyError) throw verifyError;

      setState('passed');
      setVerifyCode('');
    } catch (err: any) {
      setError(err.message || 'Codigo incorrecto. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  }, [factorId, verifyCode]);

  const startChallenge = useCallback(async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const { data: factors, error: errorFactors } = await supabase.auth.mfa.listFactors();
      if (errorFactors) throw errorFactors;
      const verifiedFactor = (factors?.totp ?? []).find((f: any) => f.status === 'verified');
      if (!verifiedFactor) {
        setState('needs_enrollment');
        return;
      }

      // OJO: aqui NO se crea el challenge, a proposito.
      //
      // Antes se creaba en este punto y su id se guardaba en el estado. Como
      // el estado sobrevive a que la pantalla vuelva a pedir MFA, la vista se
      // saltaba el boton —habia `challengeId`— y mandaba `verify` contra un
      // challenge YA CONSUMIDO. Medido en los logs de auth el 10-sep-2026:
      //
      //     19:16:34  POST /challenge  200
      //     19:16:42  POST /verify     200   <- entro
      //     19:57:21  POST /verify     422   <- sin challenge nuevo
      //     19:57:36  POST /verify     422   <- sin challenge nuevo
      //
      // Dos `verify` seguidos sin un solo `challenge` en medio. GoTrue
      // responde "Challenge and verify IP addresses mismatch", que despista
      // muchisimo: la IP era 187.190.63.128 en las cuatro peticiones. El
      // problema nunca fue la IP, era el challenge gastado.
      setFactorId(verifiedFactor.id);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar verificacion');
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const verifyChallenge = useCallback(async () => {
    setError('');
    if (challengeCode.length !== 6) {
      setError('El codigo debe tener 6 digitos');
      return;
    }
    setIsSubmitting(true);
    try {
      // Challenge FRESCO en la misma accion que el verify. Un challenge se
      // consume al usarse, asi que reutilizar uno guardado falla siempre. Es
      // el mismo orden que ya usaba `verifyEnrollment`, que por eso nunca
      // tuvo este problema.
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const challengeIdFresco = challengeData?.id;
      if (!challengeIdFresco) {
        throw new Error('No se pudo iniciar la verificacion. Reintenta.');
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeIdFresco,
        code: challengeCode,
      });
      if (verifyError) throw verifyError;

      setState('passed');
      setChallengeCode('');
    } catch (err: any) {
      setError(err.message || 'Codigo incorrecto. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  }, [factorId, challengeCode]);

  if (state === 'loading' || state === 'not_required' || state === 'passed') {
    return <>{children}</>;
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-8">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4 mx-auto">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">No pudimos verificar tu seguridad</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {error || 'No pudimos verificar tu autenticacion en dos pasos. Reintenta en unos segundos.'}
          </p>
          <button
            onClick={() => { setError(''); setState('loading'); checkMfaStatus(); }}
            className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors"
          >
            Reintentar
          </button>
          <button
            onClick={async () => { await supabase.auth.signOut(); }}
            className="mt-4 w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-8">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {state === 'needs_enrollment' ? 'Configura tu autenticacion en dos pasos' : 'Verifica tu identidad'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            {state === 'needs_enrollment'
              ? 'Por seguridad, los administradores deben configurar autenticacion de dos factores (TOTP) antes de continuar.'
              : 'Ingresa el codigo de tu app autenticadora para acceder al panel de administracion.'}
          </p>
        </div>

        {state === 'needs_enrollment' && !qrUrl && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 flex gap-3">
              <Smartphone className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-600">
                Necesitas una app autenticadora como Google Authenticator, Microsoft Authenticator o Authy. Escanea el codigo QR para vincularla.
              </p>
            </div>
            <button
              onClick={startEnrollment}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
              Generar codigo QR
            </button>
          </div>
        )}

        {state === 'needs_enrollment' && qrUrl && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <img src={qrUrl} alt="QR Code MFA" className="w-48 h-48 rounded-lg border border-slate-200" />
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">O ingresa manualmente esta clave:</p>
              <p className="font-mono text-sm text-slate-700 break-all">{totpSecret}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Codigo de verificacion (6 digitos)</label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full text-center text-2xl tracking-widest font-mono border border-slate-300 rounded-xl py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                maxLength={6}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            )}
            <button
              onClick={verifyEnrollment}
              disabled={isSubmitting || verifyCode.length !== 6}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
              Verificar y activar
            </button>
          </div>
        )}

        {state === 'needs_challenge' && (
          <div className="space-y-4">
            {!factorId ? (
              <button
                onClick={startChallenge}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                Iniciar verificacion
              </button>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Codigo de tu app autenticadora</label>
                  <input
                    type="text"
                    value={challengeCode}
                    onChange={(e) => setChallengeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full text-center text-2xl tracking-widest font-mono border border-slate-300 rounded-xl py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {error}
                  </div>
                )}
                <button
                  onClick={verifyChallenge}
                  disabled={isSubmitting || challengeCode.length !== 6}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  Verificar
                </button>
              </>
            )}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={async () => { await supabase.auth.signOut(); }}
            className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  );
};
