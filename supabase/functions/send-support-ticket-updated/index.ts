import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { folio, solicitante_nombre, solicitante_email, nuevo_status, mensaje_agente } = await req.json();

    if (!folio || !solicitante_email) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ error: "Configuracion de email no disponible" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const STATUS_LABELS: Record<string, string> = {
      sin_atender: "Sin Atender",
      en_proceso: "En Proceso",
      escalado: "Escalado",
      resuelto: "Resuelto",
      cancelado: "Cancelado",
      duplicado: "Duplicado / Asociado",
    };

    const statusLabel = nuevo_status ? (STATUS_LABELS[nuevo_status] ?? nuevo_status) : null;
    const hasResponse = !!mensaje_agente;

    const subject = hasResponse
      ? `[${folio}] Respuesta de soporte — ToursRed`
      : `[${folio}] Actualizacion en tu ticket — ToursRed`;

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#1e40af;padding:32px 40px;text-align:center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed" style="max-width:180px;height:auto;display:block;margin:0 auto 8px;" />
              <p style="margin:4px 0 0;color:#93c5fd;font-size:14px;">Centro de Soporte</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
                ${hasResponse ? "Tienes una respuesta" : "Actualizacion en tu ticket"}
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">
                Hola ${solicitante_nombre}, hay novedades en tu ticket de soporte.
              </p>

              <div style="background-color:#eff6ff;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
                <p style="margin:0 0 4px;font-size:12px;color:#3b82f6;font-weight:600;text-transform:uppercase;">Folio</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#1e40af;font-family:monospace;">${folio}</p>
              </div>

              ${statusLabel ? `
              <div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Estado actualizado</p>
                <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${statusLabel}</p>
              </div>
              ` : ""}

              ${hasResponse ? `
              <div style="background-color:#eff6ff;border-left:4px solid #3b82f6;border-radius:4px;padding:20px;margin-bottom:24px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#3b82f6;text-transform:uppercase;">Respuesta del agente</p>
                <p style="margin:0;font-size:14px;color:#374151;white-space:pre-wrap;">${mensaje_agente}</p>
              </div>
              ` : ""}

              <p style="margin:0;font-size:13px;color:#9ca3af;">
                Puedes responder directamente a este correo para agregar mas informacion a tu ticket.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">ToursRed — Plataforma de Tours en Mexico</p>
              <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">soporte@toursred.com.mx</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textBody = `Hola ${solicitante_nombre},

Hay novedades en tu ticket de soporte ${folio}.

${statusLabel ? `Estado: ${statusLabel}\n` : ""}
${hasResponse ? `Respuesta del agente:\n${mensaje_agente}\n` : ""}

Puedes responder a este correo para agregar mas informacion.

ToursRed — soporte@toursred.com.mx`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [solicitante_email],
      sender: "soporte@toursred.com.mx",
      subject,
      text_body: textBody,
      html_body: htmlBody,
      custom_headers: [
        { header: "Reply-To", value: "soporte@toursred.com.mx" },
      ],
    };

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const result = await response.json();
      console.error("SMTP2GO error:", result);
      throw new Error("Error al enviar el correo");
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-support-ticket-updated error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
