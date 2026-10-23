// Lógica de la pantalla «Bitácora de mensajes» del admin (src/pages/admin/AdminBitacoraMensajes.tsx): SMS y WhatsApp salientes.
//
// Las tablas las llena el motor de envío (`enviarPersistido`: un intento por fila, con su texto —el código de un OTP va
// TACHADO—, el destino y el usuario) y los webhooks de Twilio y LabsMobile (la línea de tiempo: aceptado, enviado, entregado,
// leído, fallido). Aquí viven las etiquetas, el estado que se muestra y la traducción de los filtros a la consulta, para
// poder probarlos sin la pantalla. El listado, el costo estimado y los totales los calcula la base.

export type CanalMensaje = 'sms' | 'whatsapp';

export const ETIQUETAS_CANAL: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp' };
export const ETIQUETAS_PROVEEDOR: Record<string, string> = { twilio: 'Twilio', labsmobile: 'LabsMobile', mock: 'Prueba' };
export const ETIQUETAS_CATEGORIA: Record<string, string> = {
  otp: 'Código de verificación',
  reserva_confirmada: 'Reserva confirmada (viajero)',
  recordatorio_tour: 'Recordatorio de tour',
  agencia_reserva: 'Nueva reserva (agencia)',
  agencia_cancelacion: 'Cancelación (agencia)',
  reserva_cancelada: 'Reserva cancelada (viajero)',
  agencia_mensaje: 'Mensaje nuevo (agencia)',
};

export const etiquetaCanal = (c: string): string => ETIQUETAS_CANAL[c] ?? c;
export const etiquetaProveedor = (p: string): string => ETIQUETAS_PROVEEDOR[p] ?? p;
export const etiquetaCategoria = (c: string): string => ETIQUETAS_CATEGORIA[c] ?? c;

export interface EstadoMensaje {
  clave: string;
  texto: string;
  /** Color de la insignia: verde, azul, amarillo, rojo o gris. */
  tono: 'verde' | 'azul' | 'amarillo' | 'rojo' | 'gris';
}

/**
 * Lo que se le muestra al admin de un mensaje. `leido` solo existe en WhatsApp (y solo si el destinatario tiene los acuses
 * activos): un SMS no tiene lectura posible, las operadoras no la reportan. «Aceptado» y «enviado» NO son «entregado».
 */
export function estadoDeMensaje(estado: string): EstadoMensaje {
  switch (estado) {
    case 'leido': return { clave: 'leido', texto: 'Leído', tono: 'azul' };
    case 'entregado': return { clave: 'entregado', texto: 'Entregado', tono: 'verde' };
    case 'enviado': return { clave: 'enviado', texto: 'Enviado al operador', tono: 'gris' };
    case 'aceptado': return { clave: 'aceptado', texto: 'Aceptado por el proveedor', tono: 'gris' };
    case 'procesando': return { clave: 'procesando', texto: 'Procesando', tono: 'gris' };
    case 'fallido': return { clave: 'fallido', texto: 'Fallido', tono: 'rojo' };
    case 'resultado_desconocido': return { clave: 'resultado_desconocido', texto: 'Resultado desconocido', tono: 'amarillo' };
    case 'simulado': return { clave: 'simulado', texto: 'Simulado (modo de prueba)', tono: 'gris' };
    default: return { clave: estado, texto: estado, tono: 'gris' };
  }
}

export const ETIQUETAS_EVENTO: Record<string, string> = {
  aceptado: 'Aceptado por el proveedor',
  enviado: 'Enviado al operador',
  entregado: 'Entregado al teléfono',
  leido: 'Leído por el destinatario',
  fallido: 'Fallido',
  resultado_desconocido: 'Resultado desconocido',
  simulado: 'Simulado',
};
export const etiquetaEvento = (t: string): string => ETIQUETAS_EVENTO[t] ?? t;

/** Los estados por los que se puede filtrar, en el orden en que avanza un mensaje. */
export const ESTADOS_FILTRABLES = ['aceptado', 'enviado', 'entregado', 'leido', 'fallido', 'resultado_desconocido', 'procesando'] as const;

export interface MensajeSaliente {
  intento_id: string;
  creado_en: string;
  canal: string;
  proveedor: string;
  categoria: string;
  estado: string;
  es_respaldo: boolean;
  numero_intento: number;
  simulado: boolean;
  usuario_id: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  telefono: string | null;
  texto: string | null;
  segmentos: number;
  costo_real: number | null;
  moneda_costo: string | null;
  costo_estimado_mxn: number | null;
  codigo_error: string | null;
  clase_fallo: string | null;
  id_proveedor: string | null;
  correlacion: string | null;
  eventos: { tipo: string; codigo: string | null; cuando: string }[];
  total: number;
}

