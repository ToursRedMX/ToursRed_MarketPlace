import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import EmailCodeVerify from './EmailCodeVerify';
import PhoneOtpVerify from './PhoneOtpVerify';

interface Props {
  userId: string;
  email: string;
  phone: string;
  audience: 'traveler' | 'agency';
  redirectTo: string;
}

// Paso final de los registros con proveedor social (Google, Microsoft, X, Facebook,
// LinkedIn): la cuenta ya existe y aquí se verifican los datos de contacto.
// correo (solo si no está verificado) -> teléfono (solo si la política lo exige) -> destino.
// Quien abandone a medias queda cubierto por los guards de /verify-email y /verificar-telefono.
const OAuthContactVerification: React.FC<Props> = ({ userId, email, phone, audience, redirectTo }) => {
  const navigate = useNavigate();
  const { refreshAuthState, refreshPhoneVerification } = useAuth();
  const [step, setStep] = useState<'init' | 'email' | 'checking' | 'phone'>('init');
  const [error, setError] = useState('');
  const started = useRef(false);

  const finish = useCallback(async () => {
    await refreshAuthState();
    navigate(redirectTo);
  }, [refreshAuthState, navigate, redirectTo]);

  // Decide con el estado fresco del servidor. Si no se puede comprobar no se avanza:
  // mejor pedir reintento que dejar pasar a alguien sin verificar.
  const goToPhoneOrFinish = useCallback(async () => {
    setStep('checking');
    setError('');
    const { data, error: statusError } = await supabase.rpc('get_my_phone_verification_status');
    if (statusError || typeof data?.[audience]?.pending !== 'boolean') {
      setError('No pudimos comprobar la verificación de tu teléfono. Intenta de nuevo.');
      return;
    }
    await refreshPhoneVerification();
    if (data[audience].pending) setStep('phone');
    else await finish();
  }, [audience, refreshPhoneVerification, finish]);

  const start = useCallback(async () => {
    const { data, error: readError } = await supabase.from('users').select('email_verified').eq('id', userId).maybeSingle();
    if (readError) {
      setStep('checking');
      setError('No pudimos comprobar la verificación de tu correo. Intenta de nuevo.');
      return;
    }
    // El proveedor ya entregó un correo verificado: no hay código que pedir.
    if (data?.email_verified) await goToPhoneOrFinish();
    else setStep('email');
  }, [userId, goToPhoneOrFinish]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const retry = () => { void (step === 'checking' && error ? start() : goToPhoneOrFinish()); };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">Tu cuenta está creada. Falta verificar tus datos de contacto para continuar.</p>
      {step === 'email' && (
        <EmailCodeVerify userId={userId} email={email.trim().toLowerCase()} onVerified={() => void goToPhoneOrFinish()} />
      )}
      {(step === 'init' || (step === 'checking' && !error)) && (
        <p role="status" className="text-sm text-gray-500">Comprobando verificaciones…</p>
      )}
      {step === 'checking' && error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600">{error}</p>
          <button type="button" onClick={retry} className="text-sm text-primary-600 underline">Reintentar</button>
        </div>
      )}
      {step === 'phone' && <PhoneOtpVerify initialPhone={phone} onVerified={() => void finish()} />}
    </div>
  );
};

// Versión a pantalla completa, para los registros de agencia (cuyo formulario es otro componente).
export const OAuthContactVerificationPage: React.FC<Props> = props => (
  <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <h2 className="text-center text-2xl font-bold text-gray-900 mb-6">Verifica tus datos de contacto</h2>
      <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
        <OAuthContactVerification {...props} />
      </div>
    </div>
  </div>
);

export default OAuthContactVerification;
