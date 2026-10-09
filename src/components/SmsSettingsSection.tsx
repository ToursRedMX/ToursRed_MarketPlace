import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MessageSquareText, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { mensajeDeError } from '../lib/errores';

type Provider = 'labsmobile' | 'twilio' | 'mock';
interface SmsSettings {
  whatsapp_habilitado: boolean;
  whatsapp_proveedor_otp: Provider;
  whatsapp_proveedor_respaldo: Provider | null;
  whatsapp_fallback_habilitado: boolean;
  phone_verification_required: boolean;
  phone_verification_travelers_required: boolean;
  phone_verification_agencies_required: boolean;
  sms_habilitado: boolean;
  sms_modo_prueba: boolean;
  sms_proveedor_otp: Provider;
  sms_proveedor_transaccional: Provider;
  sms_proveedor_recordatorios: Provider;
  sms_proveedor_respaldo: Provider | null;
  sms_fallback_habilitado: boolean;
  sms_paises_permitidos: string[];
  sms_hora_recordatorio_local: number;
  sms_limite_diario: number;
  sms_limite_mensual: number;
  sms_otp_limite_usuario_diario: number;
  sms_otp_limite_telefono_diario: number;
  sms_otp_limite_ip_hora: number;
  sms_umbral_saldo_creditos: number;
  sms_config_version: number;
}
interface Configuration {
  settings: SmsSettings;
  runtime: { processor_ready: boolean; otp_enforcement_ready: boolean };
  providers: { provider: Provider; available: boolean }[];
  whatsapp_providers: { provider: Provider; available: boolean }[];
}
const queryKey = ['sms-settings'];
async function loadSettings(): Promise<Configuration> {
  const { data, error } = await supabase.rpc('get_sms_settings');
  if (error) throw error;
  if (!data?.settings || !data.runtime || !Array.isArray(data.providers)) throw new Error('Configuración SMS no disponible');
  return data as Configuration;
}

export function SmsSettingsSection() {
  const query = useQuery({ queryKey, queryFn: loadSettings, retry: false });
  // Dynamic configuration is refreshed on focus by React Query. A versioned
  // draft is never silently overwritten while the admin is editing it.
  if (query.isPending) return <div className="bg-white rounded-lg shadow-md p-6"><p role="status" className="text-sm text-gray-500">Cargando configuración SMS…</p></div>;
  if (query.isError || !query.data) return (
    <section className="bg-white rounded-lg shadow-md p-6" aria-label="SMS y verificación telefónica">
      <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p role="alert">No se pudo leer la configuración SMS. La migración puede estar pendiente o tu sesión necesita permisos/MFA.</p>
      </div>
      <button type="button" onClick={() => void query.refetch()} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700">Reintentar</button>
    </section>
  );
  return <SmsSettingsEditor initial={query.data} />;
}