export interface FiltrosMensajes {
  desde: string; // yyyy-mm-dd
  hasta: string; // yyyy-mm-dd
  canal: '' | CanalMensaje;
  proveedor: string;
  estado: string;
  categoria: string;
  busqueda: string;
}

export const FILTROS_VACIOS: FiltrosMensajes = { desde: '', hasta: '', canal: '', proveedor: '', estado: '', categoria: '', busqueda: '' };

export const contarFiltrosActivos = (f: FiltrosMensajes): number =>
  [f.desde, f.hasta, f.canal, f.proveedor, f.estado, f.categoria, f.busqueda.trim()].filter(Boolean).length;

// México no tiene horario de verano desde 2022: la hora de Ciudad de México es UTC-6 todo el año.
/** Medianoche de `yyyy-mm-dd` en hora de Ciudad de México, en ISO (lo que compara la base). */
export const inicioDelDiaMx = (fecha: string): string => new Date(`${fecha}T00:00:00-06:00`).toISOString();
/** El último instante de ese día en hora de Ciudad de México. */
export const finDelDiaMx = (fecha: string): string => new Date(`${fecha}T23:59:59.999-06:00`).toISOString();

export const TAMANO_PAGINA = 25;

/** Los parámetros de `listar_mensajes_salientes`: lo vacío viaja como null para que la base no filtre por eso. */
export function parametrosDelListado(f: FiltrosMensajes, pagina: number): Record<string, unknown> {
  const busqueda = f.busqueda.trim();
  return {
    p_desde: f.desde ? inicioDelDiaMx(f.desde) : null,
    p_hasta: f.hasta ? finDelDiaMx(f.hasta) : null,
    p_canal: f.canal || null,
    p_proveedor: f.proveedor || null,
    p_estado: f.estado || null,
    p_categoria: f.categoria || null,
    p_busqueda: busqueda || null,
    p_limite: TAMANO_PAGINA,
    p_desplazamiento: Math.max(0, pagina) * TAMANO_PAGINA,
  };
}

export interface FilaResumen {
  canal: string;
  proveedor: string;
  estado: string;
  total: number;
  segmentos: number;
}

export interface TotalesMensajes {
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  sinConfirmar: number;
}

/**
 * Las tarjetas. «Entregados» incluye los leídos (un mensaje leído también se entregó). «Sin confirmar» son los que el
 * proveedor aceptó o envió al operador pero de los que aún no llega la entrega, o cuyo resultado se desconoce.
 */
export function totalesDelResumen(filas: FilaResumen[]): TotalesMensajes {
  const t: TotalesMensajes = { enviados: 0, entregados: 0, leidos: 0, fallidos: 0, sinConfirmar: 0 };
  for (const f of filas) {
    const n = Number(f.total);
    t.enviados += n;
    if (f.estado === 'entregado' || f.estado === 'leido') t.entregados += n;
    if (f.estado === 'leido') t.leidos += n;
    if (f.estado === 'fallido') t.fallidos += n;
    if (['aceptado', 'enviado', 'procesando', 'resultado_desconocido'].includes(f.estado)) t.sinConfirmar += n;
  }
  return t;
}

/** El texto en la tabla, recortado; la fila abierta lo muestra entero. Los intentos anteriores al 23-oct-2026 no lo guardaron. */
export function textoCorto(texto: string | null, max = 70): string {
  if (!texto) return 'No guardado (anterior al 23-oct-2026)';
  return texto.length > max ? `${texto.slice(0, max).trimEnd()}…` : texto;
}

/** Quién recibió el mensaje: el nombre, si no el correo, si no «sin usuario» (un OTP de login anónimo o ya purgado). */
export function nombreDelDestinatario(m: Pick<MensajeSaliente, 'usuario_nombre' | 'usuario_email'>): string {
  return m.usuario_nombre?.trim() || m.usuario_email?.trim() || 'Sin usuario asociado';
}

/** `12.3456 USD` — lo que informó el proveedor; vacío mientras no lo informe. */
export function costoRealTexto(m: Pick<MensajeSaliente, 'costo_real' | 'moneda_costo'>): string {
  if (m.costo_real === null || m.costo_real === undefined) return '—';
  return `${Number(m.costo_real).toFixed(4)} ${m.moneda_costo ?? ''}`.trim();
}

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** El estimado con la tarifa configurada; vacío si no hay tarifa activa, y $0.00 mientras esté dentro de lo incluido. */
export function costoEstimadoTexto(m: Pick<MensajeSaliente, 'costo_estimado_mxn'>): string {
  if (m.costo_estimado_mxn === null || m.costo_estimado_mxn === undefined) return '—';
  return MXN.format(Number(m.costo_estimado_mxn));
}
