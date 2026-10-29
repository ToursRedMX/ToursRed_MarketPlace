// Punto unico de salida del correo transaccional. Elige proveedor segun `email_settings`
// (configurable desde Configuracion) y, si el principal NO acepto el correo, prueba el respaldo.
//
// El respaldo solo se intenta cuando es seguro que el principal no lo mando (rechazo confirmado,
// 5xx/429 o llave ausente). Con un timeout o una red caida el correo pudo salir: reintentar por
// otro proveedor lo duplicaria, asi que ahi se reporta el fallo y no se reintenta.
//
// Las llaves de SendGrid y Zoho son secretos de la Edge Function (SENDGRID_API_KEY, ZOHO_EMAIL_API_KEY), no columnas.
import { enviarPorSendgrid, enviarPorSmtp2go, enviarPorZoho, lista, separarRemitente } from "./proveedores.ts";
import { htmlATexto } from "./textoPlano.ts";
import {
  PROVEEDORES_CORREO,
  type AjustesCorreo,
  type ClienteCorreo,
  type CorreoSaliente,
  type FilaBitacoraEnvio,
  type ProveedorCorreo,
  type ResultadoCorreo,
  type ResultadoProveedor,
} from "./tipos.ts";

export const REMITENTE_POR_DEFECTO = "contacto@toursred.com";
export const NOMBRE_VISIBLE_REMITENTE = "ToursRed";

/** Un remitente a secas (`a@b.com`) sale como `ToursRed <a@b.com>`; uno que ya trae nombre se respeta. */
export function conNombreVisible(remitente: string): string {
  const { email, name } = separarRemitente(remitente);
  return name ? remitente : `${NOMBRE_VISIBLE_REMITENTE} <${email}>`;
}

function proveedorValido(valor: unknown): ProveedorCorreo | null {
  return PROVEEDORES_CORREO.includes(valor as ProveedorCorreo) ? (valor as ProveedorCorreo) : null;
}

// Un newsletter o un mensaje masivo envia un correo por destinatario: sin esto serian N consultas
// a la misma fila. 30 s es lo que tarda en notarse un cambio hecho en Configuracion.
const VIGENCIA_AJUSTES_MS = 30_000;
let cache: { ajustes: AjustesCorreo; hasta: number } | null = null;

/** Solo para pruebas. */
export function limpiarCacheAjustesCorreo(): void {
  cache = null;
}

/** Lee la configuracion. Un valor desconocido en la base cae a SMTP2GO, el comportamiento historico. */
export async function leerAjustesCorreo(admin: ClienteCorreo): Promise<AjustesCorreo | null> {
  if (cache && cache.hasta > Date.now()) return cache.ajustes;
  const { data, error } = await admin
    .from("email_settings")
    .select("smtp_api_key, contact_email, email_provider, email_fallback_provider, email_fallback_enabled")
    .maybeSingle();
  if (error) {
    console.error(`enviarCorreo: fallo la consulta a email_settings (codigo ${error.code ?? "?"})`);
    return null;
  }
  if (!data) return null;
  const ajustes: AjustesCorreo = {
    contact_email: data.contact_email ?? null,
    smtp_api_key: data.smtp_api_key ?? null,
    email_provider: proveedorValido(data.email_provider) ?? "smtp2go",
    email_fallback_provider: proveedorValido(data.email_fallback_provider),
    email_fallback_enabled: data.email_fallback_enabled === true,
  };
  cache = { ajustes, hasta: Date.now() + VIGENCIA_AJUSTES_MS };
  return ajustes;
}

function intentar(
  proveedor: ProveedorCorreo,
  ajustes: AjustesCorreo,
  correo: CorreoSaliente,
  remitente: string,
  referencia: string,
): Promise<ResultadoProveedor> {
  switch (proveedor) {
    case "sendgrid":
      return enviarPorSendgrid(Deno.env.get("SENDGRID_API_KEY"), correo, remitente, referencia);
    case "zoho":
      return enviarPorZoho(Deno.env.get("ZOHO_EMAIL_API_KEY"), correo, remitente, referencia);
    default:
      return enviarPorSmtp2go(ajustes.smtp_api_key, correo, remitente);
  }
}

