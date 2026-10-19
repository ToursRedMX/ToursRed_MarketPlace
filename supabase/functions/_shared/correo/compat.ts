// Adaptador para las Edge Functions que armaban el payload en formato SMTP2GO y miraban la
// respuesta HTTP (`response.ok`, `result.data?.error`). Recibe ese mismo payload, lo manda por el
// proveedor configurado (`enviarCorreo`) y devuelve un `Response` con la misma forma que daba SMTP2GO,
// asi el codigo de cada funcion que lo consume no cambia.
//
// Es transitorio por diseno: una funcion nueva debe llamar a `enviarCorreo` directo. La llave
// `api_key` del payload se ignora (la llave sale de la configuracion), y de `custom_headers` solo
// se respeta `Reply-To`.
import { enviarCorreo } from "./enviarCorreo.ts";
import type { AdjuntoCorreo, ClienteCorreo } from "./tipos.ts";

interface ArchivoSmtp2go {
  filename: string;
  fileblob: string;
  mimetype: string;
}

export interface PayloadSmtp2go {
  to: string | string[];
  sender?: string;
  subject: string;
  html_body: string;
  text_body?: string;
  custom_headers?: { header: string; value: string }[];
  attachments?: ArchivoSmtp2go[];
  inlines?: ArchivoSmtp2go[];
  api_key?: string | null;
}

const aAdjunto = (a: ArchivoSmtp2go, enLinea: boolean): AdjuntoCorreo => ({
  nombre: a.filename,
  contenidoBase64: a.fileblob,
  mimetype: a.mimetype,
  ...(enLinea ? { enLinea: true } : {}),
});

export async function enviarPayloadSmtp2go(admin: ClienteCorreo, payload: PayloadSmtp2go): Promise<Response> {
  const adjuntos = [
    ...(payload.attachments ?? []).map((a) => aAdjunto(a, false)),
    ...(payload.inlines ?? []).map((a) => aAdjunto(a, true)),
  ];
  const responderA = payload.custom_headers?.find((h) => h.header.toLowerCase() === "reply-to")?.value;
  const resultado = await enviarCorreo(admin, {
    para: payload.to,
    asunto: payload.subject,
    html: payload.html_body,
    ...(payload.text_body ? { texto: payload.text_body } : {}),
    ...(payload.sender ? { remitente: payload.sender } : {}),
    ...(responderA ? { responderA } : {}),
    ...(adjuntos.length ? { adjuntos } : {}),
  });
  const cuerpo = resultado.ok
    ? { data: { succeeded: Array.isArray(payload.to) ? payload.to.length : 1, failed: 0 } }
    : { data: { error: resultado.codigo, error_code: resultado.clase } };
  return new Response(JSON.stringify(cuerpo), {
    status: resultado.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}
