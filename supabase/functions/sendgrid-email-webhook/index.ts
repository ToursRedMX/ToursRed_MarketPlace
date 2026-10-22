import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { mensajeDeError } from "../_shared/errores.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { filasDeWebhookSendgrid, verifySendgridSignature } from "../_shared/correo/webhookSendgrid.ts";
import { guardarEventosCorreo, resolverReferencias } from "../_shared/correo/guardarEventos.ts";

// Receptor del Event Webhook de SendGrid: entregas, rebotes, aperturas, spam. Guarda cada evento en
// `bitacora_evento_correo` para saber lo que paso con un correo DESPUES de que SendGrid lo acepto.
//
// En SendGrid: Settings -> Mail Settings -> Event Webhook -> Create new webhook. Post URL `.../functions/v1/sendgrid-email-webhook`;
// acciones: Processed, Delivered, Deferred, Bounced, Dropped, Opened, Spam Reports (NO «Clicked» si los correos llevan
// enlaces con tokens: el clic trae la URL). Activar «Signed Event Webhook» y guardar: SendGrid muestra la llave publica,
// que va en el secreto SENDGRID_WEBHOOK_PUBLIC_KEY. Sin ese secreto el receptor no acepta nada.

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Twilio-Email-Event-Webhook-Signature, X-Twilio-Email-Event-Webhook-Timestamp",
};

const json = (cuerpo: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const llavePublica = Deno.env.get("SENDGRID_WEBHOOK_PUBLIC_KEY");
  if (!llavePublica) {
    console.error("sendgrid-email-webhook: falta el secreto SENDGRID_WEBHOOK_PUBLIC_KEY");
    return json({ error: "Webhook no configurado" }, 503);
  }

  try {
    // La firma cubre los BYTES del cuerpo: se lee crudo y se verifica antes de interpretarlo.
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!verifySendgridSignature(
      bytes,
      req.headers.get("X-Twilio-Email-Event-Webhook-Timestamp"),
      req.headers.get("X-Twilio-Email-Event-Webhook-Signature"),
      llavePublica,
    )) {
      return json({ error: "Firma inválida" }, 401);
    }

    let cuerpo: unknown = null;
    try {
      cuerpo = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ recibido: 0 }, 200);
    }
    const filas = filasDeWebhookSendgrid(cuerpo);
    if (filas.length === 0) return json({ recibido: 0 }, 200);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      sinUserAgentDeNavegador(opcionesConContexto(req)),
    );
    const { error } = await guardarEventosCorreo(supabase, await resolverReferencias(supabase, "sendgrid", filas));
    if (error) {
      // Se registra el codigo, nunca el cuerpo: lleva destinatarios. Un 500 hace que SendGrid reintente.
      console.error(`sendgrid-email-webhook: no se pudieron guardar los eventos (codigo ${error.code ?? "?"})`);
      return json({ error: "No se pudieron guardar los eventos" }, 500);
    }
    return json({ recibido: filas.length }, 200);
  } catch (error) {
    console.error("sendgrid-email-webhook: error", mensajeDeError(error));
    if (sentryDsn) Sentry.captureException(error);
    return json({ error: "Error interno" }, 500);
  }
});