/**
 * Deja en `bitacora_envio_correo` que acepto (o rechazo) el proveedor. NUNCA lanza ni retrasa el correo: si la
 * bitacora falla se registra solo el codigo del error, sin destinatarios ni asunto.
 */
async function registrar(admin: ClienteCorreo, fila: FilaBitacoraEnvio): Promise<void> {
  try {
    const { error } = await admin.from("bitacora_envio_correo").insert(fila);
    if (error) console.error(`enviarCorreo: no se pudo registrar el envio en la bitacora (codigo ${error.code ?? "?"})`);
  } catch {
    console.error("enviarCorreo: fallo el registro del envio en la bitacora");
  }
}

const FALLBACK_SEGURO = new Set(["rechazo_confirmado", "no_disponible", "no_configurado"]);

/**
 * Envia el correo. Nunca lanza. `ajustes` es opcional: las funciones que ya leyeron
 * `email_settings` pueden pasarlos para no repetir la consulta.
 */
export async function enviarCorreo(
  admin: ClienteCorreo,
  entrante: CorreoSaliente,
  ajustes?: AjustesCorreo | null,
): Promise<ResultadoCorreo> {
  const cfg = ajustes ?? await leerAjustesCorreo(admin);
  if (!cfg) return { ok: false, proveedor: "smtp2go", clase: "no_configurado", codigo: "email_settings_ilegible", respaldo: false };

  // Todo correo sale con parte de texto plano y con nombre visible: ver textoPlano.ts.
  const correo: CorreoSaliente = { ...entrante, texto: entrante.texto || htmlATexto(entrante.html) };
  const remitente = conNombreVisible(correo.remitente || cfg.contact_email || REMITENTE_POR_DEFECTO);
  const principal = cfg.email_provider;

  // Un intento = una fila de bitacora. `id` es la referencia que viaja al proveedor; `envio_id` agrupa el
  // intento principal y el de respaldo del mismo correo. El cuerpo NO se guarda.
  const envioId = crypto.randomUUID();
  const destinatarios = lista(correo.para).map((p) => separarRemitente(p).email);
  const asunto = correo.asunto.slice(0, 200);
  const intento = async (proveedor: ProveedorCorreo, esRespaldo: boolean): Promise<ResultadoProveedor> => {
    const referencia = crypto.randomUUID();
    const r = await intentar(proveedor, cfg, correo, remitente, referencia);
    await registrar(admin, {
      id: referencia,
      envio_id: envioId,
      proveedor,
      es_respaldo: esRespaldo,
      aceptado: r.ok,
      clase: r.ok ? null : r.clase,
      codigo: r.ok ? null : r.codigo,
      http_status: r.httpStatus ?? null,
      id_proveedor: r.ok ? (r.idProveedor ?? null) : null,
      destinatarios,
      asunto,
    });
    return r;
  };

  const r1 = await intento(principal, false);
  if (r1.ok) return { ok: true, proveedor: principal, respaldo: false };

  const respaldo = cfg.email_fallback_provider;
  if (cfg.email_fallback_enabled && respaldo && respaldo !== principal && FALLBACK_SEGURO.has(r1.clase)) {
    console.error(`enviarCorreo: ${principal} no acepto el correo (${r1.codigo}); se intenta ${respaldo}`);
    const r2 = await intento(respaldo, true);
    if (r2.ok) return { ok: true, proveedor: respaldo, respaldo: true };
    console.error(`enviarCorreo: el respaldo ${respaldo} tampoco lo envio (${r2.codigo})`);
    return { ok: false, proveedor: respaldo, clase: r2.clase, codigo: r2.codigo, respaldo: true };
  }

  console.error(`enviarCorreo: ${principal} no envio el correo (${r1.codigo})`);
  return { ok: false, proveedor: principal, clase: r1.clase, codigo: r1.codigo, respaldo: false };
}
