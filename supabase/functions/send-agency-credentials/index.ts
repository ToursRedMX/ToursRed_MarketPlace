import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AgencyCredentialsPayload {
  email: string;
  contactFirstName: string;
  contactLastName: string;
  agencyName: string;
  password: string;
  executiveEmail: string;
  executiveName: string;
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
      email,
      contactFirstName,
      contactLastName,
      agencyName,
      password,
      executiveEmail,
      executiveName,
    }: AgencyCredentialsPayload = await req.json();

    if (!email || !contactFirstName || !agencyName || !password || !executiveEmail) {
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
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const displayName = `${contactFirstName} ${contactLastName || ""}`.trim();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bienvenida a ToursRed - ${agencyName}</title>
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
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">¡Bienvenidos a ToursRed!</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">${agencyName}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px 40px;">

              <p style="margin: 0 0 20px 0; color: #374151; font-size: 17px; line-height: 28px;">
                Hola <strong>${displayName}</strong>,
              </p>
              <p style="margin: 0 0 28px 0; color: #4b5563; font-size: 15px; line-height: 26px;">
                Nos complace darte la bienvenida a la plataforma ToursRed. Tu agencia <strong>${agencyName}</strong> ha sido registrada exitosamente. A continuación encontrarás tus credenciales de acceso:
              </p>

              <!-- Credenciales -->
              <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 24px 28px; margin: 0 0 24px 0;">
                <p style="margin: 0 0 4px 0; color: #0369a1; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Correo electrónico</p>
                <p style="margin: 0 0 20px 0; color: #0c4a6e; font-size: 16px; font-weight: 600;">${email}</p>
                <p style="margin: 0 0 4px 0; color: #0369a1; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Contraseña temporal</p>
                <p style="margin: 0; color: #0c4a6e; font-size: 20px; font-weight: 700; font-family: 'Courier New', Courier, monospace; letter-spacing: 2px;">${password}</p>
              </div>

              <!-- Aviso cambio de contraseña -->
              <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 16px 20px; margin: 0 0 32px 0;">
                <p style="margin: 0; color: #c2410c; font-size: 14px; line-height: 22px;">
                  <strong>Importante:</strong> Por seguridad, deberás cambiar tu contraseña la primera vez que inicies sesión en la plataforma. Al entrar, se te mostrará una pantalla para establecer una nueva contraseña.
                </p>
              </div>

              <!-- Onboarding -->
              <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px; margin: 0 0 32px 0;">
                <p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 22px;">
                  <strong>Pasos siguientes:</strong> Al iniciar sesión por primera vez, deberás completar tu registro dentro de la plataforma:
                </p>
                <ol style="margin: 8px 0 0 20px; padding: 0; color: #1e40af; font-size: 14px; line-height: 22px;">
                  <li>Aceptar los términos y condiciones.</li>
                  <li>Subir los documentos requeridos según tu tipo de persona.</li>
                  <li>Firmar digitalmente el contrato de colaboración con un código OTP.</li>
                </ol>
                <p style="margin: 8px 0 0 0; color: #1e40af; font-size: 13px; line-height: 20px;">
                  Una vez que subas tus documentos, tu ejecutivo de cuenta los revisará y aprobará. Al firmar el contrato, tu cuenta quedará activa para publicar tours.
                </p>
              </div>

              <!-- Botón login -->
              <div style="text-align: center; margin-bottom: 40px;">
                <a href="${appUrl}/login"
                   style="display: inline-block; padding: 15px 40px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Acceder a la plataforma
                </a>
              </div>

              <!-- Documentos requeridos -->
              <div style="border-top: 1px solid #e5e7eb; padding-top: 32px;">
                <h2 style="margin: 0 0 8px 0; color: #111827; font-size: 18px; font-weight: 700;">Documentos requeridos para aprobación</h2>
                <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 14px; line-height: 22px;">
                  Para activar tu cuenta y comenzar a publicar tours, necesitamos que nos envíes los siguientes documentos según tu tipo de persona:
                </p>

                <!-- Persona Física -->
                <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px;">
                  <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Persona Física</p>
                  <table role="presentation" style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Constancia de Situación Fiscal (CSF) vigente</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• INE / Pasaporte del titular</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Comprobante de domicilio</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Datos de contacto del responsable (teléfono y correo)</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Redes sociales de la agencia y página web</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Carátula / estado de cuenta con CLABE a nombre del titular</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Aceptación y firma del contrato</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• RNT (opcional pero recomendable)</td></tr>
                  </table>
                </div>

                <!-- Persona Moral -->
                <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px;">
                  <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Persona Moral</p>
                  <table role="presentation" style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Acta constitutiva (o documento equivalente)</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Poder del representante legal</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Registro Público de Comercio</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• INE / Pasaporte del representante legal</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Constancia de Situación Fiscal (CSF) vigente</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Comprobante de domicilio</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Datos de contacto del responsable (teléfono y correo)</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Redes sociales de la agencia y página web</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• Carátula / estado de cuenta con CLABE a nombre de la empresa</td></tr>
                    <tr><td style="padding: 5px 0; color: #4b5563; font-size: 14px; line-height: 20px;">• RNT (opcional pero recomendable)</td></tr>
                  </table>
                </div>

                <!-- Cómo enviar documentos -->
                <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px 24px;">
                  <p style="margin: 0 0 8px 0; color: #166534; font-size: 14px; font-weight: 700;">¿Cómo enviar tus documentos?</p>
                  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 14px; line-height: 22px;">
                    Envía tus documentos directamente a tu Ejecutivo de Cuenta asignado con copia a nuestro equipo de agencias:
                  </p>
                  <p style="margin: 0 0 6px 0; color: #374151; font-size: 14px;">
                    <strong>Tu Ejecutivo de Cuenta:</strong>
                    <a href="mailto:${executiveEmail}" style="color: #dc2626; text-decoration: none; font-weight: 600;">${executiveName} &lt;${executiveEmail}&gt;</a>
                  </p>
                  <p style="margin: 0; color: #374151; font-size: 14px;">
                    <strong>Con copia a:</strong>
                    <a href="mailto:agencias@toursred.com.mx" style="color: #dc2626; text-decoration: none; font-weight: 600;">agencias@toursred.com.mx</a>
                  </p>
                </div>
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

    const textContent = `¡Bienvenidos a ToursRed! - ${agencyName}

Hola ${displayName},

Nos complace darte la bienvenida a la plataforma ToursRed. Tu agencia "${agencyName}" ha sido registrada exitosamente.

CREDENCIALES DE ACCESO
----------------------
Correo electrónico: ${email}
Contraseña temporal: ${password}

IMPORTANTE: Por seguridad, deberás cambiar tu contraseña la primera vez que inicies sesión.

Accede a la plataforma en: ${appUrl}/login

PASOS SIGUIENTES DENTRO DE LA PLATAFORMA:
1. Aceptar los términos y condiciones.
2. Subir los documentos requeridos según tu tipo de persona.
3. Firmar digitalmente el contrato de colaboración con un código OTP.

Una vez que subas tus documentos, tu ejecutivo de cuenta los revisará y aprobará.


DOCUMENTOS REQUERIDOS PARA APROBACIÓN
======================================

PERSONA FÍSICA:
- Constancia de Situación Fiscal (CSF) vigente
- INE / Pasaporte del titular
- Comprobante de domicilio
- Datos de contacto del responsable (teléfono y correo)
- Redes sociales de la agencia y página web
- Carátula / estado de cuenta con CLABE a nombre del titular
- Aceptación y firma del contrato
- RNT (opcional pero recomendable)

PERSONA MORAL:
- Acta constitutiva (o documento equivalente)
- Poder del representante legal
- Registro Público de Comercio
- INE / Pasaporte del representante legal
- Constancia de Situación Fiscal (CSF) vigente
- Comprobante de domicilio
- Datos de contacto del responsable (teléfono y correo)
- Redes sociales de la agencia y página web
- Carátula / estado de cuenta con CLABE a nombre de la empresa
- RNT (opcional pero recomendable)

¿CÓMO ENVIAR TUS DOCUMENTOS?
------------------------------
Envía tus documentos a tu Ejecutivo de Cuenta:
  ${executiveName} <${executiveEmail}>

Con copia a: agencias@toursred.com.mx


¿Tienes dudas? Escríbenos a ${fromEmail}

© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.`;

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: emailSettings.smtp_api_key,
        sender: `ToursRed <${fromEmail}>`,
        to: [email],
        subject: `¡Bienvenidos a ToursRed! Credenciales de acceso - ${agencyName}`,
        html_body: htmlContent,
        text_body: textContent,
      }),
    });

    const result = await response.json();
    console.log("SMTP2GO response:", JSON.stringify(result));

    if (!response.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO error: ${response.status}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Credenciales enviadas a la agencia" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-agency-credentials:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
