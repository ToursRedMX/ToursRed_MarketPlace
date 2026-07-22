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

    const { folio, solicitante_nombre, solicitante_email, descripcion, categoria, sla_horas } = await req.json();

    if (!folio || !solicitante_email) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

    if (settingsError || !emailSettings?.smtp_api_key) {
      console.error("SMTP settings not found:", settingsError);
      return new Response(
        JSON.stringify({ error: "Configuracion de email no disponible" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const slaText = sla_horas
      ? sla_horas < 24
        ? `${sla_horas} hora${sla_horas !== 1 ? "s" : ""}`
        : `${Math.floor(sla_horas / 24)} dia${Math.floor(sla_horas / 24) !== 1 ? "s" : ""}`
      : "24 horas";

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket de Soporte Creado</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1e40af;padding:32px 40px;text-align:center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed" style="max-width:180px;height:auto;display:block;margin:0 auto 8px;" />
              <p style="margin:4px 0 0;color:#93c5fd;font-size:14px;">Centro de Soporte</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Ticket Registrado</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">Hola ${solicitante_nombre}, recibimos tu solicitud de soporte.</p>

              <div style="background-color:#eff6ff;border-radius:10px;padding:24px;margin-bottom:24px;text-align:center;">
                <p style="margin:0 0 6px;font-size:13px;color:#3b82f6;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Tu folio de seguimiento</p>
                <p style="margin:0;font-size:32px;font-weight:800;color:#1e40af;font-family:monospace;">${folio}</p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <tr style="background-color:#f9fafb;">
                  <td style="padding:12px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Detalle del Ticket</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;width:40%;">Categoria:</td>
                        <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${categoria ?? "Soporte"}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Tiempo de respuesta:</td>
                        <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">Hasta ${slaText}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#6b7280;vertical-align:top;padding-top:4px;">Descripcion:</td>
                        <td style="font-size:13px;color:#374151;padding-top:4px;">${descripcion}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="background-color:#f0fdf4;border-left:4px solid #22c55e;border-radius:4px;padding:16px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:#166534;">
                  Nuestro equipo de soporte atenderá tu caso a la brevedad posible. Recibirás un correo cuando haya actualizaciones en tu ticket.
                </p>
              </div>

              <p style="margin:0;font-size:13px;color:#9ca3af;">
                Si tienes informacion adicional que agregar, puedes responder directamente a este correo o acceder a tu cuenta en ToursRed.
              </p>
            </td>
          </tr>
          <!-- Footer -->
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

Tu ticket de soporte fue registrado exitosamente.

Folio: ${folio}
Categoria: ${categoria ?? "Soporte"}
Tiempo de respuesta: hasta ${slaText}

Descripcion:
${descripcion}

Nuestro equipo atenderá tu caso a la brevedad. Recibirás un correo cuando haya actualizaciones.

Para agregar informacion adicional, puedes responder a este correo.

ToursRed — soporte@toursred.com.mx`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [solicitante_email],
      sender: "soporte@toursred.com.mx",
      subject: `[${folio}] Tu ticket de soporte fue registrado — ToursRed`,
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

    const result = await response.json();
    if (!response.ok) {
      console.error("SMTP2GO error:", result);
      throw new Error("Error al enviar el correo");
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-support-ticket-created error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
