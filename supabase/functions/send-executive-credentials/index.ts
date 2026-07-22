import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExecutiveCredentialsPayload {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { email, firstName, lastName, password }: ExecutiveCredentialsPayload = await req.json();

    if (!email || !firstName || !password) {
      return new Response(
        JSON.stringify({ error: "email, firstName y password son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = "https://toursred.com";
    const displayName = `${firstName} ${lastName || ""}`.trim();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tus credenciales de acceso - ToursRed</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="padding: 36px 40px 28px 40px; text-align: center; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px 12px 0 0;">
              <img src="${logoUrl}" alt="ToursRed" style="max-width: 160px; height: auto; margin-bottom: 16px; background: white; padding: 8px 16px; border-radius: 8px;" />
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">¡Bienvenido al equipo!</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">Ejecutivo de Cuenta — ToursRed</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px 40px;">
              <p style="margin: 0 0 20px 0; color: #374151; font-size: 17px; line-height: 28px;">
                Hola <strong>${displayName}</strong>,
              </p>
              <p style="margin: 0 0 28px 0; color: #4b5563; font-size: 15px; line-height: 26px;">
                Tu cuenta de Ejecutivo de Cuenta en ToursRed ha sido creada. A continuación encontrarás tus credenciales de acceso:
              </p>

              <!-- Credentials box -->
              <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 24px 28px; margin: 0 0 28px 0;">
                <p style="margin: 0 0 4px 0; color: #0369a1; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Correo electrónico</p>
                <p style="margin: 0 0 20px 0; color: #0c4a6e; font-size: 16px; font-weight: 600;">${email}</p>
                <p style="margin: 0 0 4px 0; color: #0369a1; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Contraseña temporal</p>
                <p style="margin: 0; color: #0c4a6e; font-size: 20px; font-weight: 700; font-family: 'Courier New', Courier, monospace; letter-spacing: 2px;">${password}</p>
              </div>

              <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 16px 20px; margin: 0 0 32px 0;">
                <p style="margin: 0; color: #c2410c; font-size: 14px; line-height: 22px;">
                  <strong>Importante:</strong> Por seguridad, te recomendamos cambiar tu contraseña la primera vez que inicies sesión.
                </p>
              </div>

              <div style="text-align: center;">
                <a href="${appUrl}/login"
                   style="display: inline-block; padding: 15px 40px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Iniciar sesión
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px 0; color: #9ca3af; font-size: 13px;">¿Tienes dudas? Escríbenos a <a href="mailto:${fromEmail}" style="color: #dc2626; text-decoration: none;">${fromEmail}</a></p>
              <p style="margin: 0; color: #d1d5db; font-size: 12px;">© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Hola ${displayName},

Tu cuenta de Ejecutivo de Cuenta en ToursRed ha sido creada.

Tus credenciales de acceso:
- Correo electrónico: ${email}
- Contraseña temporal: ${password}

Por seguridad, te recomendamos cambiar tu contraseña la primera vez que inicies sesión.

Inicia sesión en: ${appUrl}/login

¿Tienes dudas? Escríbenos a ${fromEmail}

© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: fromEmail,
      subject: "Tus credenciales de acceso - ToursRed Ejecutivos",
      html_body: htmlContent,
      text_body: textContent,
    };

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO error: ${response.status}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Credenciales enviadas" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-executive-credentials:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
