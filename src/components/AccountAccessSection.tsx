import React, { useState } from 'react';
import { Mail, Smartphone, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAccesoCuenta } from '../hooks/useAccesoCuenta';
import { useAuth } from '../context/AuthContext';
import { useStepUp } from '../context/StepUpContext';
import PhoneOtpVerify from './PhoneOtpVerify';

const MENSAJES_CORREO: Record<string, string> = {
  EMAIL_INVALID: 'Escribe un correo válido.',
  EMAIL_SAME: 'Ese ya es el correo de tu cuenta.',
  EMAIL_CHANGE_RATE_LIMIT: 'Pediste demasiados códigos. Espera una hora e inténtalo de nuevo.',
  EMAIL_SEND_FAILED: 'No pudimos enviar el código. Intenta de nuevo en unos minutos.',
  EMAIL_CHANGE_UNAVAILABLE: 'El cambio de correo no está disponible en este momento. Intenta más tarde.',
  CODE_INVALID: 'El código no es correcto.',
  CODE_EXPIRED: 'El código venció. Pide uno nuevo.',
  CODE_LOCKED: 'Demasiados intentos. Pide un código nuevo.',
  EMAIL_TAKEN: 'Ese correo ya pertenece a otra cuenta.',
};

/**
 * Correo y teléfono con los que se entra a la cuenta. Cambiar cualquiera exige reautenticación
 * (TOTP si hay MFA, si no la contraseña) y que el valor NUEVO se verifique con un código antes de
 * reemplazar al vigente: hasta entonces el de siempre sigue siendo el bueno.
 */
