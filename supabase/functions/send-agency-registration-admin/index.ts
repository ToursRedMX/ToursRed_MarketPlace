import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AgencyData {
  agencyName: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { agencyName, email, firstName, lastName, phone }: AgencyData = await req.json();

    if (!agencyName || !email || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const [{ data: emailSettings, error: settingsError }, { data: platformSettings }] = await Promise.all([
      supabase.from("email_settings").select("*").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    const platformUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    if (settingsError || !emailSettings) {
      console.error("Error fetching email settings:", settingsError);
      return new Response(
        JSON.stringify({ error: "Error al obtener configuración de email" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emailSettings.smtp_api_key) {
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const textContent = `
Nueva Agencia Registrada en ToursRed

Se ha registrado una nueva agencia que requiere validación:

Nombre de la Agencia: ${agencyName}
Contacto: ${firstName} ${lastName}
Email: ${email}
${phone ? `Teléfono: ${phone}` : ''}

Por favor, ingresa al panel de administración para revisar y aprobar esta agencia.

---
ToursRed - Sistema de Gestión
    `;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e40af; color: white; padding: 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: #1e40af; }
    .value { color: #374151; }
    .alert-box { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e40af; color: white; text-decoration: none; border-radius: 6px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1>Nueva Agencia Registrada</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <strong>⚠️ Acción Requerida:</strong> Una nueva agencia se ha registrado y requiere validación.
      </div>
      
      <h2 style="color: #1e40af;">Datos de la Agencia</h2>
      
      <div class="field">
        <span class="label">Nombre de la Agencia:</span>
        <div class="value">${agencyName}</div>
      </div>
      
      <div class="field">
        <span class="label">Contacto:</span>
        <div class="value">${firstName} ${lastName}</div>
      </div>
      
      <div class="field">
        <span class="label">Email:</span>
        <div class="value"><a href="mailto:${email}">${email}</a></div>
      </div>
      
      ${phone ? `<div class="field">
        <span class="label">Teléfono:</span>
        <div class="value">${phone}</div>
      </div>` : ''}
      
      <p style="margin-top: 20px;">Por favor, ingresa al panel de administración para revisar y aprobar esta agencia.</p>
      
      <a href="${platformUrl}/admin/agencies" class="button">Ir al Panel de Admin</a>
    </div>
    <div class="footer">
      <p>ToursRed - Sistema de Gestión de Agencias</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: ["agencias@toursred.com.mx"],
      sender: "no-reply@toursred.com",
      subject: `Nueva Agencia Registrada: ${agencyName}`,
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending admin notification email via SMTP2GO API...");

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO API Error: ${response.status}`);
    }

    console.log("Email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending email:", error);
    return new Response(
      JSON.stringify({ error: "Error al enviar el email", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});