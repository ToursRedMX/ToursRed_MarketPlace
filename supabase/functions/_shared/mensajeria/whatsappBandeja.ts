// Logica pura de la bandeja de WhatsApp entrante. Sin red ni base de datos: lo
// que vive aqui se prueba con `scripts/test-whatsapp-bandeja.mjs`.
//
// Twilio responde `MM...` a los mensajes de WhatsApp (medido el 09-oct-2026 en el
// log de Twilio). `messageSidValid` de proveedores/twilio.ts ya acepta SM|MM desde
// el PR #376; esta bandeja conserva su propio validador y su propio clasificador
// de envio porque su contrato es distinto (estados `leido`, y un 429 o 5xx es
// ambiguo, no fallido) y asi no depende de los cambios del camino del OTP.

export const BUCKET_MEDIA = 'whatsapp-media';
export const MAX_BYTES_MEDIA = 16 * 1024 * 1024;
export const MAX_ADJUNTOS = 10;

// Debe coincidir con `allowed_mime_types` del bucket (migracion 20261012215514).
// SVG y HTML quedan fuera: el contenido lo manda cualquiera y se abre en el panel.
export const MIME_PERMITIDOS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/aac': 'aac', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/vcard': 'vcf',
};

export const sidValido = (sid: unknown): sid is string => typeof sid === 'string' && /^(SM|MM)[0-9a-fA-F]{32}$/.test(sid);

/** Espejo de `public.whatsapp_telefono_canonico`: quita `whatsapp:` y el "1" de los moviles +521 de Mexico. */
export function telefonoCanonico(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/^whatsapp:/, '');
  if (/^\+521[0-9]{10}$/.test(n)) return '+52' + n.slice(4);
  return /^\+[1-9][0-9]{7,14}$/.test(n) ? n : null;
}

/** `whatsapp:+52...` tal como lo manda Twilio -> `+52...`, sin normalizar. */
export function telefonoDeTwilio(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/^whatsapp:/, '');
  return /^\+[1-9][0-9]{7,14}$/.test(n) ? n : null;
}

export type EstadoSaliente = 'enviando' | 'enviado' | 'entregado' | 'leido' | 'fallido';
/** A diferencia de `estadoTwilio`, distingue `read` de `delivered`: la bandeja muestra el doble palomeo azul. */
export function estadoWhatsApp(status: unknown): EstadoSaliente | null {
  switch (status) {
    case 'accepted': case 'scheduled': case 'queued': case 'sending': return 'enviando';
    case 'sent': return 'enviado';
    case 'delivered': return 'entregado';
    case 'read': return 'leido';
    case 'failed': case 'undelivered': case 'canceled': return 'fallido';
    default: return null;
  }
}

/** Solo se descargan adjuntos desde la API de Twilio de NUESTRA cuenta: la URL viene en el cuerpo del POST. */
export function urlMediaValida(url: unknown, accountSid: string): url is string {
  if (typeof url !== 'string' || url.length > 600) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'api.twilio.com' && !u.username && !u.password
      && u.pathname.startsWith(`/2010-04-01/Accounts/${accountSid}/Messages/`) && u.pathname.includes('/Media/');
  } catch { return false; }
}

export const mimeBase = (valor: unknown): string => typeof valor === 'string' ? valor.split(';')[0].trim().toLowerCase() : '';

export interface EntranteParseado {
  sid: string;
  from: string;
  nombre: string | null;
  cuerpo: string;
  media: { sid: string | null; url: string; tipo: string }[];
}

/**
 * Valida y normaliza el POST de un mensaje entrante de Twilio.
 * Devuelve null si algo no cuadra (cuenta ajena, numero destino que no es el nuestro, SID raro).
 */
export function parsearEntrante(params: Record<string, string>, accountSid: string, whatsappFrom: string): EntranteParseado | null {
  if (params.AccountSid !== accountSid || !sidValido(params.MessageSid)) return null;
  if (!params.From?.startsWith('whatsapp:') || telefonoDeTwilio(params.From) === null || telefonoCanonico(params.From) === null) return null;
  if (params.To !== whatsappFrom) return null;

  let cuerpo = params.Body ?? '';
  // Respuesta a un boton de plantilla y mensajes de ubicacion llegan sin Body.
  if (!cuerpo && params.ButtonText) cuerpo = params.ButtonText;
  if (!cuerpo && params.Latitude && params.Longitude && /^-?\d+(\.\d+)?$/.test(params.Latitude) && /^-?\d+(\.\d+)?$/.test(params.Longitude)) {
    cuerpo = `Ubicación: ${params.Latitude}, ${params.Longitude}`;
  }

  const total = Math.min(Number.parseInt(params.NumMedia ?? '0', 10) || 0, MAX_ADJUNTOS);
  const media: EntranteParseado['media'] = [];
  for (let i = 0; i < total; i++) {
    const url = params[`MediaUrl${i}`];
    if (!urlMediaValida(url, accountSid)) continue;
    const sid = /\/Media\/(ME[0-9a-fA-F]{32})$/.exec(new URL(url).pathname)?.[1] ?? null;
    media.push({ sid, url, tipo: mimeBase(params[`MediaContentType${i}`]) || 'application/octet-stream' });
  }
  return { sid: params.MessageSid, from: params.From, nombre: params.ProfileName?.trim().slice(0, 120) || null, cuerpo: cuerpo.slice(0, 4096), media };
}

export type ResultadoEnvio =
  | { estado: 'enviando'; sid: string }
  | { estado: 'fallido'; codigo: string }
  | { estado: 'desconocido'; codigo: string };

/**
 * Clasifica la respuesta de Twilio a `Messages.json`. Solo un 2xx con un SID
 * valido es exito; un 4xx es rechazo definitivo; todo lo demas (5xx, cuerpo
 * ilegible, SID raro) es AMBIGUO: el mensaje pudo haber salido, asi que NO se
 * marca fallido ni se reintenta a ciegas.
 */
export function clasificarEnvio(status: number, body: unknown): ResultadoEnvio {
  const data = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (status >= 200 && status < 300 && sidValido(data.sid)) return { estado: 'enviando', sid: data.sid };
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    const code = Number(data.code);
    return { estado: 'fallido', codigo: Number.isInteger(code) && code > 0 ? `twilio_${code}` : `twilio_http_${status}` };
  }
  return { estado: 'desconocido', codigo: 'twilio_respuesta_ambigua' };
}
