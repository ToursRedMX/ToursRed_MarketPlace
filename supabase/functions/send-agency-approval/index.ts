import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AgencyApprovalPayload {
  agencyName: string;
  contactEmail: string;
  contactFirstName: string;
  contactLastName?: string;
  executiveName: string;
  executiveEmail: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      agencyName,
      contactEmail,
      contactFirstName,
      contactLastName = "",
      executiveName,
      executiveEmail,
    }: AgencyApprovalPayload = await req.json();

    if (!agencyName || !contactEmail || !contactFirstName || !executiveEmail) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [{ data: emailSettings }, { data: platformSettings }] = await Promise.all([
      supabase.from("email_settings").select("smtp_api_key, contact_email").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const displayName = `${contactFirstName} ${contactLastName}`.trim();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu agencia ha sido aprobada - ToursRed</title>
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
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">Agencia Aprobada</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">${agencyName}</p>
            </td>
          </tr>

          <!-- Badge aprobado -->
          <tr>
            <td style="padding: 32px 40px 0 40px; text-align: center;">
              <div style="display: inline-block; background-color: #f0fdf4; border: 2px solid #16a34a; border-radius: 50px; padding: 10px 24px;">
                <span style="color: #16a34a; font-size: 15px; font-weight: 700;">Cuenta activa y verificada</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 28px 40px 40px 40px;">

              <p style="margin: 0 0 20px 0; color: #374151; font-size: 17px; line-height: 28px;">
                Hola <strong>${displayName}</strong>,
              </p>
              <p style="margin: 0 0 28px 0; color: #4b5563; font-size: 15px; line-height: 26px;">
                Nos complace informarte que tu agencia <strong>${agencyName}</strong> ha sido
                <strong style="color: #16a34a;">aprobada oficialmente</strong> en la plataforma ToursRed.
                A partir de este momento puedes comenzar a publicar tus tours y recibir reservas.
              </p>

              <!-- Pasos -->
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px 28px; margin: 0 0 28px 0;">
                <p style="margin: 0 0 20px 0; color: #111827; font-size: 15px; font-weight: 700;">Primeros pasos en la plataforma</p>

                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; vertical-align: middle;">
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <div style="width: 26px; height: 26px; background-color: #dc2626; color: white; border-radius: 50%; text-align: center; line-height: 26px; font-size: 12px; font-weight: 700;">1</div>
                          </td>
                          <td style="color: #4b5563; font-size: 14px; line-height: 22px;">Inicia sesión en tu cuenta con tus credenciales</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: middle;">
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <div style="width: 26px; height: 26px; background-color: #dc2626; color: white; border-radius: 50%; text-align: center; line-height: 26px; font-size: 12px; font-weight: 700;">2</div>
                          </td>
                          <td style="color: #4b5563; font-size: 14px; line-height: 22px;">Completa el perfil de tu agencia con logo, descripcion y datos bancarios</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: middle;">
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <div style="width: 26px; height: 26px; background-color: #dc2626; color: white; border-radius: 50%; text-align: center; line-height: 26px; font-size: 12px; font-weight: 700;">3</div>
                          </td>
                          <td style="color: #4b5563; font-size: 14px; line-height: 22px;">Crea tu primer tour y comienza a recibir reservas</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: middle;">
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <div style="width: 26px; height: 26px; background-color: #dc2626; color: white; border-radius: 50%; text-align: center; line-height: 26px; font-size: 12px; font-weight: 700;">4</div>
                          </td>
                          <td style="color: #4b5563; font-size: 14px; line-height: 22px;">Configura tus metodos de pago y datos de facturacion</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Boton -->
              <div style="text-align: center; margin-bottom: 32px;">
                <a href="${appUrl}/login"
                   style="display: inline-block; padding: 15px 48px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Ir a mi panel de agencia
                </a>
              </div>

              <!-- Ejecutivo asignado -->
              <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 20px 24px;">
                <p style="margin: 0 0 8px 0; color: #0369a1; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Tu Ejecutivo de Cuenta</p>
                <p style="margin: 0 0 6px 0; color: #0c4a6e; font-size: 15px; font-weight: 600;">${executiveName}</p>
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 22px;">
                  Para cualquier duda o asistencia, contacta directamente a
                  <a href="mailto:${executiveEmail}" style="color: #dc2626; text-decoration: none; font-weight: 600;">${executiveEmail}</a>
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px 0; color: #9ca3af; font-size: 13px;">Dudas generales: <a href="mailto:${fromEmail}" style="color: #dc2626; text-decoration: none;">${fromEmail}</a></p>
              <p style="margin: 0; color: #d1d5db; font-size: 12px;">&copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textContent = `Tu agencia ha sido aprobada en ToursRed!

Hola ${displayName},

Nos complace informarte que tu agencia "${agencyName}" ha sido aprobada oficialmente en la plataforma ToursRed. A partir de este momento puedes comenzar a publicar tus tours y recibir reservas.

PRIMEROS PASOS:
1. Inicia sesion con tus credenciales en: ${appUrl}/login
2. Completa el perfil de tu agencia con logo, descripcion y datos bancarios
3. Crea tu primer tour y comienza a recibir reservas
4. Configura tus metodos de pago y datos de facturacion

TU EJECUTIVO DE CUENTA:
${executiveName} - ${executiveEmail}

Dudas generales: ${fromEmail}

(c) ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.`;

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
      },
      body: JSON.stringify({
        sender: fromEmail,
        to: [contactEmail],
        subject: `Tu agencia "${agencyName}" ha sido aprobada en ToursRed`,
        html_body: htmlContent,
        text_body: textContent,
      }),
    });

    const result = await response.json();
    if (!response.ok || result.data?.error) {
      throw new Error(result.data?.error || `SMTP2GO error: ${response.status}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-agency-approval:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