const AccountAccessSection: React.FC = () => {
  const { user } = useAuth();
  const { invokeWithStepUp } = useStepUp();
  const { acceso, cargaFallida, telefonoVerificado: verificado, recargar: cargar } = useAccesoCuenta();
  const [aviso, setAviso] = useState('');

  // Teléfono
  const [cambiandoTelefono, setCambiandoTelefono] = useState(false);

  // Correo
  const [paso, setPaso] = useState<'cerrado' | 'correo' | 'codigo'>('cerrado');
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const pedirCodigoDeCorreo = async () => {
    setOcupado(true); setError(''); setAviso('');
    try {
      const { data, error: solicitudError } = await invokeWithStepUp('request-email-change', { new_email: nuevoCorreo.trim() });
      if (solicitudError) {
        // 403 REAUTH_REQUIRED cancelado en el modal o rechazado: el modal ya habló.
        const codigoError = typeof data?.code === 'string' ? data.code : '';
        if (codigoError === 'REAUTH_REQUIRED') { setError('Necesitamos confirmar tu identidad para cambiar el correo.'); return; }
        setError(MENSAJES_CORREO[codigoError] ?? 'No se pudo enviar el código. Intenta de nuevo.');
        return;
      }
      setCodigo('');
      setPaso('codigo');
    } finally {
      setOcupado(false);
    }
  };

  const confirmarCorreo = async () => {
    setOcupado(true); setError('');
    try {
      const { data, error: confirmacionError } = await invokeWithStepUp('confirm-email-change', { code: codigo });
      if (confirmacionError) {
        const codigoError = typeof data?.code === 'string' ? data.code : '';
        setError(MENSAJES_CORREO[codigoError] ?? 'No se pudo confirmar el correo. Intenta de nuevo.');
        return;
      }
      // El JWT conserva el correo viejo hasta renovarlo.
      await supabase.auth.refreshSession();
      await cargar();
      setPaso('cerrado'); setNuevoCorreo(''); setCodigo('');
      setAviso('Listo: tu correo se actualizó. Cerramos las demás sesiones abiertas y avisamos al correo anterior.');
    } finally {
      setOcupado(false);
    }
  };

  const inputClass = 'block w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm';

  return (
    <div className="bg-white rounded-lg shadow-xs border border-gray-200 p-6" id="acceso-cuenta">
      <div className="flex items-center mb-4">
        <Smartphone className="h-6 w-6 text-gray-700 mr-3" />
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Acceso a tu cuenta</h3>
          <p className="text-sm text-gray-600">Correo y celular con los que entras. Para cambiarlos te pediremos confirmar tu identidad y verificar el dato nuevo.</p>
        </div>
      </div>

      {cargaFallida && <p role="alert" className="text-sm text-red-600 mb-3">No se pudieron cargar tus datos de acceso. <button type="button" className="underline" onClick={() => void cargar()}>Reintentar</button></p>}
      {aviso && <p role="status" className="flex items-start gap-2 text-sm text-green-700 mb-3"><CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />{aviso}</p>}

      {/* Teléfono */}
      <div className="py-3 border-t border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">Celular</div>
            <div className="text-sm text-gray-600 break-all">
              {acceso?.phone_number || 'No registrado'}{' '}
              {acceso?.phone_number && (verificado
                ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle className="h-3.5 w-3.5" />verificado</span>
                : <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle className="h-3.5 w-3.5" />sin verificar</span>)}
            </div>
          </div>
          {!cambiandoTelefono && (
            <button type="button" onClick={() => { setAviso(''); setCambiandoTelefono(true); }} className="text-sm text-primary-600 underline whitespace-nowrap">
              {acceso?.phone_number ? (verificado ? 'Cambiar celular' : 'Verificar o cambiar') : 'Agregar celular'}
            </button>
          )}
        </div>
        {cambiandoTelefono && (
          <div className="mt-4 space-y-3">
            {verificado && <p className="text-xs text-gray-600">Tu celular actual sigue siendo el vigente hasta que verifiques el nuevo con un código.</p>}
            <PhoneOtpVerify
              key={acceso?.phone_number ?? 'sin-telefono'}
              initialPhone=""
              onVerified={() => { setCambiandoTelefono(false); setAviso('Listo: tu celular quedó verificado.'); void cargar(); }}
            />
            <button type="button" onClick={() => setCambiandoTelefono(false)} className="text-sm text-gray-600 underline">Cancelar</button>
          </div>
        )}
      </div>

      {/* Correo */}
      <div className="py-3 border-t border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-start gap-2">
            <Mail className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-gray-900">Correo</div>
              <div className="text-sm text-gray-600 break-all">{acceso?.email || user?.email || '—'}</div>
            </div>
          </div>
          {paso === 'cerrado' && (
            <button type="button" onClick={() => { setAviso(''); setError(''); setPaso('correo'); }} className="text-sm text-primary-600 underline whitespace-nowrap">Cambiar correo</button>
          )}
        </div>

        {paso === 'correo' && (
          <div className="mt-4 space-y-3">
            <label htmlFor="nuevo-correo" className="block text-sm text-gray-700">Correo nuevo</label>
            <input id="nuevo-correo" type="email" autoComplete="email" value={nuevoCorreo} onChange={e => setNuevoCorreo(e.target.value)} maxLength={254} disabled={ocupado} className={inputClass} />
            <p className="text-xs text-gray-600">Te enviaremos un código a ese correo. Tu correo actual sigue valiendo hasta que lo confirmes.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => void pedirCodigoDeCorreo()} disabled={ocupado || !nuevoCorreo.trim()} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Enviar código</button>
              <button type="button" onClick={() => { setPaso('cerrado'); setError(''); }} disabled={ocupado} className="text-sm text-gray-600 underline">Cancelar</button>
            </div>
          </div>
        )}

        {paso === 'codigo' && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-gray-700">Si el correo se puede usar, te mandamos un código a <strong>{nuevoCorreo.trim()}</strong>. Vence en 15 minutos.</p>
            <input
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (codigo.length === 6 && !ocupado) void confirmarCorreo(); } }}
              placeholder="Código de 6 dígitos" aria-label="Código enviado al correo nuevo" disabled={ocupado}
              className={`${inputClass} tracking-widest`}
            />
            <div className="flex gap-3">
              <button type="button" onClick={() => void confirmarCorreo()} disabled={ocupado || codigo.length !== 6} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Confirmar correo</button>
              <button type="button" onClick={() => { setPaso('correo'); setError(''); }} disabled={ocupado} className="text-sm text-gray-600 underline">Usar otro correo</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
};

export default AccountAccessSection;
