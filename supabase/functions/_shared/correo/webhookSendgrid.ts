// Webhook de eventos de SendGrid (Twilio SendGrid «Event Webhook»): entregas, rebotes, aperturas, spam...
//
// Formato (documentacion de SendGrid): el cuerpo es un ARREGLO JSON y cada elemento es un evento:
//   { event, email, timestamp, sg_event_id, sg_message_id, reason, status, type, ... + los custom_args al nivel superior }
// Mandamos `custom_args: { referencia }` al enviar (el id de la fila de bitacora_envio_correo), que vuelve en cada evento.
//
// FIRMA (Signed Event Webhook): SendGrid firma con ECDSA/SHA-256 el texto `timestamp + cuerpo crudo` y manda la firma
// en base64 (DER) en `X-Twilio-Email-Event-Webhook-Signature`, con el `X-Twilio-Email-Event-Webhook-Timestamp`.
// La llave publica (base64 de un SPKI DER) se copia del panel al activar la firma y va en el secreto
// SENDGRID_WEBHOOK_PUBLIC_KEY. El cuerpo debe verificarse en BYTES, sin volver a serializar el JSON.

import { Buffer } from "node:buffer";
import { createPublicKey, createVerify } from "node:crypto";
import {
  correoEnMinusculas,
  detalleDe,
  esObjeto,
  type FilaEventoCorreo,
  referenciaValida,
  texto,
} from "./eventosCorreo.ts";

/** `true` solo si la firma corresponde a la llave publica, al timestamp y a estos mismos bytes. */
export function verificarFirmaSendgrid(
  cuerpoCrudo: Uint8Array,
  timestamp: string | null,
  firmaBase64: string | null,
  llavePublicaBase64: string | null | undefined,
): boolean {
  if (!timestamp || !firmaBase64 || !llavePublicaBase64) return false;
  try {
    const llave = createPublicKey({ key: Buffer.from(llavePublicaBase64.trim(), "base64"), format: "der", type: "spki" });
    const verificador = createVerify("SHA256");
    verificador.update(timestamp);
    verificador.update(cuerpoCrudo);
    verificador.end();
    return verificador.verify(llave, firmaBase64.trim(), "base64");
  } catch {
    return false;
  }
}

/** Nombre de SendGrid -> el vocabulario de la pantalla. `bounce` distingue permanente (bounce) de temporal (blocked). */
export function tipoDeEventoSendgrid(evento: Record<string, unknown>): string {
  switch (texto(evento.event)) {
    case "processed": return "processed";
    case "delivered": return "delivered";
    case "open": return "email_open";
    case "click": return "email_link_click";
    case "deferred": return "deferred";
    case "dropped": return "dropped";
    case "spamreport": return "feedback_loop";
    case "unsubscribe":
    case "group_unsubscribe": return "unsubscribe";
    case "group_resubscribe": return "resubscribe";
    case "bounce": return texto(evento.type) === "blocked" ? "softbounce" : "hardbounce";
    default: return "desconocido";
  }
}

export function filasDeWebhookSendgrid(cuerpo: unknown): FilaEventoCorreo[] {
  const eventos = Array.isArray(cuerpo) ? cuerpo : esObjeto(cuerpo) ? [cuerpo] : [];
  const filas: FilaEventoCorreo[] = [];
  for (const e of eventos) {
    if (!esObjeto(e)) continue;
    // sg_message_id llega como `<id>.recvd-...`: el id que devolvio el envio (X-Message-Id) es la parte anterior al primer punto.
    const sgMensaje = texto(e.sg_message_id);
    filas.push({
      proveedor: "sendgrid",
      tipo: tipoDeEventoSendgrid(e),
      referencia: referenciaValida(e.referencia),
      id_proveedor: sgMensaje ? sgMensaje.split(".")[0] : null,
      destinatario: correoEnMinusculas(e.email),
      detalle: detalleDe(e.reason, e.status, e.bounce_classification),
      id_evento: texto(e.sg_event_id),
      // Solo lo necesario para rastrear: sin ip, navegador ni url (ver eventosCorreo.ts).
      payload: {
        event: e.event ?? null,
        timestamp: e.timestamp ?? null,
        sg_event_id: e.sg_event_id ?? null,
        sg_message_id: e.sg_message_id ?? null,
        type: e.type ?? null,
        status: e.status ?? null,
        bounce_classification: e.bounce_classification ?? null,
        attempt: e.attempt ?? null,
        sg_machine_open: e.sg_machine_open ?? null,
      },
    });
  }
  return filas;
}
