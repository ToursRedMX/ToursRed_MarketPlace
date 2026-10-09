import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { invokePhoneOtp } from '../lib/phoneOtp';
import TurnstileWidget from './TurnstileWidget';
import { useTurnstileEnabled } from '../hooks/useTurnstileEnabled';

interface Props {
  initialPhone: string;
  onVerified: () => void;
  /** Teléfono controlado por el formulario padre. Con `showPhoneInput={false}` se usa este valor. */
  phone?: string;
  showPhoneInput?: boolean;
  /** Se ejecuta antes de pedir el SMS (por ejemplo, para crear el perfil sin el que no hay OTP). */
  beforeRequest?: () => Promise<void>;
  /** Avisa al padre que ya se pidió un código, para que deje de editar el número. */
  onRequested?: () => void;
}

// Misma verificación por SMS (Labs Mobile) que /verificar-telefono, pero dentro
// del registro: el número ya viene capturado y solo falta enviar y validar el OTP.
const PhoneOtpVerify: React.FC<Props> = ({ initialPhone, onVerified, phone: controlledPhone, showPhoneInput = true, beforeRequest, onRequested }) => {
  const [typedPhone, setPhone] = useState(initialPhone);
  const phone = controlledPhone ?? typedPhone;
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
  const { turnstileEnabled, loading: captchaLoading } = useTurnstileEnabled();

  const countries = useQuery({
    queryKey: ['sms-supported-countries'],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('platform_settings').select('sms_paises_permitidos').single();
      if (err) throw err;
      return data.sms_paises_permitidos as string[];
    },
  });

  useEffect(() => {
    const t = setInterval(() => {
      setCooldown(v => Math.max(0, v - 1));
      setExpiry(v => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const request = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await beforeRequest?.();
      const data = await invokePhoneOtp('request-phone-otp', { phone, country, turnstile_token: captcha });
      onRequested?.();
      setChallenge(data.challenge_id);
      setSuffix(data.phone_suffix);
      setCooldown(60);
      setExpiry(Math.max(0, Math.floor((Date.parse(data.expires_at) - Date.now()) / 1000)));
      setSimulation(Boolean(data.simulated));
      setCode('');
      setMessage(
        data.simulated
          ? 'Solicitud simulada: no se enviará un SMS real ni se verificará el teléfono.'
          : data.delivery === 'resultado_desconocido'
            ? 'La entrega está pendiente de confirmar. Espera antes de solicitar otro código.'
            : 'Código enviado por SMS. Revisa tus mensajes.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el código.');
    } finally {
      setBusy(false);
      setCaptcha('');
      setCaptchaKey(k => k + 1);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      await invokePhoneOtp('verify-phone-otp', { challenge_id: challenge, code });
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'block w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Smartphone className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-gray-700">Verifica tu celular: te enviaremos un código por SMS.</p>
      </div>

      {/* Sin <form>: vive dentro del formulario de registro y uno anidado lo enviaría completo. */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <select aria-label="País" value={country} onChange={e => setCountry(e.target.value)} disabled={busy} className={inputClass}>
            {(countries.data ?? ['MX']).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {showPhoneInput && (
            <input
              type="tel"
              autoComplete="tel"
              aria-label="Teléfono con código de país"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              maxLength={40}
              required
              disabled={busy}
              className={`${inputClass} col-span-2`}
            />
          )}
        </div>
        {turnstileEnabled && <TurnstileWidget key={captchaKey} onToken={setCaptcha} />}
        <button
          type="button"
          onClick={() => void request()}
          disabled={busy || !phone.trim() || cooldown > 0 || countries.isError || countries.isPending || captchaLoading || (turnstileEnabled && !captcha)}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {cooldown > 0 ? `Reenviar en ${cooldown} s` : challenge ? 'Enviar otro código' : 'Validar y enviar SMS'}
        </button>
      </div>

      {challenge && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Código para el teléfono terminado en {suffix}. {expiry > 0 ? `Vence en ${Math.ceil(expiry / 60)} min.` : 'El código venció.'}
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (code.length === 6 && !busy && expiry > 0 && !simulation) void verify(); } }}
            placeholder="Código de 6 dígitos"
            aria-label="Código SMS"
            disabled={busy}
            className={`${inputClass} tracking-widest`}
          />
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy || code.length !== 6 || expiry === 0 || simulation}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Verificar teléfono
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && !error && <p role="status" className="text-sm text-green-700">{message}</p>}
    </div>
  );
};

export default PhoneOtpVerify;
