// Lo comun a los receptores de webhook de correo (SendGrid y SMTP2GO; Zoho conserva su propio analizador).
//
// Cada evento que el proveedor avisa DESPUES de aceptar un correo se convierte en una fila de
// `bitacora_evento_correo`. Para que la pantalla «Bitacora de correo» (src/lib/bitacoraCorreo.ts) los trate
// igual que los de Zoho, los tipos se NORMALIZAN al vocabulario que esa pantalla ya entiende:
//
//   delivered · email_open · email_link_click · hardbounce · softbounce · feedback_loop (spam)
//   + processed · deferred · dropped · unsubscribe · resubscribe
//
// PRIVACIDAD: la apertura y el clic traen IP, navegador y ubicacion del destinatario, y el clic trae la URL
// (que en un correo transaccional puede llevar un token de restablecer contrasena o de check-in). Nada de eso se
// guarda. Tampoco el cuerpo del webhook en los logs: lleva destinatarios.

export type ProveedorEventoCorreo = "sendgrid" | "smtp2go";

export interface FilaEventoCorreo {
  proveedor: ProveedorEventoCorreo;
  tipo: string;
  /** bitacora_envio_correo.id, si el evento lo trae o se pudo resolver. */
  referencia: string | null;
  id_proveedor: string | null;
  destinatario: string | null;
  detalle: string | null;
  /** Identifica el evento para no guardarlo dos veces cuando el proveedor reintenta. */
  id_evento: string | null;
  payload: Record<string, unknown>;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DETALLE = 500;

export const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const texto = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Une las partes que existan y recorta; null si no hay ninguna. */
export function detalleDe(...partes: unknown[]): string | null {
  const usadas = partes.map(texto).filter((p): p is string => p !== null);
  return usadas.length ? usadas.join(" | ").slice(0, MAX_DETALLE) : null;
}

/** Un UUID valido en minusculas, o null (un valor mal formado nunca se cruza con la bitacora). */
export function referenciaValida(v: unknown): string | null {
  const t = texto(v);
  return t && UUID.test(t) ? t.toLowerCase() : null;
}

export const correoEnMinusculas = (v: unknown): string | null => texto(v)?.toLowerCase() ?? null;
