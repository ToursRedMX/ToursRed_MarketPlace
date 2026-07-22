import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailRequest {
  referrerEmail: string;
  referrerName: string;
  referredName: string;
  referralCode: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { referrerEmail, referrerName, referredName, referralCode }: EmailRequest = await req.json();

    if (!referrerEmail || !referredName || !referralCode) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    const smtpApiKey = emailSettings?.smtp_api_key;

    if (!smtpApiKey) {
      console.error("SMTP2GO API key not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email configuration not available" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings?.contact_email || "contacto@toursred.com";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = "https://toursred.com";

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nuevo Referido Registrado</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">
                <tr>
                  <td style="padding: 32px 40px 28px 40px; text-align: center; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px 12px 0 0;">
                    <img src="${logoUrl}" alt="ToursRed" style="max-width: 160px; height: auto; margin-bottom: 16px; background: white; padding: 8px 16px; border-radius: 8px;" />
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">¡Tienes un nuevo referido!</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 26px;">
                      Hola <strong>${referrerName}</strong>,
                    </p>
                    <p style="margin: 0 0 24px 0; color: #374151; font-size: 16px; line-height: 26px;">
                      ¡Excelentes noticias! <strong>${referredName}</strong> acaba de registrarse en ToursRed usando tu código de referido <strong style="color: #dc2626;">${referralCode}</strong>.
                    </p>

                    <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 4px;">
                      <p style="margin: 0 0 8px 0; color: #92400e; font-size: 15px; font-weight: 600;">Estado: Pendiente de primera reserva</p>
                      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 22px;">
                        Cuando <strong>${referredName}</strong> complete su primera reserva, ¡ambos recibirán <strong>5,000 puntos ToursRed</strong>!
                      </p>
                    </div>

                    <p style="margin: 0 0 32px 0; color: #6b7280; font-size: 14px; line-height: 22px;">
                      Recuerda que los puntos ToursRed se pueden canjear como descuento en tus reservas si tienes una membresía ToursRed Plus activa.
                    </p>

                    <div style="text-align: center;">
                      <a href="${appUrl}/traveler/referrals"
                         style="display: inline-block; padding: 14px 36px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
                        Ver Mis Referidos
                      </a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0 0 4px 0; color: #9ca3af; font-size: 13px;">Gracias por ser parte de la comunidad ToursRed</p>
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
        to: [referrerEmail],
        subject: "¡Nuevo referido registrado en ToursRed!",
        html_body: htmlContent,
        text_body: `Hola ${referrerName},\n\n${referredName} se ha registrado en ToursRed usando tu código de referido ${referralCode}.\n\nEstado: Pendiente de primera reserva\n\nCuando tu referido complete su primera reserva, ambos recibirán 5,000 puntos ToursRed.\n\nVe tus referidos en: ${appUrl}/traveler/referrals\n\nGracias por ser parte de ToursRed.`,
      }),
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok || emailData.data?.error) {
      console.error("SMTP2GO error:", emailData);
      throw new Error(emailData.data?.error || `Email send failed: ${emailResponse.status}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Referral signup notification sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-referral-signup-notification:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
