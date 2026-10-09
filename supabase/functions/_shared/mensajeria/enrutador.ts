import type { CanalOtp, Categoria, Proveedor, ResultadoEnvio, RoutingSettings } from './tipos.ts';
// Extend this registry only when the new provider has a WhatsApp adapter.
const whatsappProviders = new Set<Proveedor>(['twilio']);
export function proveedorPrincipal(settings: RoutingSettings, categoria: Categoria): Proveedor {
  return categoria === 'otp' ? settings.sms_proveedor_otp : categoria === 'recordatorio_tour' ? settings.sms_proveedor_recordatorios : settings.sms_proveedor_transaccional;
}
export function permiteFallback(result: ResultadoEnvio): boolean {
  return result.estado === 'fallido' && result.clase === 'rechazo_confirmado';
}
export async function enrutar(settings: RoutingSettings, categoria: Categoria,
  intentar: (provider: Proveedor, reason: 'principal' | 'fallback_confirmado') => Promise<ResultadoEnvio>, canal: CanalOtp = 'sms'): Promise<ResultadoEnvio> {
  const whatsapp = canal === 'whatsapp';
  const primary = whatsapp ? settings.whatsapp_proveedor_otp : proveedorPrincipal(settings, categoria);
  const backup = whatsapp ? settings.whatsapp_proveedor_respaldo : settings.sms_proveedor_respaldo;
  const fallback = whatsapp ? settings.whatsapp_fallback_habilitado : settings.sms_fallback_habilitado;
  if (whatsapp && (categoria !== 'otp' || !settings.whatsapp_habilitado || !primary || !whatsappProviders.has(primary))) return { estado: 'fallido', clase: 'permanente', codigo: 'whatsapp_no_disponible' };
  if (!whatsapp && !settings.sms_habilitado) return { estado: 'fallido', clase: 'permanente', codigo: 'sms_deshabilitado' };
  if (!primary) return { estado: 'fallido', clase: 'permanente', codigo: 'proveedor_no_disponible' };
  const result = await intentar(primary, 'principal');
  if (fallback && backup && backup !== primary && (!whatsapp || whatsappProviders.has(backup)) && permiteFallback(result)) {
    return intentar(backup, 'fallback_confirmado');
  }
  return result;
}
