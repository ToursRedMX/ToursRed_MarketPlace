import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { Categoria, Proveedor, ResultadoEnvio, RoutingSettings } from './tipos.ts';
import { enrutar } from './enrutador.ts';
import { labsmobile } from './proveedores/labsmobile.ts';
import { mock } from './proveedores/mock.ts';
import { twilio } from './proveedores/twilio.ts';
import { twilioConfig } from './twilioConfig.ts';
import { hmac, nuevaCorrelacion } from './seguridad.ts';
import { segmentosSms } from './plantillas.ts';
import { normalizarTelefonoSms } from './telefono.ts';

export interface RuntimeSms {
  settings: RoutingSettings & { sms_paises_permitidos: string[]; sms_hora_recordatorio_local: number; sms_umbral_saldo_creditos: number };
  platform_url: string;
  processor_ready: boolean;
  otp_ready: boolean;
}
export async function cargarRuntime(client: SupabaseClient): Promise<RuntimeSms> {
  const { data, error } = await client.rpc('get_sms_runtime');
  if (error || !data?.settings) throw new Error('configuracion_sms_no_disponible');
  return data as RuntimeSms;
}
export interface ReferenciaSms { outboxId?: string; verificationId?: string; lease?: string }
export async function enviarPersistido(client: SupabaseClient, runtime: RuntimeSms, reference: ReferenciaSms,
  category: Categoria, destination: string, text: string): Promise<ResultadoEnvio> {
  if (!runtime.processor_ready) return { estado: 'fallido', clase: 'permanente', codigo: 'motor_no_disponible' };
  let country: string;
  try { country = normalizarTelefonoSms(destination, 'MX', runtime.settings.sms_paises_permitidos).country; }
  catch { return { estado: 'fallido', clase: 'permanente', codigo: 'destino_no_permitido' }; }
  if (!runtime.settings.sms_modo_prueba && Deno.env.get('SMS_ALLOW_REAL_SENDS') !== 'true') return { estado: 'fallido', clase: 'permanente', codigo: 'envios_reales_no_autorizados' };
  const webhookSecret = Deno.env.get('SMS_WEBHOOK_SECRET') ?? '';
  if (webhookSecret.length < 32) return { estado: 'fallido', clase: 'permanente', codigo: 'webhook_no_configurado' };
  return enrutar(runtime.settings, category, async (provider: Proveedor, reason) => {
    const correlation = nuevaCorrelacion();
    const callback = new URL(provider === 'twilio' ? '/functions/v1/sms-webhook-twilio' : '/functions/v1/sms-webhook-labsmobile', Deno.env.get('SUPABASE_URL'));
    if (provider === 'twilio') callback.searchParams.set('correlation', correlation);
    else callback.searchParams.set('signature', await hmac(webhookSecret, 'labsmobile-callback:' + correlation));
    const { data: start, error: startError } = await client.rpc('begin_sms_attempt', {
      p_outbox: reference.outboxId ?? null, p_verification: reference.verificationId ?? null, p_lease: reference.lease ?? null,
      p_provider: provider, p_correlation: correlation, p_reason: reason, p_segments: segmentosSms(text).segments,
    });
    if (startError) return { estado: 'resultado_desconocido', codigo: 'persistencia_no_disponible' };
    if (!start?.allowed) return { estado: 'fallido', clase: 'permanente', codigo: String(start?.code ?? 'intento_no_autorizado') };
    // Config may have changed since runtime was read; DB snapshot wins.
    const simulated = start.simulation === true;
    const { error: countryError } = await client.rpc('record_sms_country', { p_outbox: reference.outboxId ?? null, p_attempt: start.attempt_id, p_country: country });
    if (countryError) {
      await client.rpc('finish_sms_attempt', { p_attempt: start.attempt_id, p_state: 'fallido', p_class: 'permanente', p_code: 'pais_no_registrado' });
      return { estado: 'fallido', clase: 'permanente', codigo: 'pais_no_registrado' };
    }
    if (!simulated && Deno.env.get('SMS_ALLOW_REAL_SENDS') !== 'true') {
      await client.rpc('finish_sms_attempt', { p_attempt: start.attempt_id, p_state: 'fallido', p_class: 'permanente', p_code: 'envios_reales_no_autorizados' });
      return { estado: 'fallido', clase: 'permanente', codigo: 'envios_reales_no_autorizados' };
    }
    const adapter = provider === 'mock' ? mock : provider === 'labsmobile'
      ? labsmobile(Deno.env.get('LABSMOBILE_USER') ?? '', Deno.env.get('LABSMOBILE_TOKEN') ?? '', Deno.env.get('LABSMOBILE_SENDER') ?? 'ToursRed') : provider === 'twilio' ? twilio(twilioConfig()) : null;
    const result: ResultadoEnvio = adapter ? await adapter.enviar({ destino: destination, texto: text, correlacion: correlation, categoria: category,
      simulacion: simulated, urlEstados: callback.toString() }) : { estado: 'fallido', clase: 'permanente', codigo: 'adaptador_no_implementado' };
    const { error } = await client.rpc('finish_sms_attempt', { p_attempt: start.attempt_id, p_state: result.estado,
      p_provider_id: 'idProveedor' in result ? result.idProveedor : null,
      p_class: 'clase' in result ? result.clase : null, p_code: 'codigo' in result ? result.codigo : null });
    // Never fallback when persisting a response failed: durable state is unknown.
    return error ? { estado: 'resultado_desconocido', codigo: 'persistencia_resultado_desconocido' } : result;
  });
}
