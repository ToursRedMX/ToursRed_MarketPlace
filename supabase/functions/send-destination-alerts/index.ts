import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { requireServiceRole } from "../_shared/auth.ts";

// "Avisame": manda el correo a quien pidio que le avisaran cuando una agencia
// publicara un tour de su destino. Lo llama el cron `send-destination-alerts`
// cada 30 minutos. Los avisos se reclaman en la base (claim_destination_alert_matches
// los marca como notificados) para que un mismo aviso nunca salga dos veces;
// si el envio falla se liberan con release_destination_alert y se reintentan.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TourAviso {
  name: string;
  slug: string | null;
  destination: string | null;
  agency: string | null;
}

interface AvisoReclamado {
  alert_id: string;
  unsubscribe_token: string;
  email: string;
  first_name: string | null;
  term_raw: string;
  tours: TourAviso[];
}

function construirCorreo(aviso: AvisoReclamado, platformUrl: string) {
  const tours = Array.isArray(aviso.tours) ? aviso.tours : [];
  const saludo = aviso.first_name ? `Hola ${esc(aviso.first_name)},` : "Hola,";
  const enlaceBaja = `${platformUrl}/avisos/baja?token=${aviso.unsubscribe_token}`;
  const lista = tours
    .map((t) => {
      const href = t.slug ? `${platformUrl}/tours/${encodeURIComponent(t.slug)}` : `${platformUrl}/tours`;
      const agencia = t.agency ? ` <span style="color:#6b7280;">· ${esc(t.agency)}</span>` : "";
      return `<li style="margin-bottom:10px;"><a href="${href}" style="color:#0369a1;font-weight:600;text-decoration:none;">${esc(t.name)}</a>${agencia}</li>`;
    })
    .join("");
  const plural = tours.length === 1;
  const asunto = plural
    ? `Ya hay un tour para "${aviso.term_raw}" en ToursRed`
    : `Ya hay tours para "${aviso.term_raw}" en ToursRed`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="background:#b8dfe6;padding:24px;text-align:center;">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed" style="max-width:160px;">
    </div>
    <div style="padding:28px 24px;color:#111827;font-size:15px;line-height:1.6;">
      <p>${saludo}</p>
      <p>Nos pediste que te avisáramos cuando hubiera tours para <strong>${esc(aviso.term_raw)}</strong>. ${plural ? "Una agencia acaba de publicar este:" : "Las agencias acaban de publicar estos:"}</p>
      <ul style="padding-left:20px;">${lista}</ul>
      <p style="margin-top:24px;"><a href="${platformUrl}/tours?destination=${encodeURIComponent(aviso.term_raw)}" style="background:#0284c7;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Ver los tours</a></p>
    </div>
    <div style="padding:16px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
      <p>Recibes este correo porque pulsaste "Avísame" para este destino en ToursRed. Es un solo aviso; no recibirás más sobre este destino.</p>
      <p><a href="${enlaceBaja}" style="color:#6b7280;">Cancelar este aviso</a></p>
      <p>© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
    </div>
  </div>
</body></html>`;
  return { asunto, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const auth = requireServiceRole(req, { recurso: "send-destination-alerts", cors: corsHeaders });
    if (!auth.ok) return auth.response;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key")
      .maybeSingle();
    if (!emailSettings?.smtp_api_key) {
      return new Response(JSON.stringify({ error: "Configuracion de email no disponible" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("platform_url")
      .maybeSingle();
    const platformUrl = (platformSettings?.platform_url || "https://toursredmx.netlify.app").replace(/\/$/, "");

    const { data: avisos, error: errorReclamo } = await supabase.rpc("claim_destination_alert_matches", { p_limit: 100 });
    if (errorReclamo) {
      console.error("send-destination-alerts: no se pudieron reclamar avisos", errorReclamo);
      if (sentryDsn) Sentry.captureException(errorReclamo);
      return new Response(JSON.stringify({ error: "No se pudieron reclamar los avisos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let enviados = 0;
    let fallidos = 0;
    for (const aviso of (avisos ?? []) as AvisoReclamado[]) {
      let ok = false;
      try {
        const { asunto, html } = construirCorreo(aviso, platformUrl);
        const respuesta = await fetch("https://api.smtp2go.com/v3/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: emailSettings.smtp_api_key,
            to: [aviso.first_name ? `${aviso.first_name.replace(/[<>"]/g, "")} <${aviso.email}>` : aviso.email],
            sender: "ToursRed <noreply@toursred.com>",
            subject: asunto,
            html_body: html,
          }),
        });
        const resultado = await respuesta.json();
        ok = resultado?.data?.succeeded === 1;
      } catch (e) {
        console.error("send-destination-alerts: error enviando", e);
      }

      if (ok) {
        enviados++;
      } else {
        fallidos++;
        // Lo deja pendiente para el siguiente ciclo del cron.
        const { error: errorLiberar } = await supabase.rpc("release_destination_alert", { p_alert_id: aviso.alert_id });
        if (errorLiberar) console.error("send-destination-alerts: no se pudo liberar el aviso", aviso.alert_id, errorLiberar);
      }
    }

    return new Response(JSON.stringify({ success: true, reclamados: (avisos ?? []).length, enviados, fallidos }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-destination-alerts:", error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
