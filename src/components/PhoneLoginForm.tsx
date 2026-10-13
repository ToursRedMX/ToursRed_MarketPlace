import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Smartphone, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOtpChannels, otpChannelLabel, type OtpChannel } from '../hooks/useOtpChannels';
import { invokePhoneOtp } from '../lib/phoneOtp';
import TurnstileWidget from './TurnstileWidget';
import { useTurnstileEnabled } from '../hooks/useTurnstileEnabled';

interface Props {
  /** La sesión ya está abierta y, si la cuenta tiene MFA, ya pasó el segundo factor. */
  onLoggedIn: (user: User) => void;
  onCancel: () => void;
}

type Paso = 'telefono' | 'codigo' | 'mfa';

/**
 * Entrar con el teléfono verificado: código por SMS o WhatsApp (lo elige la persona).
 *
 * El servidor decide si el código es bueno (verify-login-otp) y solo entonces entrega un token de un
 * solo uso que aquí se canjea por la sesión. Si la cuenta tiene TOTP, la sesión nace aal1 y NO se deja
 * pasar hasta teclear el código de la app de autenticación; cancelar ese paso cierra la sesión.
 * Una cuenta sin MFA queda protegida solo por el teléfono (riesgo de SIM swap, aceptado por Axel);
 * gastar saldo/puntos y cancelar siguen pidiendo su propia prueba.
 */
