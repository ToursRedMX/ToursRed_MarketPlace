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
}

// Misma verificación por SMS (Labs Mobile) que /verificar-telefono, pero dentro
// del registro: el número ya viene capturado y solo falta enviar y validar el OTP.
const PhoneOtpVerify: React.FC<Props> = ({ initialPhone, onVerified }) => {
  const [phone, setPhone] = useState(initialPhone);
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

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await invokePhoneOtp('request-phone-otp', { phone, country, turnstile_token: captcha });
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

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
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

      <form onSubmit={request} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <select aria-label="País" value={country} onChange={e => setCountry(e.target.value)} disabled={busy} className={inputClass}>
            {(countries.data ?? ['MX']).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
        </div>
        {turnstileEnabled && <TurnstileWidget key={captchaKey} onToken={setCaptcha} />}
        <button
          type="submit"
          disabled={busy || cooldown > 0 || countries.isError || countries.isPending || captchaLoading || (turnstileEnabled && !captcha)}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {cooldown > 0 ? `Reenviar en ${cooldown} s` : challenge ? 'Enviar otro código' : 'Validar y enviar SMS'}
        </button>
      </form>

      {challenge && (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-gray-700">
            Código para el teléfono terminado en {suffix}. {expiry > 0 ? `Vence en ${Math.ceil(expiry / 60)} min.` : 'El código venció.'}
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="Código de 6 dígitos"
            aria-label="Código SMS"
            disabled={busy}
            className={`${inputClass} tracking-widest`}
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6 || expiry === 0 || simulation}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Verificar teléfono
          </button>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && !error && <p role="status" className="text-sm text-green-700">{message}</p>}
    </div>
  );
};

export default PhoneOtpVerify;
