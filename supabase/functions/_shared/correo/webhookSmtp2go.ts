// Webhook de SMTP2GO: entregas, rebotes, aperturas, spam...
//
// Formato (documentacion de SMTP2GO, salida JSON): un objeto por evento con `event` en minusculas (processed, delivered,
// open, click, bounce, spam, unsubscribe, resubscribe, reject), `email_id` (el id que devolvio el envio; es lo que
// guardamos como id_proveedor), `rcpt` (destinatario), `time`, y segun el evento `bounce` ("hard"/"soft"), `message` y
// `context`. La documentacion no trae un ejemplo de payload, asi que el analisis es defensivo y acepta un objeto o un
// arreglo de objetos. SMTP2GO no firma los avisos: se autentican con el encabezado `Authorization: Bearer <token>` que se
// configura en el webhook (secreto SMTP2GO_WEBHOOK_TOKEN).
//
// SMTP2GO no devuelve una referencia propia: el envio se cruza por `email_id` -> bitacora_envio_correo.id_proveedor, y eso
// lo resuelve el receptor consultando la base (aqui `referencia` sale null).
//
// `id` del payload se describe como «unique ID for the webhook», que puede ser el mismo para todos los avisos de ese
// webhook: NO se usa para deduplicar (descartaria eventos buenos). Se usa la combinacion evento + email + destinatario +
// hora, que repite solo cuando SMTP2GO reintenta el mismo aviso.

import {
  correoEnMinusculas,
  detalleDe,
  esObjeto,
  type FilaEventoCorreo,
  texto,
} from "./eventosCorreo.ts";

export function tipoDeEventoSmtp2go(evento: Record<string, unknown>): string {
  switch (texto(evento.event)?.toLowerCase()) {
    case "processed": return "processed";
    case "delivered": return "delivered";
    case "open": return "email_open";
    case "click": return "email_link_click";
    case "spam": return "feedback_loop";
    case "unsubscribe": return "unsubscribe";
    case "resubscribe": return "resubscribe";
    case "reject": return "dropped";
    case "bounce": return texto(evento.bounce)?.toLowerCase() === "soft" ? "softbounce" : "hardbounce";
    default: return "desconocido";
  }
}

export function filasDeWebhookSmtp2go(cuerpo: unknown): FilaEventoCorreo[] {
  const eventos = Array.isArray(cuerpo) ? cuerpo : esObjeto(cuerpo) ? [cuerpo] : [];
  const filas: FilaEventoCorreo[] = [];
  for (const e of eventos) {
    // Un objeto sin `event` no es un evento de correo (por ejemplo, los eventos de SMS que SMTP2GO tambien puede mandar).
    if (!esObjeto(e) || !texto(e.event)) continue;
    const tipo = tipoDeEventoSmtp2go(e);
    const emailId = texto(e.email_id);
    const destinatario = correoEnMinusculas(e.rcpt);
    filas.push({
      proveedor: "smtp2go",
      tipo,
      referencia: null,
      id_proveedor: emailId,
      destinatario,
      detalle: detalleDe(e.message, e.context),
      id_evento: emailId ? `${texto(e.event)}:${emailId}:${destinatario ?? ""}:${texto(e.time) ?? ""}`.slice(0, 200) : null,
      // Sin navegador, ubicacion ni cliente (ver eventosCorreo.ts).
      payload: {
        event: e.event ?? null,
        email_id: e.email_id ?? null,
        time: e.time ?? null,
        sendtime: e.sendtime ?? null,
        bounce: e.bounce ?? null,
        host: e.host ?? null,
      },
    });
  }
  return filas;
}