const PhoneLoginForm: React.FC<Props> = ({ onLoggedIn, onCancel }) => {
  const [paso, setPaso] = useState<Paso>('telefono');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('MX');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [suffix, setSuffix] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [expiry, setExpiry] = useState(0);
  const [simulation, setSimulation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [factorId, setFactorId] = useState('');
  const [totp, setTotp] = useState('');
  const [usuario, setUsuario] = useState<User | null>(null);
  const { turnstileEnabled, loading: captchaLoading } = useTurnstileEnabled();
  const channels = useOtpChannels();
  const [preferred, setChannel] = useState<OtpChannel>('sms');
  const channel = channels.data?.channels.includes(preferred) ? preferred : channels.data?.channels[0];

  useEffect(() => {
    const t = setInterval(() => {
      setCooldown(v => Math.max(0, v - 1));
      setExpiry(v => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const pedirCodigo = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!channel) throw new Error('No hay canales de verificación habilitados.');
      const data = await invokePhoneOtp('request-login-otp', { phone, country, channel, turnstile_token: captcha });
      setChallenge(data.challenge_id);
      setSuffix(data.phone_suffix);
      setCooldown(60);
      setExpiry(Math.max(0, Math.floor((Date.parse(data.expires_at) - Date.now()) / 1000)));
      setSimulation(Boolean(data.simulated));
      setCode('');
      setPaso('codigo');
      setMessage(
        data.simulated
          ? 'Solicitud simulada: no se enviará un mensaje real.'
          : `Si el número está registrado, te enviamos un código por ${otpChannelLabel(channel)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el código.');
    } finally {
      setBusy(false); setCaptcha(''); setCaptchaKey(k => k + 1);
    }
  };

  const terminar = (user: User) => onLoggedIn(user);

  const entrar = async () => {
    setBusy(true); setError('');
    try {
      const data = await invokePhoneOtp('verify-login-otp', { challenge_id: challenge, code });
      if (!data?.token_hash) throw new Error('No se pudo iniciar la sesión.');
      // El tipo exacto que acepta el canje del token no se pudo probar fuera de Supabase: se prueba el que
      // devuelve el servidor y, si lo rechaza, el equivalente. Un token inexistente no se consume.
      let sesion = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: data.verification_type ?? 'magiclink' });
      if (sesion.error) sesion = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
      if (sesion.error || !sesion.data.user) throw new Error('No se pudo iniciar la sesión. Solicita un código nuevo.');
      const user = sesion.data.user;

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factores } = await supabase.auth.mfa.listFactors();
        const factor = factores?.totp?.find(f => f.status === 'verified');
        if (factor) {
          setFactorId(factor.id); setUsuario(user); setTotp(''); setPaso('mfa');
          return;
        }
      }
      terminar(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  const verificarMfa = async () => {
    setBusy(true); setError('');
    try {
      const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: totp });
      if (mfaError || !usuario) throw new Error('El código de tu app de autenticación no es válido.');
      terminar(usuario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  const cancelarMfa = async () => {
    // Sin el segundo factor no se queda una sesión abierta.
    await supabase.auth.signOut();
    setUsuario(null); setFactorId(''); setTotp(''); setPaso('telefono'); setError('');
  };

  const inputClass = 'block w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm';
  if (channels.isPending) return <p role="status">Cargando opciones…</p>;
  if (channels.isError) return <p role="alert">No se pudieron cargar las opciones. <button type="button" className="underline" onClick={() => void channels.refetch()}>Reintentar</button></p>;
  if (!channel) return <p className="text-sm text-gray-600">Entrar con el teléfono no está disponible por ahora. <button type="button" className="underline" onClick={onCancel}>Usar correo y contraseña</button></p>;

  return (
    <div className="space-y-4">
      {paso !== 'mfa' && (
        <div className="flex items-start gap-2">
          <Smartphone className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">Entra con el celular que verificaste en tu cuenta: te enviaremos un código por {otpChannelLabel(channel)}.</p>
        </div>
      )}

      {paso === 'telefono' && (
        <div className="space-y-3">
          {channels.data.channels.length > 1 && (
            <fieldset disabled={busy} className="flex gap-4">
              <legend className="text-sm text-gray-700 mb-2">¿Cómo quieres recibir el código?</legend>
              {channels.data.channels.map(value => <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="login-otp-channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />{otpChannelLabel(value)}
              </label>)}
            </fieldset>
          )}
          <div className="grid grid-cols-3 gap-2">
            <select aria-label="País" value={country} onChange={e => setCountry(e.target.value)} disabled={busy} className={inputClass}>
              {channels.data.countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="tel" autoComplete="tel" aria-label="Teléfono con código de país" value={phone}
              onChange={e => setPhone(e.target.value)} maxLength={40} required disabled={busy}
              className={`${inputClass} col-span-2`}
            />
          </div>
          {turnstileEnabled && <TurnstileWidget key={captchaKey} onToken={setCaptcha} />}
          <button
            type="button" onClick={() => void pedirCodigo()}
            disabled={busy || !phone.trim() || captchaLoading || (turnstileEnabled && !captcha)}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar código por {otpChannelLabel(channel)}
          </button>
        </div>
      )}

      {paso === 'codigo' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Código para el teléfono terminado en {suffix}. {expiry > 0 ? `Vence en ${Math.ceil(expiry / 60)} min.` : 'El código venció.'}
          </p>
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (code.length === 6 && !busy && expiry > 0 && !simulation) void entrar(); } }}
            placeholder="Código de 6 dígitos" aria-label="Código de verificación" disabled={busy}
            className={`${inputClass} tracking-widest`}
          />
          <button
            type="button" onClick={() => void entrar()}
            disabled={busy || code.length !== 6 || expiry === 0 || simulation}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Entrar
          </button>
          <button
            type="button" onClick={() => { setPaso('telefono'); setError(''); setMessage(''); }}
            disabled={busy || cooldown > 0}
            className="w-full text-sm text-primary-600 underline disabled:text-gray-400 disabled:no-underline"
          >
            {cooldown > 0 ? `Pedir otro código en ${cooldown} s` : 'Pedir otro código o cambiar de número'}
          </button>
        </div>
      )}

      {paso === 'mfa' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-700">Tu cuenta tiene verificación en dos pasos. Escribe el código de 6 dígitos de tu app de autenticación.</p>
          </div>
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp}
            onChange={e => setTotp(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (totp.length === 6 && !busy) void verificarMfa(); } }}
            placeholder="Código de tu app" aria-label="Código de la app de autenticación" disabled={busy}
            className={`${inputClass} tracking-widest`}
          />
          <button
            type="button" onClick={() => void verificarMfa()} disabled={busy || totp.length !== 6}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Verificar y entrar
          </button>
          <button type="button" onClick={() => void cancelarMfa()} disabled={busy} className="w-full text-sm text-gray-600 underline">
            ¿Perdiste tu dispositivo? Cancela y entra con tu correo y contraseña
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && !error && paso !== 'mfa' && <p role="status" className="text-sm text-green-700">{message}</p>}

      {paso !== 'mfa' && (
        <button type="button" onClick={onCancel} disabled={busy} className="w-full text-sm text-gray-600 underline">
          Mejor uso mi correo y contraseña
        </button>
      )}
    </div>
  );
};

export default PhoneLoginForm;
