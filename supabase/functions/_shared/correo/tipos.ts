// Tipos del envio de correo. Un solo contrato para todos los proveedores: quien llama
// no sabe si el correo sale por SMTP2GO o por SendGrid (Twilio).

export type ProveedorCorreo = "smtp2go" | "sendgrid";

export const PROVEEDORES_CORREO: readonly ProveedorCorreo[] = ["smtp2go", "sendgrid"];

export interface AdjuntoCorreo {
  nombre: string;
  /** Contenido ya codificado en base64. */
  contenidoBase64: string;
  mimetype: string;
  /** Imagen incrustada en el HTML (`<img src="cid:NOMBRE">`); el cid es `nombre`. */
  enLinea?: boolean;
}

export interface CorreoSaliente {
  para: string | string[];
  asunto: string;
  html: string;
  /** Texto plano alterno; opcional. */
  texto?: string;
  /** Remitente: `correo@dominio` o `Nombre <correo@dominio>`. Por defecto `contact_email`. */
  remitente?: string;
  responderA?: string;
  adjuntos?: AdjuntoCorreo[];
}

/**
 * - `rechazo_confirmado`: el proveedor respondio 4xx o dijo que no lo acepto. No salio nada.
 * - `no_disponible`: 5xx o 429 del proveedor. Tampoco salio nada.
 * - `no_configurado`: falta la llave del proveedor. No se intento.
 * - `incierto`: timeout o red caida; puede que el proveedor SI lo haya aceptado.
 */
export type ClaseFalloCorreo = "rechazo_confirmado" | "no_disponible" | "no_configurado" | "incierto";

export type ResultadoCorreo =
  | { ok: true; proveedor: ProveedorCorreo; respaldo: boolean }
  | { ok: false; proveedor: ProveedorCorreo; clase: ClaseFalloCorreo; codigo: string; respaldo: boolean };

/** Resultado de UN proveedor, antes de decidir si se intenta el respaldo. */
export type ResultadoProveedor =
  | { ok: true }
  | { ok: false; clase: ClaseFalloCorreo; codigo: string };

export interface AjustesCorreo {
  contact_email: string | null;
  smtp_api_key: string | null;
  email_provider: ProveedorCorreo;
  email_fallback_provider: ProveedorCorreo | null;
  email_fallback_enabled: boolean;
}

/** Lo unico que se usa del cliente de Supabase. `any` deliberado: ver `ClienteMinimo` en avisosDePago.ts. */
export interface ClienteCorreo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabla: string): any;
}
