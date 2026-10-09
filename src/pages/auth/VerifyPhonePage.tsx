import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { SmsPreferences } from '../../components/SmsPreferences';
import PhoneOtpVerify from '../../components/PhoneOtpVerify';

export default function VerifyPhonePage() {
  const { user, userRole, isLoading, isEmailVerified, phoneVerification, refreshPhoneVerification } = useAuth();
  const navigate = useNavigate(), location = useLocation();
  if (isLoading) return <p role="status" className="p-8">Cargando…</p>;
  if (!user) return <Navigate to="/login?redirect=%2Fverificar-telefono" replace />;
  if (!isEmailVerified && !['admin', 'accountant', 'account_executive'].includes(userRole ?? '')) return <Navigate to="/verify-email" replace />;
  return <main className="mx-auto max-w-lg px-4 py-12">
    <h1 className="text-2xl font-bold">Verifica tu teléfono</h1>
    <p className="my-3 text-slate-600">Verificamos el teléfono de quien controla esta cuenta. Si operas una agencia, puede ser distinto de su teléfono comercial.</p>
    {phoneVerification?.verified_at && <p className="my-3 text-green-700">Teléfono terminado en {phoneVerification.phone_suffix} verificado. Cambiar el número requerirá volver a verificarlo.</p>}
    <PhoneOtpVerify initialPhone="" onVerified={() => {
      void refreshPhoneVerification().then(() => {
        const redirect = new URLSearchParams(location.search).get('redirect');
        if (redirect?.startsWith('/') && !redirect.startsWith('//') && !redirect.includes('\\')) navigate(redirect, { replace: true });
        else navigate('/profile', { replace: true });
      });
    }} />
    <details className="mt-6"><summary>Ya no tengo acceso a mi número</summary>
      <p className="my-2">Vuelve a iniciar sesión con correo/contraseña o tu proveedor habitual para confirmar tu acceso. Después registra y verifica el nuevo teléfono.</p>
      <p>Si tampoco tienes acceso a tu correo o autenticación de dos pasos, contacta a soporte.</p>
      <button type="button" className="underline" onClick={async () => { await supabase.auth.signOut(); navigate('/login?redirect=%2Fverificar-telefono'); }}>Cerrar sesión e identificarme otra vez</button>
    </details>
    <SmsPreferences />
    <div className="mt-6 flex gap-4"><Link className="underline" to="/contact">Contactar a soporte</Link><Link className="underline" to="/profile">Volver a mi perfil</Link></div>
  </main>;
}
