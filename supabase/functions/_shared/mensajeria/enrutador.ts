import type { Categoria, Proveedor, ResultadoEnvio, RoutingSettings } from './tipos.ts';
export function proveedorPrincipal(settings: RoutingSettings, categoria: Categoria): Proveedor {
  return categoria === 'otp' ? settings.sms_proveedor_otp : categoria === 'recordatorio_tour' ? settings.sms_proveedor_recordatorios : settings.sms_proveedor_transaccional;
}
export function permiteFallback(result: ResultadoEnvio): boolean {
  return result.estado === 'fallido' && result.clase === 'rechazo_confirmado';
}
export async function enrutar(settings: RoutingSettings, categoria: Categoria,
  intentar: (provider: Proveedor, reason: 'principal' | 'fallback_confirmado') => Promise<ResultadoEnvio>): Promise<ResultadoEnvio> {
  if (!settings.sms_habilitado) return { estado: 'fallido', clase: 'permanente', codigo: 'sms_deshabilitado' };
  const primary = proveedorPrincipal(settings, categoria);
  const result = await intentar(primary, 'principal');
  if (settings.sms_fallback_habilitado && settings.sms_proveedor_respaldo && settings.sms_proveedor_respaldo !== primary && permiteFallback(result)) {
    return intentar(settings.sms_proveedor_respaldo, 'fallback_confirmado');
  }
  return result;
}
