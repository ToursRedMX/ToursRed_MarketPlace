// Adaptadores de envio: traducen CorreoSaliente al formato de cada proveedor y clasifican la respuesta.
// Nunca lanzan ni registran el cuerpo del correo (puede llevar un codigo o una contrasena temporal).
import type { ClaseFalloCorreo, CorreoSaliente, ResultadoProveedor } from "./tipos.ts";

const TIMEOUT_MS = 15000;

/** `Nombre <a@b.com>` -> { email, name }; `a@b.com` -> { email }. */
export function separarRemitente(remitente: string): { email: string; name?: string } {
  const m = remitente.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/);
  if (m) {
    const name = m[1]?.trim();
    return name ? { email: m[2].trim(), name } : { email: m[2].trim() };
  }
  return { email: remitente.trim() };
}

function lista(para: string | string[]): string[] {
  return Array.isArray(para) ? para : [para];
}

function claseHttp(status: number): ClaseFalloCorreo {
  return status === 429 || status >= 500 ? "no_disponible" : "rechazo_confirmado";
}

export async function enviarPorSmtp2go(
  llave: string | null | undefined,
  correo: CorreoSaliente,
  remitente: string,
): Promise<ResultadoProveedor> {
  if (!llave) return { ok: false, clase: "no_configurado", codigo: "smtp2go_sin_llave" };
  const adjuntos = (correo.adjuntos ?? []).filter((a) => !a.enLinea);
  const enLinea = (correo.adjuntos ?? []).filter((a) => a.enLinea);
  try {
    const respuesta = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": llave },
      body: JSON.stringify({
        sender: remitente,
        to: lista(correo.para),
        subject: correo.asunto,
        html_body: correo.html,
        ...(correo.texto ? { text_body: correo.texto } : {}),
        ...(correo.responderA ? { custom_headers: [{ header: "Reply-To", value: correo.responderA }] } : {}),
        ...(adjuntos.length
          ? { attachments: adjuntos.map((a) => ({ filename: a.nombre, fileblob: a.contenidoBase64, mimetype: a.mimetype })) }
          : {}),
        ...(enLinea.length
          ? { inlines: enLinea.map((a) => ({ filename: a.nombre, fileblob: a.contenidoBase64, mimetype: a.mimetype })) }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!respuesta.ok) return { ok: false, clase: claseHttp(respuesta.status), codigo: `smtp2go_http_${respuesta.status}` };
    // SMTP2GO responde 200 aunque el envio falle: el resultado real va en `data`.
    const cuerpo = await respuesta.json().catch(() => null);
    const data = cuerpo?.data;
    if (data?.error || Number(data?.failed ?? 0) > 0 || (data?.succeeded !== undefined && Number(data.succeeded) === 0)) {
      return { ok: false, clase: "rechazo_confirmado", codigo: "smtp2go_rechazo" };
    }
    return { ok: true };
  } catch {
    return { ok: false, clase: "incierto", codigo: "smtp2go_sin_respuesta" };
  }
}

/** Zoho espera `Zoho-enczapikey <token>`; se acepta el secreto con o sin ese prefijo. */
function autorizacionZoho(llave: string): string {
  const t = llave.trim();
  return /^zoho-enczapikey\s/i.test(t) ? t : `Zoho-enczapikey ${t}`;
}

export async function enviarPorZoho(
  llave: string | null | undefined,
  correo: CorreoSaliente,
  remitente: string,
): Promise<ResultadoProveedor> {
  if (!llave) return { ok: false, clase: "no_configurado", codigo: "zoho_sin_llave" };
  const persona = (valor: string) => {
    const { email, name } = separarRemitente(valor);
    return name ? { address: email, name } : { address: email };
  };
  const adjuntos = (correo.adjuntos ?? []).filter((a) => !a.enLinea);
  const enLinea = (correo.adjuntos ?? []).filter((a) => a.enLinea);
  try {
    const respuesta = await fetch("https://cpaas.zoho.com/v1.1/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: autorizacionZoho(llave) },
      body: JSON.stringify({
        from: persona(remitente),
        to: lista(correo.para).map((p) => ({ email_address: persona(p) })),
        subject: correo.asunto,
        htmlbody: correo.html,
        ...(correo.texto ? { textbody: correo.texto } : {}),
        ...(correo.responderA ? { reply_to: [persona(correo.responderA)] } : {}),
        ...(adjuntos.length
          ? { attachments: adjuntos.map((a) => ({ name: a.nombre, mime_type: a.mimetype, content: a.contenidoBase64 })) }
          : {}),
        ...(enLinea.length
          ? { inline_images: enLinea.map((a) => ({ name: a.nombre, mime_type: a.mimetype, content: a.contenidoBase64, cid: a.nombre })) }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 = aceptado; 400 trae `data.error_code`, que no se registra junto con el correo.
    if (respuesta.status === 200) return { ok: true };
    return { ok: false, clase: claseHttp(respuesta.status), codigo: `zoho_http_${respuesta.status}` };
  } catch {
    return { ok: false, clase: "incierto", codigo: "zoho_sin_respuesta" };
  }
}

export async function enviarPorSendgrid(
  llave: string | null | undefined,
  correo: CorreoSaliente,
  remitente: string,
): Promise<ResultadoProveedor> {
  if (!llave) return { ok: false, clase: "no_configurado", codigo: "sendgrid_sin_llave" };
  try {
    const respuesta = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llave}` },
      body: JSON.stringify({
        // Un destinatario puede venir como `Nombre <correo>` (SMTP2GO lo acepta tal cual; SendGrid pide separarlos).
        personalizations: [{ to: lista(correo.para).map(separarRemitente) }],
        from: separarRemitente(remitente),
        subject: correo.asunto,
        // SendGrid exige text/plain antes de text/html cuando van los dos.
        content: [
          ...(correo.texto ? [{ type: "text/plain", value: correo.texto }] : []),
          { type: "text/html", value: correo.html },
        ],
        ...(correo.responderA ? { reply_to: separarRemitente(correo.responderA) } : {}),
        ...(correo.adjuntos?.length
          ? {
            attachments: correo.adjuntos.map((a) => ({
              content: a.contenidoBase64,
              filename: a.nombre,
              type: a.mimetype,
              ...(a.enLinea ? { disposition: "inline", content_id: a.nombre } : { disposition: "attachment" }),
            })),
          }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 202 = aceptado para entrega; cualquier otro estado es fallo (el cuerpo trae `errors`, pero no se registra).
    if (respuesta.status === 202) return { ok: true };
    return { ok: false, clase: claseHttp(respuesta.status), codigo: `sendgrid_http_${respuesta.status}` };
  } catch {
    return { ok: false, clase: "incierto", codigo: "sendgrid_sin_respuesta" };
  }
}
