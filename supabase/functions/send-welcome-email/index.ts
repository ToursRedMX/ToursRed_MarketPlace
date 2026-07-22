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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userData, error: userDataError } = await supabase
      .from("users")
      .select("email, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();

    if (userDataError || !userData) {
      return new Response(
        JSON.stringify({ success: false, error: "Usuario no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [{ data: emailSettings }, { data: platformSettings }] = await Promise.all([
      supabase.from("email_settings").select("smtp_api_key, contact_email").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    const smtpApiKey = emailSettings?.smtp_api_key;

    if (!smtpApiKey) {
      console.error("SMTP2GO API key not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email configuration not available" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings?.contact_email || "contacto@toursred.com";
    const displayName = `${userData.first_name || ""}`.trim() || "Viajero";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bienvenido a ToursRed</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">

                <tr>
                  <td style="padding: 36px 40px 28px 40px; text-align: center; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px 12px 0 0;">
                    <img src="${logoUrl}" alt="ToursRed" style="max-width: 160px; height: auto; margin-bottom: 16px; background: white; padding: 8px 16px; border-radius: 8px;" />
                    <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">¡Bienvenido a ToursRed!</h1>
                    <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">Tu cuenta ha sido verificada exitosamente</p>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 40px 40px 32px 40px;">
                    <p style="margin: 0 0 20px 0; color: #374151; font-size: 17px; line-height: 28px;">
                      Hola <strong>${displayName}</strong>,
                    </p>
                    <p style="margin: 0 0 28px 0; color: #4b5563; font-size: 15px; line-height: 26px;">
                      Tu correo electrónico ha sido verificado y tu cuenta está lista. Ya puedes explorar todos los tours y destinos que tenemos disponibles para ti.
                    </p>

                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px 0;">
                      <tr>
                        <td style="padding: 0 8px 16px 0; width: 50%; vertical-align: top;">
                          <div style="background-color: #fef2f2; border-radius: 10px; padding: 20px; text-align: center;">
                            <div style="font-size: 28px; margin-bottom: 8px;">🗺️</div>
                            <p style="margin: 0 0 4px 0; color: #991b1b; font-size: 14px; font-weight: 600;">Explora Tours</p>
                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 18px;">Descubre destinos nacionales e internacionales</p>
                          </div>
                        </td>
                        <td style="padding: 0 0 16px 8px; width: 50%; vertical-align: top;">
                          <div style="background-color: #fff7ed; border-radius: 10px; padding: 20px; text-align: center;">
                            <div style="font-size: 28px; margin-bottom: 8px;">⭐</div>
                            <p style="margin: 0 0 4px 0; color: #c2410c; font-size: 14px; font-weight: 600;">ToursRed Plus</p>
                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 18px;">Accede a descuentos y beneficios exclusivos</p>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 8px 0 0; width: 50%; vertical-align: top;">
                          <div style="background-color: #f0fdf4; border-radius: 10px; padding: 20px; text-align: center;">
                            <div style="font-size: 28px; margin-bottom: 8px;">🎁</div>
                            <p style="margin: 0 0 4px 0; color: #166534; font-size: 14px; font-weight: 600;">Refiere Amigos</p>
                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 18px;">Gana 5,000 puntos por cada amigo que reserves</p>
                          </div>
                        </td>
                        <td style="padding: 0 0 0 8px; width: 50%; vertical-align: top;">
                          <div style="background-color: #eff6ff; border-radius: 10px; padding: 20px; text-align: center;">
                            <div style="font-size: 28px; margin-bottom: 8px;">💳</div>
                            <p style="margin: 0 0 4px 0; color: #1d4ed8; font-size: 14px; font-weight: 600;">Tarjetas de Regalo</p>
                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 18px;">Regala experiencias de viaje a tus seres queridos</p>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <div style="text-align: center;">
                      <a href="${appUrl}"
                         style="display: inline-block; padding: 15px 40px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                        Explorar Tours
                      </a>
                    </div>
                  </td>
                </tr>

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

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": smtpApiKey,
      },
      body: JSON.stringify({
        sender: fromEmail,
        to: [userData.email],
        subject: "¡Bienvenido a ToursRed! Tu cuenta está lista",
        html_body: htmlContent,
        text_body: `Hola ${displayName},\n\nTu correo ha sido verificado exitosamente. ¡Bienvenido a ToursRed!\n\nYa puedes:\n- Explorar tours nacionales e internacionales\n- Acceder a membresía ToursRed Plus con descuentos exclusivos\n- Referir amigos y ganar 5,000 puntos por cada uno\n- Regalar experiencias con nuestras tarjetas de regalo\n\nVisítanos en: ${appUrl}\n\n¿Tienes dudas? Escríbenos a ${fromEmail}\n\n© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.`,
      }),
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok || emailData.data?.error) {
      console.error("SMTP2GO error:", emailData);
      throw new Error(emailData.data?.error || `Email send failed: ${emailResponse.status}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Welcome email sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-welcome-email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
