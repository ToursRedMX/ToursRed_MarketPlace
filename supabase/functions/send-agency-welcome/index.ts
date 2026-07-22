import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface WelcomeData {
  email: string;
  firstName: string;
  agencyName: string;
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

    const { email, firstName, agencyName }: WelcomeData = await req.json();

    if (!email || !firstName || !agencyName) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

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
¡Bienvenido a ToursRed, ${firstName}!

Gracias por registrar ${agencyName} en nuestra plataforma.

Para poder aprobar tu cuenta y que puedas comenzar a publicar tours, necesitamos que nos envíes los siguientes documentos:

PERSONA FÍSICA:
- Constancia de Situación Fiscal (CSF) vigente
- INE/Pasaporte del titular
- Comprobante de domicilio
- Datos de contacto del responsable (teléfono y correo)
- Redes Sociales de la Agencia y Página web
- Carátula/estado de cuenta con CLABE a nombre del titular (para dispersión)
- Aceptación y Firma del contrato
- RNT (Opcional pero recomendable)

PERSONA MORAL:
- Acta constitutiva (o documento equivalente)
- Poder del representante legal (si no viene claro en el acta / o para mayor certeza)
- Registro Público de Comercio
- INE/Pasaporte del representante legal
- Constancia de Situación Fiscal (CSF) vigente
- Comprobante de domicilio
- Datos de contacto del responsable (teléfono y correo)
- Redes Sociales de la Agencia y Página web
- Carátula/estado de cuenta con CLABE a nombre de la empresa (para dispersión)
- RNT (Opcional pero recomendable)

Mientras tanto, puedes:
✓ Completar tu perfil
✓ Explorar la plataforma
✓ Familiarizarte con el sistema

Una vez que recibamos y validemos tus documentos, aprobaremos tu cuenta y podrás comenzar a publicar tours.

Para cualquier duda o para agilizar el proceso, contáctanos a:
agencias@toursred.com.mx

¡Bienvenido a la familia ToursRed!

Saludos,
Equipo ToursRed
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
    .welcome-box { background-color: #dbeafe; padding: 15px; border-left: 4px solid #1e40af; margin: 20px 0; }
    .documents-section { margin: 20px 0; }
    .document-type { background-color: white; padding: 15px; margin: 15px 0; border: 1px solid #e5e7eb; border-radius: 6px; }
    .document-type h3 { color: #1e40af; margin-top: 0; }
    .document-list { list-style: none; padding-left: 0; }
    .document-list li { padding: 5px 0; padding-left: 25px; position: relative; }
    .document-list li:before { content: "•"; position: absolute; left: 10px; color: #1e40af; font-weight: bold; }
    .can-do-box { background-color: #d1fae5; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0; }
    .can-do-box ul { margin: 10px 0; }
    .contact-box { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1>¡Bienvenido a ToursRed!</h1>
    </div>
    <div class="content">
      <div class="welcome-box">
        <h2 style="margin-top: 0;">¡Hola ${firstName}!</h2>
        <p>Gracias por registrar <strong>${agencyName}</strong> en nuestra plataforma.</p>
      </div>
      
      <h2 style="color: #1e40af;">Documentos Requeridos</h2>
      <p>Para aprobar tu cuenta y que puedas comenzar a publicar tours, necesitamos que nos envíes los siguientes documentos según tu tipo de persona:</p>
      
      <div class="documents-section">
        <div class="document-type">
          <h3>👤 PERSONA FÍSICA</h3>
          <ul class="document-list">
            <li>Constancia de Situación Fiscal (CSF) vigente</li>
            <li>INE/Pasaporte del titular</li>
            <li>Comprobante de domicilio</li>
            <li>Datos de contacto del responsable (teléfono y correo)</li>
            <li>Redes Sociales de la Agencia y Página web</li>
            <li>Carátula/estado de cuenta con CLABE a nombre del titular (para dispersión)</li>
            <li>Aceptación y Firma del contrato</li>
            <li>RNT (Opcional pero recomendable)</li>
          </ul>
        </div>
        
        <div class="document-type">
          <h3>🏬 PERSONA MORAL</h3>
          <ul class="document-list">
            <li>Acta constitutiva (o documento equivalente)</li>
            <li>Poder del representante legal (si no viene claro en el acta / o para mayor certeza)</li>
            <li>Registro Público de Comercio</li>
            <li>INE/Pasaporte del representante legal</li>
            <li>Constancia de Situación Fiscal (CSF) vigente</li>
            <li>Comprobante de domicilio</li>
            <li>Datos de contacto del responsable (teléfono y correo)</li>
            <li>Redes Sociales de la Agencia y Página web</li>
            <li>Carátula/estado de cuenta con CLABE a nombre de la empresa (para dispersión)</li>
            <li>RNT (Opcional pero recomendable)</li>
          </ul>
        </div>
      </div>
      
      <div class="can-do-box">
        <h3 style="margin-top: 0; color: #10b981;">✅ Mientras tanto, puedes:</h3>
        <ul>
          <li>Completar tu perfil de agencia</li>
          <li>Explorar la plataforma</li>
          <li>Familiarizarte con el sistema</li>
        </ul>
      </div>
      
      <div class="contact-box">
        <h3 style="margin-top: 0; color: #f59e0b;">📧 Contáctanos</h3>
        <p>Para cualquier duda o para agilizar el proceso de validación:</p>
        <p><strong>Email:</strong> <a href="mailto:agencias@toursred.com.mx">agencias@toursred.com.mx</a></p>
      </div>
      
      <p style="text-align: center; margin-top: 30px; font-size: 18px; color: #1e40af;">
        <strong>¡Bienvenido a la familia ToursRed!</strong>
      </p>
    </div>
    <div class="footer">
      <p>Equipo ToursRed</p>
      <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: "no-reply@toursred.com",
      subject: "¡Bienvenido a ToursRed! - Documentos Requeridos",
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending welcome email via SMTP2GO API...");

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