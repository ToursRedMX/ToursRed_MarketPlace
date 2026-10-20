// Lógica de la pantalla «Bitácora de correo» del admin (src/pages/admin/AdminBitacoraCorreo.tsx).
//
// Las tablas `bitacora_envio_correo` (un intento de envío por fila) y `bitacora_evento_correo` (lo que el proveedor
// avisa después) las llena `enviarCorreo` y `zoho-email-webhook`. Aquí viven las etiquetas, el estado de entrega que
// se muestra y la traducción de los filtros a la consulta, para poder probarlos sin la pantalla.

export type ProveedorBitacora = 'smtp2go' | 'sendgrid' | 'zoho';

export const ETIQUETAS_PROVEEDOR: Record<ProveedorBitacora, string> = {
  smtp2go: 'SMTP2GO',
  sendgrid: 'SendGrid',
  zoho: 'Zoho Mail',
};

export const ETIQUETAS_CLASE: Record<string, string> = {
  rechazo_confirmado: 'El proveedor lo rechazó',
  no_disponible: 'Proveedor no disponible (5xx/429)',
  no_configurado: 'Falta la llave del proveedor',
  incierto: 'Sin respuesta (pudo salir)',
};

export const etiquetaProveedor = (p: string): string => (ETIQUETAS_PROVEEDOR as Record<string, string>)[p] ?? p;
export const etiquetaClase = (c: string | null | undefined): string => (c ? ETIQUETAS_CLASE[c] ?? c : '');

export type ClaveEntrega = 'no_aceptado' | 'rebote_duro' | 'rebote_suave' | 'spam' | 'abierto' | 'entregado' | 'aceptado';

export interface EstadoEntrega {
  clave: ClaveEntrega;
  texto: string;
  /** Color de la insignia: verde, azul, amarillo, rojo o gris. */
  tono: 'verde' | 'azul' | 'amarillo' | 'rojo' | 'gris';
}

/**
 * Lo que se le muestra al admin de un envío: lo peor que se sepa manda. Un rebote duro o un spam pesan más que un
 * «entregado» anterior; abierto implica entregado; sin eventos solo se sabe que el proveedor lo aceptó (eso NO es
 * lo mismo que entregado: SendGrid y SMTP2GO todavía no mandan eventos).
 */
export function estadoDeEntrega(aceptado: boolean, tiposDeEvento: string[]): EstadoEntrega {
  if (!aceptado) return { clave: 'no_aceptado', texto: 'No aceptado', tono: 'rojo' };
  const tipos = new Set(tiposDeEvento);
  if (tipos.has('hardbounce')) return { clave: 'rebote_duro', texto: 'Rebotó (permanente)', tono: 'rojo' };
  if (tipos.has('feedback_loop') || tipos.has('spam') || tipos.has('feedback')) return { clave: 'spam', texto: 'Marcado como spam', tono: 'rojo' };
  if (tipos.has('softbounce')) return { clave: 'rebote_suave', texto: 'Rebote temporal', tono: 'amarillo' };
  if (tipos.has('email_open') || tipos.has('email_link_click')) return { clave: 'abierto', texto: 'Abierto', tono: 'azul' };
  if (tipos.has('delivered')) return { clave: 'entregado', texto: 'Entregado', tono: 'verde' };
  return { clave: 'aceptado', texto: 'Aceptado por el proveedor', tono: 'gris' };
}

export const ETIQUETAS_EVENTO: Record<string, string> = {
  delivered: 'Entregado',
  email_open: 'Abierto',
  email_link_click: 'Clic en un enlace',
  softbounce: 'Rebote temporal',
  hardbounce: 'Rebote permanente',
  feedback_loop: 'Marcado como spam',
  desconocido: 'Evento sin reconocer',
};
export const etiquetaEvento = (t: string): string => ETIQUETAS_EVENTO[t] ?? t;

export interface FiltrosBitacora {
  destinatario: string;
  asunto: string;
  proveedor: '' | ProveedorBitacora;
  estado: '' | 'aceptado' | 'rechazado';
  soloRespaldo: boolean;
  desde: string; // yyyy-mm-dd
  hasta: string; // yyyy-mm-dd
}

export const FILTROS_VACIOS: FiltrosBitacora = {
  destinatario: '', asunto: '', proveedor: '', estado: '', soloRespaldo: false, desde: '', hasta: '',
};

/** Escapa los comodines de LIKE para que «100%» o «a_b» se busquen como texto. */
export const escaparLike = (t: string): string => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Medianoche local de `yyyy-mm-dd` (o el último instante de ese día) en ISO, que es lo que compara PostgREST. */
export const inicioDelDia = (fecha: string): string => new Date(`${fecha}T00:00:00`).toISOString();
export const finDelDia = (fecha: string): string => new Date(`${fecha}T23:59:59.999`).toISOString();

/** Lo único que se usa del constructor de consultas de supabase-js. */
export interface Consulta {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [metodo: string]: any;
}

/**
 * Aplica los filtros a una consulta sobre `bitacora_envio_correo`. El destinatario es una coincidencia EXACTA de
 * correo (la columna es un arreglo); el asunto, una búsqueda parcial sin distinguir mayúsculas.
 */
export function aplicarFiltros<T extends Consulta>(consulta: T, f: FiltrosBitacora): T {
  let q: Consulta = consulta;
  const correo = f.destinatario.trim().toLowerCase();
  if (correo) q = q.contains('destinatarios', [correo]);
  const asunto = f.asunto.trim();
  if (asunto) q = q.ilike('asunto', `%${escaparLike(asunto)}%`);
  if (f.proveedor) q = q.eq('proveedor', f.proveedor);
  if (f.estado === 'aceptado') q = q.eq('aceptado', true);
  if (f.estado === 'rechazado') q = q.eq('aceptado', false);
  if (f.soloRespaldo) q = q.eq('es_respaldo', true);
  if (f.desde) q = q.gte('creado_en', inicioDelDia(f.desde));
  if (f.hasta) q = q.lte('creado_en', finDelDia(f.hasta));
  return q as T;
}

export const contarFiltrosActivos = (f: FiltrosBitacora): number =>
  [f.destinatario.trim(), f.asunto.trim(), f.proveedor, f.estado, f.soloRespaldo, f.desde, f.hasta].filter(Boolean).length;
