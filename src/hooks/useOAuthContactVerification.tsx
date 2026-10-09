import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { CheckCircle } from 'lucide-react';
import { supabase, UserRole } from '../lib/supabase';
import EmailCodeVerify from '../components/EmailCodeVerify';
import PhoneOtpVerify from '../components/PhoneOtpVerify';

interface Options {
  user: User | null;
  /** Qué política de celular aplica: la de viajeros o la de agencias. */
  audience?: 'traveler' | 'agency';
  emailLabel?: string;
  phoneLabel?: string;
  providerLabel: string;
  emailFromProvider: boolean;
  email: string;
  onEmailChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  inputClass?: string;
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLASS = 'appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-primary-500 focus:border-primary-500 sm:text-sm';

/**
 * Los dos campos verificables de los registros sociales de VIAJERO: correo y celular.
 * Cada uno trae su botón y su caja de código dentro del formulario, y `ready` solo es
 * true cuando están verificados los que deben estarlo. La página usa `ready` para
 * habilitar "Crear cuenta".
 *
 * - Correo: si el proveedor lo entregó ya viene verificado. Si no, se captura y se
 *   verifica con código (send-verification-email / verify-email-code).
 * - Celular: solo se exige si la política lo pide (`phone_verification_required` y
 *   `phone_verification_travelers_required`, los mismos interruptores del panel admin).
 *
 * Ambos códigos necesitan una fila en `users`, así que se crea (a medias) en el primer
 * clic. Ver `guardarPerfilViajero`.
 */
export function useOAuthContactVerification({ user, audience = 'traveler', emailLabel = 'Correo electrónico', phoneLabel = 'Número de celular', providerLabel, emailFromProvider, email, onEmailChange, phone, onPhoneChange, inputClass = INPUT_CLASS }: Options) {
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailStep, setEmailStep] = useState<'idle' | 'code'>('idle');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneLocked, setPhoneLocked] = useState(false);
  const [phoneKey, setPhoneKey] = useState(0);
  const profile = useRef<Promise<void> | null>(null);

  const policy = useQuery({
    queryKey: ['oauth-phone-policy', audience],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('phone_verification_required, phone_verification_travelers_required, phone_verification_agencies_required')
        .single();
      if (error) throw error;
      const rolExigido = audience === 'agency' ? data.phone_verification_agencies_required : data.phone_verification_travelers_required;
      return Boolean(data.phone_verification_required && rolExigido);
    },
    retry: 1,
  });
  // Quien abandonó a medias y vuelve ya puede tener el celular verificado: no se le pide otro SMS.
  const savedProfile = useQuery({
    queryKey: ['oauth-pending-profile', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('phone_verified_at, phone_number')
        .eq('id', user?.id ?? '')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const phoneIsVerified = phoneVerified || Boolean(savedProfile.data?.phone_verified_at);
  const savedPhone = savedProfile.data?.phone_verified_at ? savedProfile.data.phone_number : null;
  useEffect(() => {
    if (savedPhone && !phone.trim()) onPhoneChange(savedPhone);
  }, [savedPhone, phone, onPhoneChange]);

  const phoneRequired = policy.data === true;
  const emailOk = emailFromProvider || emailVerified;
  const phoneOk = policy.isSuccess && (!phoneRequired || phoneIsVerified);
  const ready = emailOk && phoneOk;

  const crearPerfilPendiente = async () => {
    if (!user) throw new Error('Sesión no encontrada');
    const { data: existente, error: errorLectura } = await supabase
      .from('users')
      .select('id, onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();
    if (errorLectura) throw new Error('No pudimos preparar tu registro. Intenta de nuevo.');
    if (existente) {
      if (existente.onboarding_completed !== false) throw new Error('Esta cuenta ya está registrada. Inicia sesión.');
      return;
    }
    const meta = user.user_metadata ?? {};
    const fullName: string = meta.full_name || meta.name || '';
    const nombre = meta.given_name || fullName.split(' ')[0] || '';
    const apellido = meta.family_name || fullName.split(' ').slice(1).join(' ') || '';
    // `email` no se escribe: el trigger sync_user_email lo toma de auth, y un correo escrito
    // a mano no puede vivir ahí hasta verificarse (lo guarda el servidor al enviar el código).
    const { error } = await supabase.from('users').insert({
      id: user.id,
      role: UserRole.TRAVELER,
      first_name: nombre || null,
      last_name: apellido || null,
      apellido_paterno: apellido || null,
      email_verified: emailFromProvider,
      onboarding_completed: false,
      profile_picture_url: meta.avatar_url || meta.picture || null,
    });
    if (error) throw new Error('No pudimos preparar tu registro. Intenta de nuevo.');
  };

  // Una sola creación aunque se pulsen los dos botones; si falla se puede reintentar.
  const asegurarPerfil = () => {
    if (!profile.current) {
      profile.current = crearPerfilPendiente().catch(e => { profile.current = null; throw e; });
    }
    return profile.current;
  };

  const enviarCorreo = async () => {
    setEmailBusy(true);
    setEmailError('');
    try {
      const limpio = email.trim().toLowerCase();
      const { data: disponible, error: errorDisponible } = await supabase.rpc('check_email_available', { p_email: limpio });
      // Si la consulta falla no se bloquea ni se asusta a la persona: es un aviso temprano y el
      // servidor vuelve a comprobarlo al enviar el código y al asociar el correo.
      if (errorDisponible) console.error('No se pudo comprobar si el correo ya tiene cuenta', errorDisponible);
      if (!errorDisponible && disponible === false) {
        setEmailError('Este correo ya tiene una cuenta. Usa otro correo o inicia sesión con esa cuenta.');
        return;
      }
      await asegurarPerfil();
      onEmailChange(limpio);
      setEmailStep('code');
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'No se pudo preparar la verificación.');
    } finally {
      setEmailBusy(false);
    }
  };

  const usarOtroTelefono = () => { setPhoneLocked(false); setPhoneKey(k => k + 1); };

  const emailField = (
    <div>
      <label className="block text-sm font-medium text-gray-700">{emailLabel}</label>
      {emailFromProvider ? (
        <>
          <input name="email" type="email" value={email} readOnly className={`mt-1 ${inputClass} bg-gray-50`} />
          <p className="mt-1 text-xs text-gray-400">Email verificado por {providerLabel}</p>
        </>
      ) : emailVerified ? (
        <>
          <input name="email" type="email" value={email} readOnly className={`mt-1 ${inputClass} bg-gray-50`} />
          <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><CheckCircle className="h-3.5 w-3.5" /> Correo verificado</p>
        </>
      ) : (
        <>
          <div className="mt-1 flex gap-2">
            <input
              name="email" type="email" autoComplete="email" value={email}
              onChange={e => onEmailChange(e.target.value)}
              disabled={emailStep === 'code'}
              className={`${inputClass} min-w-0 flex-1 disabled:bg-gray-50`}
            />
            {emailStep === 'idle' ? (
              <button
                type="button" onClick={() => void enviarCorreo()}
                disabled={emailBusy || !EMAIL_VALIDO.test(email.trim())}
                className="shrink-0 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {emailBusy ? 'Enviando…' : 'Enviar código'}
              </button>
            ) : (
              <button type="button" onClick={() => setEmailStep('idle')} className="shrink-0 text-sm text-primary-600 underline">Cambiar</button>
            )}
          </div>
          <p className="mt-1 text-xs text-amber-600">{providerLabel} no compartió tu correo. Captúralo y verifícalo con el código que te enviaremos.</p>
          {emailError && <p role="alert" className="mt-1 text-sm text-red-600">{emailError}</p>}
          {emailStep === 'code' && user && (
            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
              <EmailCodeVerify userId={user.id} email={email.trim().toLowerCase()} onVerified={() => setEmailVerified(true)} />
            </div>
          )}
        </>
      )}
    </div>
  );

  const phoneField = (
    <div>
      <label className="block text-sm font-medium text-gray-700">{phoneLabel}</label>
      <div className="mt-1 flex gap-2">
        <input
          name="phoneNumber" type="tel" value={phone}
          onChange={e => onPhoneChange(e.target.value)}
          placeholder="+52 55 1234 5678"
          disabled={phoneLocked || phoneIsVerified}
          required
          className={`${inputClass} min-w-0 flex-1 disabled:bg-gray-50`}
        />
        {phoneLocked && !phoneIsVerified && (
          <button type="button" onClick={usarOtroTelefono} className="shrink-0 text-sm text-primary-600 underline">Cambiar</button>
        )}
      </div>
      {policy.isError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          No pudimos comprobar si tu celular debe verificarse.{' '}
          <button type="button" onClick={() => void policy.refetch()} className="underline">Reintentar</button>
        </p>
      )}
      {phoneIsVerified ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><CheckCircle className="h-3.5 w-3.5" /> Celular verificado</p>
      ) : phoneRequired && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          {emailOk ? (
            <PhoneOtpVerify
              key={phoneKey}
              initialPhone={phone}
              phone={phone}
              showPhoneInput={false}
              beforeRequest={async () => {
                if (!phone.trim()) throw new Error('Captura tu número de celular.');
                await asegurarPerfil();
              }}
              onRequested={() => setPhoneLocked(true)}
              onVerified={() => setPhoneVerified(true)}
            />
          ) : (
            <p className="text-xs text-gray-500">Primero verifica tu correo; después podrás validar tu celular.</p>
          )}
        </div>
      )}
    </div>
  );

  return { emailField, phoneField, ready, phoneVerified: phoneIsVerified };
}
