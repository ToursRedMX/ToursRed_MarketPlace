import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mensajeDeError } from '../lib/errores';

type Provider = 'labsmobile' | 'twilio' | 'mock';
interface SmsSettings {
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
  if (query.isPending) return <p role="status">Cargando configuración SMS…</p>;
  if (query.isError || !query.data) return (
    <section className="rounded-lg border p-5" aria-label="SMS y verificación telefónica">
      <p role="alert">No se pudo leer la configuración SMS. La migración puede estar pendiente o tu sesión necesita permisos/MFA.</p>
      <button type="button" onClick={() => void query.refetch()} className="mt-2 text-primary-700 underline">Reintentar</button>
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
      setDraft(data.settings);
      setCountries(data.settings.sms_paises_permitidos.join(', '));
      setMessage('Configuración SMS guardada.');
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
  const toggle = (key: keyof Pick<SmsSettings, 'phone_verification_required' | 'phone_verification_travelers_required' | 'phone_verification_agencies_required' | 'sms_habilitado' | 'sms_modo_prueba' | 'sms_fallback_habilitado'>, label: string, disabled = false) => (
    <label className="flex items-center gap-3 py-2">
      <input type="checkbox" checked={draft[key]} disabled={disabled || mutation.isPending} onChange={e => set(key, e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const provider = (key: 'sms_proveedor_otp' | 'sms_proveedor_transaccional' | 'sms_proveedor_recordatorios' | 'sms_proveedor_respaldo', label: string) => (
    <label className="block text-sm">{label}
      <select className="mt-1 block w-full rounded border p-2" value={draft[key] ?? ''} disabled={mutation.isPending}
        onChange={e => set(key, (e.target.value || null) as Provider | null)}>
        {key === 'sms_proveedor_respaldo' && <option value="">Sin respaldo</option>}
        {initial.providers.map(p => {
          const available = p.available;
          return <option key={p.provider} value={p.provider} disabled={!available}>{p.provider}{available ? '' : ' — pendiente de habilitación'}</option>;
        })}
      </select>
    </label>
  );
  const number = (key: keyof Pick<SmsSettings, 'sms_hora_recordatorio_local' | 'sms_limite_diario' | 'sms_limite_mensual' | 'sms_otp_limite_usuario_diario' | 'sms_otp_limite_telefono_diario' | 'sms_otp_limite_ip_hora' | 'sms_umbral_saldo_creditos'>, label: string, min: number, max: number) => (
    <label className="block text-sm">{label}
      <input className="mt-1 block w-full rounded border p-2" type="number" min={min} max={max} step={key === 'sms_umbral_saldo_creditos' ? '0.01' : '1'}
        value={draft[key]} disabled={mutation.isPending} onChange={e => set(key, Number(e.target.value))} />
    </label>
  );
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="sms-title">
      <h3 id="sms-title" className="text-lg font-semibold">SMS y verificación telefónica</h3>
      <p className="mt-2 text-sm text-slate-600">La obligatoriedad se aplica a todos los viajeros y usuarios que operan una agencia, según los controles de cada rol. No hay porcentajes ni excepciones individuales. Los controles MFA actuales se conservan.</p>
      {!initial.runtime.otp_enforcement_ready && <p className="my-3 rounded bg-amber-50 p-3 text-sm">La activación estará disponible cuando el motor OTP y sus controles de acceso estén listos. Esta fase prepara la configuración.</p>}
      {toggle('phone_verification_required', 'Exigir verificación telefónica', !initial.runtime.otp_enforcement_ready && !draft.phone_verification_required)}
      {toggle('phone_verification_travelers_required', 'Aplicar a todos los viajeros')}
      {toggle('phone_verification_agencies_required', 'Aplicar a todos los usuarios de agencias')}
      {toggle('sms_habilitado', 'Habilitar servicio SMS', !initial.runtime.processor_ready && !draft.sms_habilitado)}
      {toggle('sms_modo_prueba', 'Modo simulación (no acredita teléfonos)')}
      <p className="my-3 text-sm text-slate-600">Para apagar SMS con una obligación activa, desactiva también la obligatoriedad antes de guardar. Los teléfonos ya verificados se conservan.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {provider('sms_proveedor_otp', 'Proveedor OTP')}
        {provider('sms_proveedor_transaccional', 'Proveedor de confirmaciones')}
        {provider('sms_proveedor_recordatorios', 'Proveedor de recordatorios')}
        {provider('sms_proveedor_respaldo', 'Proveedor de respaldo')}
      </div>
      {toggle('sms_fallback_habilitado', 'Permitir respaldo solo ante rechazo confirmado')}
      <label className="my-4 block text-sm">Países permitidos (códigos ISO separados por coma)
        <input className="mt-1 block w-full rounded border p-2" value={countries} disabled={mutation.isPending} onChange={e => { setCountries(e.target.value); setMessage(''); }} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {number('sms_hora_recordatorio_local', 'Hora local de recordatorios', 8, 20)}
        {number('sms_limite_diario', 'Máximo de segmentos SMS por día', 1, 100000)}
        {number('sms_limite_mensual', 'Máximo de segmentos SMS por mes', 1, 3000000)}
        {number('sms_otp_limite_usuario_diario', 'Solicitudes OTP por usuario/día', 1, 20)}
        {number('sms_otp_limite_telefono_diario', 'Solicitudes OTP por teléfono/día', 1, 20)}
        {number('sms_otp_limite_ip_hora', 'Solicitudes OTP por IP/hora', 1, 100)}
        {number('sms_umbral_saldo_creditos', 'Alerta de saldo (créditos del proveedor)', 0, 9999999999)}
      </div>
      <p className="my-4 text-sm text-slate-600">Las credenciales se gestionan como secretos del servidor. Guardar estos ajustes no envía SMS. Este bloque se guarda por separado.</p>
      {stale && <p role="alert">La configuración cambió en otra sesión. Recarga los valores antes de guardar.</p>}
      {mutation.isError && <p role="alert" className="my-2 text-red-700">{mensajeDeError(mutation.error)}</p>}
      {message && <p role="status" className="my-2 text-green-700">{message}</p>}
      <div className="flex gap-4">
        <button type="button" disabled={mutation.isPending || stale} onClick={() => mutation.mutate()} className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50">{mutation.isPending ? 'Guardando…' : 'Guardar configuración SMS'}</button>
        <button type="button" disabled={mutation.isPending} onClick={async () => {
          try {
            const data = await client.fetchQuery({ queryKey, queryFn: loadSettings, staleTime: 0 });
            setDraft(data.settings); setCountries(data.settings.sms_paises_permitidos.join(', ')); setMessage('Valores recargados.'); mutation.reset();
          } catch (error) { setMessage(mensajeDeError(error)); }
        }} className="text-primary-700 underline">Recargar valores</button>
      </div>
    </section>
  );
}
