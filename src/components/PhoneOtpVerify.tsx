import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useOtpChannels, otpChannelLabel, type OtpChannel } from '../hooks/useOtpChannels';
import { invokePhoneOtp } from '../lib/phoneOtp';
import TurnstileWidget from './TurnstileWidget';
import { useTurnstileEnabled } from '../hooks/useTurnstileEnabled';

interface Props {
  initialPhone: string;
  onVerified: () => void;
  /** Teléfono controlado por el formulario padre. Con `showPhoneInput={false}` se usa este valor. */
  phone?: string;
  showPhoneInput?: boolean;
  /** Prepara el perfil antes de solicitar el OTP. */
  beforeRequest?: () => Promise<void>;
  /** Avisa al padre que ya se pidió un código, para que deje de editar el número. */
  onRequested?: () => void;
}

// Compartido entre el registro y /verificar-telefono.
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
  const channels = useOtpChannels();
  const [preferredChannel, setChannel] = useState<OtpChannel>('sms');
  const channel = channels.data?.channels.includes(preferredChannel) ? preferredChannel : channels.data?.channels[0];

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
      if (!channel) throw new Error('No hay canales de verificación habilitados.');
      await beforeRequest?.();
      const data = await invokePhoneOtp('request-phone-otp', { phone, country, channel, turnstile_token: captcha });
      onRequested?.();
      setChallenge(data.challenge_id);
      setSuffix(data.phone_suffix);
      setCooldown(60);
      setExpiry(Math.max(0, Math.floor((Date.parse(data.expires_at) - Date.now()) / 1000)));
      setSimulation(Boolean(data.simulated));
      setCode('');
      setMessage(
        data.simulated
          ? 'Solicitud simulada: no se enviará un mensaje real ni se verificará el teléfono.'
          : data.delivery === 'resultado_desconocido'
            ? 'La entrega está pendiente de confirmar. Espera antes de solicitar otro código.'
            : `Código enviado por ${otpChannelLabel(channel)}. Revisa tus mensajes.`,
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
  if (channels.isPending) return <p role="status">Cargando opciones de verificación…</p>;
  if (channels.isError) return <p role="alert">No se pudieron cargar las opciones. <button type="button" className="underline" onClick={() => void channels.refetch()}>Reintentar</button></p>;
  if (!channel) return <p className="text-sm text-gray-600">La verificación por SMS y WhatsApp está deshabilitada.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Smartphone className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-gray-700">Verifica tu celular: te enviaremos un código por {otpChannelLabel(channel)}.</p>
      </div>

      {/* Sin <form>: vive dentro del formulario de registro y uno anidado lo enviaría completo. */}
      <div className="space-y-3">
        {channels.data.channels.length > 1 && (
          <fieldset disabled={busy} className="flex gap-4">
            <legend className="text-sm text-gray-700 mb-2">¿Cómo quieres recibir el código?</legend>
            {channels.data.channels.map(value => <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="otp-channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />{otpChannelLabel(value)}
            </label>)}
          </fieldset>
        )}
        <div className="grid grid-cols-3 gap-2">
          <select aria-label="País" value={country} onChange={e => setCountry(e.target.value)} disabled={busy} className={inputClass}>
            {channels.data.countries.map(c => <option key={c} value={c}>{c}</option>)}
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
          disabled={busy || !phone.trim() || cooldown > 0 || captchaLoading || (turnstileEnabled && !captcha)}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {cooldown > 0 ? `Reenviar en ${cooldown} s` : `Enviar código por ${otpChannelLabel(channel)}`}
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
            aria-label="Código de verificación"
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
