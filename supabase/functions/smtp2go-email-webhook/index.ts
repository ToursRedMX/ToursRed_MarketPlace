import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { mensajeDeError } from "../_shared/errores.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { autorizadoPorToken } from "../_shared/correo/webhookZoho.ts";
import { filasDeWebhookSmtp2go } from "../_shared/correo/webhookSmtp2go.ts";
import { guardarEventosCorreo, resolverReferencias } from "../_shared/correo/guardarEventos.ts";

// Receptor del webhook de SMTP2GO: entregas, rebotes, aperturas, spam. Guarda cada evento en `bitacora_evento_correo`
// para saber lo que paso con un correo DESPUES de que SMTP2GO lo acepto.
//
// En SMTP2GO: Settings -> Webhooks -> Add Webhook. URL `.../functions/v1/smtp2go-email-webhook`; Authorization header
// «Bearer» con el valor del secreto SMTP2GO_WEBHOOK_TOKEN; Output type JSON; eventos: Email processed, Rejected, Delivered,
// Bounced, Marked as spam, Opened (NO «Link clicked» si los correos llevan enlaces con tokens). SMTP2GO no firma los
// avisos: el token es lo unico que los autentica, asi que sin el secreto el receptor no acepta nada.

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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (cuerpo: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const esperado = Deno.env.get("SMTP2GO_WEBHOOK_TOKEN");
  if (!esperado) {
    console.error("smtp2go-email-webhook: falta el secreto SMTP2GO_WEBHOOK_TOKEN");
    return json({ error: "Webhook no configurado" }, 503);
  }
  if (!autorizadoPorToken(req.headers.get("Authorization"), esperado)) {
    return json({ error: "No autorizado" }, 401);
  }

  try {
    const cuerpo = await req.json().catch(() => null);
    const filas = filasDeWebhookSmtp2go(cuerpo);
    // La prueba de SMTP2GO o un evento que no es de correo (SMS): se responde 200 sin guardar nada.
    if (filas.length === 0) return json({ recibido: 0 }, 200);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      sinUserAgentDeNavegador(opcionesConContexto(req)),
    );
    const { error } = await guardarEventosCorreo(supabase, await resolverReferencias(supabase, "smtp2go", filas));
    if (error) {
      // Se registra el codigo, nunca el cuerpo: lleva destinatarios. Un 500 hace que SMTP2GO reintente.
      console.error(`smtp2go-email-webhook: no se pudieron guardar los eventos (codigo ${error.code ?? "?"})`);
      return json({ error: "No se pudieron guardar los eventos" }, 500);
    }
    return json({ recibido: filas.length }, 200);
  } catch (error) {
    console.error("smtp2go-email-webhook: error", mensajeDeError(error));
    if (sentryDsn) Sentry.captureException(error);
    return json({ error: "Error interno" }, 500);
  }
});
