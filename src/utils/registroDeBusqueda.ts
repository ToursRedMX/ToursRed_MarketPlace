/**
 * Arma el evento que va a `public.search_events` cuando un viajero busca tours.
 *
 * POR QUE EXISTE
 *
 * Para poder decir, con datos propios, que destinos busca la gente y que busca
 * y NO encuentra (demanda sin resultados). Ver la migracion
 * `20261002155309_create_search_events.sql`.
 *
 * REGLAS
 *
 * 1. Se guarda lo que el usuario escribio, crudo. No se normaliza contra el
 *    catalogo: hoy hay 5 tours de prueba y eso sesgaria todo. La base ya
 *    calcula `query_normalized` (minusculas, sin acentos) por su cuenta.
 * 2. `results_count` es lo que la pantalla de resultados mostro. 0 = busqueda
 *    sin resultados. Aqui nunca se inventa: si no hay numero valido, no hay
 *    evento.
 * 3. Consentimiento: sin que el usuario haya elegido «todas» las cookies, el
 *    evento viaja SOLO con lo que buscaron (texto, filtros, resultados). Sin
 *    sesion, sin usuario, sin dispositivo, sin idioma, sin origen. Con
 *    consentimiento completo se agregan los identificadores para poder seguir
 *    un recorrido.
 * 4. Una busqueda sin texto (solo categoria, fechas o precio) no genera
 *    evento: `query_raw` es obligatorio y no hay nada que aprender del vacio.
 */

export interface FiltrosDeBusqueda {
  tourName?: string;
  destination?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  agency?: string;
  minPrice?: string;
  maxPrice?: string;
  petFriendly?: string;
  departurePoint?: string;
  tourType?: string;
  activityType?: string;
  lat?: string;
  lng?: string;
  locationName?: string;
}

export type CampoDeBusqueda = 'destination' | 'tourName';

export interface EventoDeBusqueda {
  surface: 'tours';
  query_raw: string;
  results_count: number;
  filters: Record<string, string | boolean>;
  session_id?: string;
  user_id?: string;
  device?: 'mobile' | 'tablet' | 'desktop';
  language?: string;
  source?: string;
}

export interface ContextoDeBusqueda {
  filtros: FiltrosDeBusqueda;
  totalResultados: number;
  /** `canUseAnalytics()`: true solo si el usuario eligio «todas» las cookies. */
  conAnalitica: boolean;
  sessionId?: string | null;
  userId?: string | null;
  anchoDePantalla?: number;
  idioma?: string | null;
  referrer?: string | null;
  hostActual?: string | null;
}

const LARGO_MAXIMO_DEL_TEXTO = 200;

/** El texto que el viajero escribio, y en cual campo. El destino pesa mas que el nombre. */
export function textoDeBusqueda(
  filtros: FiltrosDeBusqueda,
): { texto: string; campo: CampoDeBusqueda } | null {
  const destino = (filtros.destination ?? '').trim();
  if (destino) return { texto: destino.slice(0, LARGO_MAXIMO_DEL_TEXTO), campo: 'destination' };
  const nombre = (filtros.tourName ?? '').trim();
  if (nombre) return { texto: nombre.slice(0, LARGO_MAXIMO_DEL_TEXTO), campo: 'tourName' };
  return null;
}

/**
 * Los filtros que se guardan: solo los que traen valor. Las coordenadas de la
 * busqueda por cercania NO se guardan (solo que fue geografica).
 */
export function filtrosParaRegistro(
  filtros: FiltrosDeBusqueda,
  campo: CampoDeBusqueda,
): Record<string, string | boolean> {
  const salida: Record<string, string | boolean> = { campo };
  const copiables: (keyof FiltrosDeBusqueda)[] = [
    'tourName', 'destination', 'category', 'startDate', 'endDate', 'agency',
    'minPrice', 'maxPrice', 'petFriendly', 'departurePoint', 'tourType', 'activityType',
  ];
  for (const clave of copiables) {
    const valor = (filtros[clave] ?? '').toString().trim();
    if (valor) salida[clave] = valor.slice(0, 200);
  }
  if (filtros.lat && filtros.lng) salida.geo = true;
  return salida;
}

export function dispositivoDeAncho(ancho: number): 'mobile' | 'tablet' | 'desktop' {
  if (ancho < 768) return 'mobile';
  if (ancho < 1024) return 'tablet';
  return 'desktop';
}

/**
 * De donde llego el viajero. `document.referrer` no cambia con la navegacion
 * interna de la SPA: es el sitio por el que entro. Vacio o el mismo sitio = directo.
 */
export function fuenteDeReferrer(referrer: string | null | undefined, hostActual: string | null | undefined): string {
  const bruto = (referrer ?? '').trim();
  if (!bruto) return 'directo';
  try {
    const host = new URL(bruto).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return 'directo';
    if (hostActual && host === hostActual.toLowerCase().replace(/^www\./, '')) return 'directo';
    return host.slice(0, 100);
  } catch {
    return 'directo';
  }
}

/** El evento listo para insertar, o null si no hay nada valido que registrar. */
export function construirEventoDeBusqueda(ctx: ContextoDeBusqueda): EventoDeBusqueda | null {
  const texto = textoDeBusqueda(ctx.filtros);
  if (!texto) return null;
  if (!Number.isInteger(ctx.totalResultados) || ctx.totalResultados < 0) return null;

  const evento: EventoDeBusqueda = {
    surface: 'tours',
    query_raw: texto.texto,
    results_count: ctx.totalResultados,
    filters: filtrosParaRegistro(ctx.filtros, texto.campo),
  };

  if (!ctx.conAnalitica) return evento;

  if (ctx.sessionId) evento.session_id = ctx.sessionId.slice(0, 100);
  if (ctx.userId) evento.user_id = ctx.userId;
  if (typeof ctx.anchoDePantalla === 'number' && ctx.anchoDePantalla > 0) {
    evento.device = dispositivoDeAncho(ctx.anchoDePantalla);
  }
  if (ctx.idioma) evento.language = ctx.idioma.slice(0, 20);
  evento.source = fuenteDeReferrer(ctx.referrer, ctx.hostActual);
  return evento;
}
