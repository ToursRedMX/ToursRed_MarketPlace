import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  userId: string;
  email: string;
  onVerified: () => void;
}

async function callEmailFunction(name: 'send-verification-email' | 'verify-email-code', body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesión expirada. Inicia sesión nuevamente.');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.success) throw new Error(result.error || 'No se pudo completar la solicitud.');
}

// Verifica el correo capturado a mano (Facebook no lo devolvió). Reutiliza las
// mismas Edge Functions del registro con correo y contraseña.
const EmailCodeVerify: React.FC<Props> = ({ userId, email, onVerified }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await callEmailFunction('send-verification-email', { userId });
      setCooldown(60);
      setMessage(`Te enviamos un código de 6 dígitos a ${email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el código.');
    } finally {
      setBusy(false);
    }
  }, [userId, email]);

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    void send();
  }, [send]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await callEmailFunction('verify-email-code', { code });
      setDone(true);
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle className="h-4 w-4" /> Correo verificado.</p>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      <div className="flex items-start gap-2">
        <Mail className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-gray-700">Verifica tu correo <strong>{email}</strong> con el código que te enviamos.</p>
      </div>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="Código de 6 dígitos"
        aria-label="Código de verificación del correo"
        disabled={busy}
        className="block w-full px-3 py-2 border border-gray-300 rounded-md tracking-widest sm:text-sm"
      />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && !error && <p role="status" className="text-sm text-green-700">{message}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || code.length !== 6} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Verificar correo
        </button>
        <button type="button" onClick={() => void send()} disabled={busy || cooldown > 0} className="text-sm text-primary-600 underline disabled:opacity-50 disabled:no-underline">
          {cooldown > 0 ? `Reenviar en ${cooldown} s` : 'Reenviar código'}
        </button>
      </div>
    </form>
  );
};

export default EmailCodeVerify;
