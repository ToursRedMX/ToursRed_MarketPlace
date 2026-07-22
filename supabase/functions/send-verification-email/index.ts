import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const { userId, verificationCode, userName } = await req.json();

    if (!userId || !verificationCode) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data: userData, error: userDataError } = await supabase
      .from("users")
      .select("email, first_name, last_name")
      .eq("id", userId)
      .single();

    if (userDataError || !userData) {
      return new Response(
        JSON.stringify({ success: false, error: "Usuario no encontrado" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (settingsError) {
      console.error("Error obteniendo configuración de email:", settingsError);
    }

    const smtpApiKey = emailSettings?.smtp_api_key;

    if (!smtpApiKey) {
      console.error("API key de SMTP2GO no configurada");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Configuración de correo no disponible"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const fromEmail = emailSettings?.contact_email || "contacto@toursred.com";

    const displayName = userName || `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Usuario';

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": smtpApiKey,
      },
      body: JSON.stringify({
        sender: fromEmail,
        to: [userData.email],
        subject: "Bienvenido - Verifica tu correo electrónico",
        html_body: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 20px; background: white; padding: 10px; border-radius: 8px;" />
                <h1 style="color: white; margin: 0; font-size: 28px;">¡Bienvenido a ToursRed!</h1>
              </div>
              
              <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                <h2 style="color: #667eea; margin-top: 0;">Hola ${displayName},</h2>
                
                <p style="font-size: 16px; margin-bottom: 20px;">
                  Gracias por registrarte. Para completar tu registro y acceder a todas las funcionalidades de la plataforma, necesitamos verificar tu correo electrónico.
                </p>
                
                <div style="background: white; padding: 25px; border-radius: 8px; text-align: center; margin: 30px 0; border: 2px dashed #667eea;">
                  <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Tu código de verificación</p>
                  <p style="font-size: 36px; font-weight: bold; color: #667eea; margin: 10px 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                    ${verificationCode}
                  </p>
                  <p style="font-size: 12px; color: #999; margin: 10px 0 0 0;">
                    Este código expira en 24 horas
                  </p>
                </div>
                
                <p style="font-size: 14px; color: #666; margin-top: 30px;">
                  <strong>¿Cómo usar tu código?</strong><br>
                  1. Inicia sesión en tu cuenta<br>
                  2. Ingresa el código de 6 dígitos cuando se te solicite<br>
                  3. ¡Listo! Tu correo estará verificado
                </p>
                
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; font-size: 14px; color: #856404;">
                    <strong>⚠️ Nota de seguridad:</strong> Si no creaste esta cuenta, ignora este correo. Tu código expirará automáticamente.
                  </p>
                </div>
                
                <p style="font-size: 14px; color: #999; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                  ¿Necesitas ayuda? Contáctanos respondiendo a este correo.
                </p>
              </div>
            </body>
          </html>
        `,
      }),
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok || emailData.data?.error) {
      console.error("Error enviando correo:", emailData);
      return new Response(
        JSON.stringify({
          success: false,
          error: emailData.data?.error || "No se pudo enviar el correo de verificación"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log("Correo de verificación enviado:", emailData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Correo de verificación enviado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error en send-verification-email:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Error interno del servidor" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
