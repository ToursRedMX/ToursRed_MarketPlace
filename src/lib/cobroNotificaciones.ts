import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

// Cobro por suscripcion de las notificaciones (SMS de reserva y avisos). El OTP nunca entra: es gratis siempre.
// La decision de quien esta cubierto la toma el servidor (messaging_private.cobertura_notificaciones); aqui solo se pinta.

export type TipoSuscripcionNotificaciones = 'viajero' | 'agencia';
export type Cobertura = 'gratis' | 'plus' | 'suscripcion' | 'gracia' | null;

export interface EstadoCobroNotificaciones {
  /** El cobro esta encendido Y ya llego su fecha de inicio. */
  vigente: boolean;
  /** El interruptor esta encendido (aunque la fecha de inicio aun no llegue). */
  activo: boolean;
  desde: string | null;
  /** null = sin cobertura (con el cobro vigente). */
  cobertura: Cobertura;
  tiene_plus: boolean;
  /** Solo el dueno de la agencia (o el viajero mismo) contrata y administra. */
  es_dueno: boolean;
  precio_listo: boolean;
  suscripcion: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    en_gracia_hasta: string | null;
    price_paid: number | null;
  } | null;
}

export function queryKeyCobro(tipo: TipoSuscripcionNotificaciones, agencyId: string | null | undefined) {
  return ['cobro-notificaciones', tipo, agencyId ?? null] as const;
}

/** Estado del cobro para el viajero (agencyId vacio) o para una agencia. */
export function useCobroNotificaciones(tipo: TipoSuscripcionNotificaciones, agencyId?: string | null) {
  const esperarAgencia = tipo === 'agencia' && !agencyId;
  return useQuery({
    queryKey: queryKeyCobro(tipo, agencyId),
    enabled: !esperarAgencia,
    queryFn: async (): Promise<EstadoCobroNotificaciones> => {
      const { data, error } = await supabase.rpc('mi_cobertura_notificaciones', { p_agency: tipo === 'agencia' ? agencyId : null });
      if (error) throw error;
      return data as EstadoCobroNotificaciones;
    },
  });
}

/** Llama a una Edge Function de suscripcion y devuelve el mensaje real del servidor, no el generico del cliente. */
export async function invocarSuscripcion<T>(funcion: 'create-notification-subscription' | 'manage-notification-subscription' | 'send-aviso-cobro-notificaciones', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcion, { body });
  if (error) {
    let mensaje = 'No se pudo completar la solicitud. Intenta de nuevo.';
    if (error.context instanceof Response) {
      try { mensaje = (await error.context.json()).error ?? mensaje; } catch { /* mensaje generico */ }
    }
    throw new Error(mensaje);
  }
  return data as T;
}

/** Texto de fecha largo y en espanol de Mexico. */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
}

export function dinero(monto: number | null | undefined, moneda = 'MXN'): string {
  if (typeof monto !== 'number') return '';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda }).format(monto);
}