function SmsSettingsEditor({ initial }: { initial: Configuration }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial.settings);
  const [countries, setCountries] = useState(initial.settings.sms_paises_permitidos.join(', '));
  const [message, setMessage] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const { sms_config_version, ...patch } = draft;
      const { data, error } = await supabase.rpc('update_sms_settings', {
        p_patch: { ...patch, sms_paises_permitidos: countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean) },
        p_expected_version: sms_config_version,
      });
      if (error) throw error;
      return data as Configuration;
    },
    onSuccess: data => {
      client.setQueryData(queryKey, data);
      void client.invalidateQueries({ queryKey: ['otp-channels'] });
      void client.invalidateQueries({ queryKey: ['phone-verification'] });
      void client.invalidateQueries({ queryKey: ['oauth-phone-policy'] });
      setDraft(data.settings);
      setCountries(data.settings.sms_paises_permitidos.join(', '));
      setMessage('Configuración de mensajes guardada.');
    },
  });
  // Track remote changes without discarding an unsaved draft.
  const stale = initial.settings.sms_config_version !== draft.sms_config_version;
  useEffect(() => {
    const onFocus = () => { void client.invalidateQueries({ queryKey }); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [client]);
  const set = <K extends keyof SmsSettings>(key: K, value: SmsSettings[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setMessage('');
  };
  type ToggleKey = keyof Pick<SmsSettings, 'phone_verification_required' | 'phone_verification_travelers_required' | 'phone_verification_agencies_required' | 'sms_habilitado' | 'sms_modo_prueba' | 'sms_fallback_habilitado' | 'whatsapp_habilitado' | 'whatsapp_fallback_habilitado'>;
  const toggle = (key: ToggleKey, label: string, hint: string, blockedReason?: string) => {
    const blocked = Boolean(blockedReason);
    return (
      <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-b-0">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-gray-800">{label}</h4>
          <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
          {blockedReason && <p className="text-xs text-amber-700 mt-1">{blockedReason}</p>}
        </div>
        <label className={`relative inline-flex items-center flex-shrink-0 ${blocked || mutation.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
          <input type="checkbox" role="switch" aria-label={label} className="sr-only peer" checked={draft[key]}
            disabled={blocked || mutation.isPending} onChange={e => set(key, e.target.checked)} />
          <div className="w-10 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
        </label>
      </div>
    );
  };
  const inputClass = 'mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
  const provider = (key: 'sms_proveedor_otp' | 'sms_proveedor_transaccional' | 'sms_proveedor_recordatorios' | 'sms_proveedor_respaldo' | 'whatsapp_proveedor_otp' | 'whatsapp_proveedor_respaldo', label: string) => (
    <label className="block text-sm font-medium text-gray-700">{label}
      <select className={inputClass} value={draft[key] ?? ''} disabled={mutation.isPending}
        onChange={e => set(key, (e.target.value || null) as Provider | null)}>
        {key.endsWith('respaldo') && <option value="">Sin respaldo</option>}
        {(key.startsWith('whatsapp') ? initial.whatsapp_providers ?? [] : initial.providers).map(p => {
          const available = p.available;
          return <option key={p.provider} value={p.provider} disabled={!available}>{p.provider}{available ? '' : ' — pendiente de habilitación'}</option>;
        })}
      </select>
    </label>
  );
  const number = (key: keyof Pick<SmsSettings, 'sms_hora_recordatorio_local' | 'sms_limite_diario' | 'sms_limite_mensual' | 'sms_otp_limite_usuario_diario' | 'sms_otp_limite_telefono_diario' | 'sms_otp_limite_ip_hora' | 'sms_umbral_saldo_creditos'>, label: string, min: number, max: number) => (
    <label className="block text-sm font-medium text-gray-700">{label}
      <input className={inputClass} type="number" min={min} max={max} step={key === 'sms_umbral_saldo_creditos' ? '0.01' : '1'}
        value={draft[key]} disabled={mutation.isPending} onChange={e => set(key, Number(e.target.value))} />
    </label>
  );
  const badge = (ok: boolean, label: string) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{label}
    </span>
  );
  const otpBlocked = !initial.runtime.otp_enforcement_ready && !draft.phone_verification_required
    ? 'Bloqueado: el motor OTP todavía no está certificado en el servidor.' : undefined;
  const smsBlocked = !initial.runtime.processor_ready && !draft.sms_habilitado
    ? 'Bloqueado: el procesador SMS todavía no está certificado en el servidor.' : undefined;
  return (
    <section className="bg-white rounded-lg shadow-md p-6" aria-labelledby="sms-title">
      <div className="flex items-center gap-x-3 mb-2">
        <MessageSquareText className="w-6 h-6 text-primary-600" />
        <h2 id="sms-title" className="text-xl font-semibold text-gray-900">SMS, WhatsApp y verificación telefónica</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">La obligatoriedad se aplica a todos los viajeros y usuarios que operan una agencia, según los controles de cada rol. No hay porcentajes ni excepciones individuales. Los controles MFA actuales se conservan.</p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {badge(initial.runtime.processor_ready, 'Procesador SMS certificado')}
        {badge(initial.runtime.otp_enforcement_ready, 'Motor OTP certificado')}
      </div>
      {(!initial.runtime.processor_ready || !initial.runtime.otp_enforcement_ready) && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-5">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">La certificación la marca el servidor al desplegar (no se cambia desde este panel). Mientras falte, no se puede encender el servicio SMS ni exigir la verificación.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        {toggle('phone_verification_required', 'Exigir verificación telefónica', 'Quien no haya verificado su celular no podrá operar. Requiere SMS o WhatsApp real, sin modo simulación.', otpBlocked)}
        {toggle('phone_verification_travelers_required', 'Aplicar a todos los viajeros', 'La exigencia cubre a cada viajero.')}
        {toggle('phone_verification_agencies_required', 'Aplicar a todos los usuarios de agencias', 'La exigencia cubre al dueño y al personal de la agencia.')}
        {toggle('sms_habilitado', 'Habilitar servicio SMS', 'Enciende el envío de SMS (códigos, confirmaciones y recordatorios).', smsBlocked)}
        {toggle('whatsapp_habilitado', 'Habilitar OTP por WhatsApp', 'Permite recibir el código por WhatsApp. Su proveedor y respaldo son independientes de SMS.', !initial.runtime.processor_ready ? 'El procesador aún no está certificado.' : undefined)}
        {toggle('sms_modo_prueba', 'Modo simulación', 'No envía mensajes reales ni acredita teléfonos. Aplica a SMS y WhatsApp.')}
        {toggle('sms_fallback_habilitado', 'Permitir respaldo solo ante rechazo confirmado', 'Reintenta con el proveedor de respaldo únicamente si el principal rechaza el mensaje.')}
      </div>
      <p className="text-xs text-gray-500 mb-5">Puedes apagar un canal y verificar por el otro. Para apagar ambos, desactiva también la obligatoriedad: se permitirá continuar con el número sin verificar.</p>

      <h3 className="text-sm font-semibold text-gray-800 mb-3">Proveedores</h3>
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        {provider('sms_proveedor_otp', 'Proveedor OTP por SMS')}
        {provider('sms_proveedor_transaccional', 'Proveedor de confirmaciones')}
        {provider('sms_proveedor_recordatorios', 'Proveedor de recordatorios')}
        {provider('sms_proveedor_respaldo', 'Proveedor de respaldo')}
      </div>

      <h3 className="text-sm font-semibold text-gray-800 mb-3">Proveedores de WhatsApp</h3>
      <div className="grid gap-4 sm:grid-cols-2 mb-3">
        {provider('whatsapp_proveedor_otp', 'Proveedor OTP por WhatsApp')}
        {provider('whatsapp_proveedor_respaldo', 'Respaldo de WhatsApp')}
      </div>
      {toggle('whatsapp_fallback_habilitado', 'Permitir respaldo de WhatsApp', 'Solo ante rechazo confirmado y dentro de WhatsApp.', !(initial.whatsapp_providers ?? []).some(p => p.available && p.provider !== draft.whatsapp_proveedor_otp) ? 'Disponible cuando se integre otro proveedor de WhatsApp.' : undefined)}
      <p className="text-xs text-gray-500 mt-2 mb-6">Actualmente solo Twilio tiene integración de WhatsApp. Requiere remitente y plantilla de autenticación aprobados, configurados en el servidor.</p>

      <h3 className="text-sm font-semibold text-gray-800 mb-3">Cobertura y límites</h3>
      <label className="block text-sm font-medium text-gray-700 mb-4">Países permitidos (códigos ISO separados por coma)
        <input className={inputClass} value={countries} disabled={mutation.isPending} onChange={e => { setCountries(e.target.value); setMessage(''); }} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {number('sms_hora_recordatorio_local', 'Hora local de recordatorios', 8, 20)}
        {number('sms_limite_diario', 'Máximo de unidades de envío por día', 1, 100000)}
        {number('sms_limite_mensual', 'Máximo de unidades de envío por mes', 1, 3000000)}
        {number('sms_otp_limite_usuario_diario', 'Solicitudes OTP por usuario/día', 1, 20)}
        {number('sms_otp_limite_telefono_diario', 'Solicitudes OTP por teléfono/día', 1, 20)}
        {number('sms_otp_limite_ip_hora', 'Solicitudes OTP por IP/hora', 1, 100)}
        {number('sms_umbral_saldo_creditos', 'Alerta de saldo (créditos del proveedor)', 0, 9999999999)}
      </div>
      <p className="mt-4 text-xs text-gray-500">Los límites se comparten entre canales: cada segmento SMS y cada OTP de WhatsApp consumen una unidad. Las credenciales se gestionan como secretos del servidor. Guardar estos ajustes no envía mensajes. Este bloque se guarda por separado del botón general de la página.</p>

      {stale && <p role="alert" className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">La configuración cambió en otra sesión. Recarga los valores antes de guardar.</p>}
      {mutation.isError && <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{mensajeDeError(mutation.error)}</p>}
      {message && <p role="status" className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">{message}</p>}
      <div className="mt-5 flex items-center gap-4">
        <button type="button" disabled={mutation.isPending || stale} onClick={() => mutation.mutate()} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed">{mutation.isPending ? 'Guardando…' : 'Guardar configuración de mensajes'}</button>
        <button type="button" disabled={mutation.isPending} onClick={async () => {
          try {
            const data = await client.fetchQuery({ queryKey, queryFn: loadSettings, staleTime: 0 });
            setDraft(data.settings); setCountries(data.settings.sms_paises_permitidos.join(', ')); setMessage('Valores recargados.'); mutation.reset();
          } catch (error) { setMessage(mensajeDeError(error)); }
        }} className="text-sm font-medium text-primary-600 hover:text-primary-700">Recargar valores</button>
      </div>
    </section>
  );
}
