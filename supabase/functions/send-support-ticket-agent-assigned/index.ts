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

    const { folio, agente_nombre, agente_email, solicitante_nombre, categoria, descripcion } = await req.json();

    if (!folio || !agente_email) {
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

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#1e40af;padding:32px 40px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">ToursRed</p>
              <p style="margin:8px 0 0;color:#93c5fd;font-size:14px;">Centro de Soporte</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Ticket asignado</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">
                Hola ${agente_nombre}, se te ha asignado un nuevo ticket de soporte.
              </p>

              <div style="background-color:#eff6ff;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
                <p style="margin:0 0 4px;font-size:12px;color:#3b82f6;font-weight:600;text-transform:uppercase;">Folio</p>
                <p style="margin:0;font-size:28px;font-weight:800;color:#1e40af;font-family:monospace;">${folio}</p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <tr><td style="padding:10px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Detalle</td></tr>
                <tr><td style="padding:14px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding-bottom:8px;width:35%;">Solicitante:</td>
                      <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${solicitante_nombre}</td>
                    </tr>
                    ${categoria ? `
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Categoria:</td>
                      <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${categoria}</td>
                    </tr>` : ""}
                    ${descripcion ? `
                    <tr>
                      <td style="font-size:13px;color:#6b7280;vertical-align:top;">Descripcion:</td>
                      <td style="font-size:13px;color:#374151;">${descripcion}</td>
                    </tr>` : ""}
                  </table>
                </td></tr>
              </table>

              <div style="background-color:#fef9c3;border-left:4px solid #eab308;border-radius:4px;padding:16px;">
                <p style="margin:0;font-size:13px;color:#713f12;">
                  Accede al panel de administracion para revisar y atender este ticket a la brevedad.
                </p>
              </div>
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

    const textBody = `Hola ${agente_nombre},

Se te ha asignado el ticket de soporte ${folio}.

Solicitante: ${solicitante_nombre}
${categoria ? `Categoria: ${categoria}\n` : ""}
${descripcion ? `Descripcion:\n${descripcion}\n` : ""}

Accede al panel de administracion para atender este ticket.

ToursRed — soporte@toursred.com.mx`;

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: emailSettings.smtp_api_key,
        to: [agente_email],
        sender: "soporte@toursred.com.mx",
        subject: `[${folio}] Ticket asignado — ToursRed`,
        text_body: textBody,
        html_body: htmlBody,
        custom_headers: [{ header: "Reply-To", value: "soporte@toursred.com.mx" }],
      }),
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
    console.error("send-support-ticket-agent-assigned error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
