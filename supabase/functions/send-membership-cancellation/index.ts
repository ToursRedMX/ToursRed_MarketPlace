import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CancellationEmailData {
  email: string;
  firstName: string;
  planType: 'monthly' | 'annual';
  endDate: string;
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

    const { email, firstName, planType, endDate }: CancellationEmailData = await req.json();

    if (!email || !firstName || !planType || !endDate) {
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

    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const planName = planType === 'monthly' ? 'Mensual' : 'Anual';
    const planPrice = planType === 'monthly' ? '$49 MXN/mes' : '$490 MXN/año';

    const formattedEndDate = new Date(endDate).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const textContent = `
Hola ${firstName},

Tu membresía ToursRed+ ha sido cancelada.

CONFIRMACIÓN DE CANCELACIÓN:

Hemos recibido tu solicitud de cancelación de la renovación automática de tu membresía ToursRed+.

IMPORTANTE:
- Tu membresía permanecerá activa hasta el ${formattedEndDate}
- Podrás seguir disfrutando de todos los beneficios hasta esa fecha:
  ✓ Exención de $500 MXN mensuales en Cargos por Servicio
  ✓ Ahorra hasta un 5% en cada Reserva Nacional
  ✓ Acceso prioritario a nuevos tours
  ✓ Soporte premium

DESPUÉS DEL ${formattedEndDate.toUpperCase()}:
Tu membresía no se renovará automáticamente y perderás acceso a:
- Ahorro en cargos por servicio (hasta $500 MXN/mes)
- Descuentos exclusivos del 5% en reservas nacionales
- Soporte prioritario
- Ofertas especiales para miembros

¡LAMENTAMOS VERTE PARTIR!

Nos gustaría saber qué podemos mejorar. Si tienes algún comentario, no dudes en compartirlo con nosotros en: contacto@toursred.com

¿CAMBIASTE DE OPINIÓN?

Puedes reactivar tu membresía en cualquier momento antes del ${formattedEndDate}:
1. Inicia sesión en tu cuenta de ToursRed
2. Ve a "Mi Perfil" > "Membresía"
3. Haz clic en "Reactivar Renovación Automática"

Si decides reactivar tu membresía, continuarás disfrutando sin interrupciones de todos los beneficios ToursRed+.

TAMBIÉN PUEDES VOLVER CUANDO QUIERAS:

Si no reactivas tu membresía antes del ${formattedEndDate}, siempre serás bienvenido para suscribirte nuevamente cuando lo desees. Tus datos y preferencias se mantendrán guardados.

Gracias por haber sido parte de ToursRed+. ¡Esperamos verte pronto!

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
    .header { background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); color: white; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .plus-badge { display: inline-block; background: white; color: #6b7280; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 18px; margin-top: 10px; }
    .content { background-color: #f9fafb; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .cancellation-box { background-color: #fee2e2; padding: 25px; border-radius: 10px; margin: 20px 0; text-align: center; border: 2px solid #ef4444; }
    .cancellation-box h2 { color: #991b1b; margin: 0 0 10px 0; font-size: 24px; }
    .cancellation-box p { color: #7f1d1d; margin: 10px 0; }
    .info-box { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #3b82f6; }
    .info-box h3 { color: #1e40af; margin-top: 0; }
    .info-box ul { margin: 10px 0 10px 20px; color: #374151; }
    .info-box ul li { padding: 5px 0; }
    .warning-box { background-color: #fef3c7; padding: 20px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 6px; }
    .warning-box h3 { color: #92400e; margin-top: 0; }
    .warning-box p { color: #78350f; margin: 10px 0; }
    .sad-box { background-color: #f3f4f6; padding: 25px; border-radius: 10px; margin: 20px 0; text-align: center; }
    .sad-box h3 { color: #374151; margin-top: 0; }
    .sad-box p { color: #6b7280; margin: 10px 0; }
    .reactivate-box { background-color: #d1fae5; padding: 20px; border-left: 4px solid #10b981; margin: 20px 0; border-radius: 6px; }
    .reactivate-box h3 { color: #065f46; margin-top: 0; }
    .reactivate-box p { color: #047857; margin: 10px 0; }
    .reactivate-box ol { color: #059669; margin: 10px 0 10px 20px; }
    .reactivate-box ol li { padding: 5px 0; }
    .button { display: inline-block; padding: 15px 30px; color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; font-weight: bold; }
    .button-primary { background-color: #10b981; }
    .button-primary:hover { background-color: #059669; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; margin-top: 20px; }
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"header\">
      <img src=\"https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png\" alt=\"ToursRed Logo\" class=\"logo\" />
      <div class=\"plus-badge\">ToursRed+</div>
      <h1 style=\"margin: 15px 0 5px 0;\">Cancelación de Membresía</h1>
      <p style=\"margin: 0; font-size: 16px; opacity: 0.9;\">Tu renovación automática ha sido cancelada</p>
    </div>

    <div class=\"content\">
      <div class=\"cancellation-box\">
        <h2>❌ Confirmación de Cancelación</h2>
        <p style=\"font-size: 16px;\">Hola ${firstName}, hemos recibido tu solicitud de cancelación de la renovación automática.</p>
      </div>

      <div class=\"info-box\">
        <h3>📋 Detalles de tu Membresía</h3>
        <p><strong>Plan:</strong> ${planName}</p>
        <p><strong>Precio:</strong> ${planPrice}</p>
        <p><strong>Tu membresía permanecerá activa hasta:</strong> <strong style=\"color: #3b82f6;\">${formattedEndDate}</strong></p>
        <p style=\"margin-top: 15px;\">Podrás seguir disfrutando de todos tus beneficios hasta el ${formattedEndDate}:</p>
        <ul>
          <li>✓ Exención de $500 MXN mensuales en Cargos por Servicio</li>
          <li>✓ Ahorra hasta un 5% en cada Reserva Nacional</li>
          <li>✓ Acceso prioritario a nuevos tours</li>
          <li>✓ Soporte premium</li>
        </ul>
      </div>

      <div class=\"warning-box\">
        <h3>⚠️ Después del ${formattedEndDate}</h3>
        <p>Tu membresía no se renovará automáticamente y <strong>perderás acceso a:</strong></p>
        <ul style=\"margin: 10px 0 10px 20px; color: #78350f;\">
          <li>Ahorro en cargos por servicio (hasta $500 MXN/mes)</li>
          <li>Descuentos exclusivos del 5% en reservas nacionales</li>
          <li>Soporte prioritario</li>
          <li>Ofertas especiales para miembros</li>
        </ul>
      </div>

      <div class=\"sad-box\">
        <h3>😢 ¡Lamentamos Verte Partir!</h3>
        <p>Nos gustaría saber qué podemos mejorar para ofrecerte una mejor experiencia.</p>
        <p>Si tienes algún comentario o sugerencia, no dudes en compartirlo con nosotros.</p>
        <p style=\"margin-top: 15px;\">
          <a href=\"mailto:contacto@toursred.com\" style=\"color: #3b82f6; text-decoration: underline;\">Enviar comentarios</a>
        </p>
      </div>

      <div class=\"reactivate-box\">
        <h3>🔄 ¿Cambiaste de Opinión?</h3>
        <p><strong>Buenas noticias:</strong> Puedes reactivar tu membresía en cualquier momento antes del ${formattedEndDate}.</p>
        <p>Sigue estos simples pasos:</p>
        <ol>
          <li>Inicia sesión en tu cuenta de ToursRed</li>
          <li>Ve a "Mi Perfil" > "Membresía"</li>
          <li>Haz clic en "Reactivar Renovación Automática"</li>
        </ol>
        <p style=\"margin-top: 15px;\">Si reactivas tu membresía, <strong>continuarás disfrutando sin interrupciones</strong> de todos los beneficios ToursRed+.</p>
        <div style=\"text-align: center; margin-top: 20px;\">
          <a href=\"${appUrl}/traveler/membership\" class=\"button button-primary\">Reactivar mi Membresía</a>
        </div>
      </div>

      <div style=\"background-color: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;\">
        <h3 style=\"color: #3730a3; margin-top: 0;\">💙 Siempre Serás Bienvenido</h3>
        <p style=\"color: #4338ca; margin: 10px 0;\">
          Si no reactivas tu membresía antes del ${formattedEndDate}, puedes volver a suscribirte cuando lo desees.
        </p>
        <p style=\"color: #4338ca; margin: 10px 0;\">
          Tus datos y preferencias se mantendrán guardados para cuando decidas volver.
        </p>
        <div style=\"margin-top: 20px;\">
          <a href=\"${appUrl}/traveler/membership\" class=\"button\" style=\"background-color: #6366f1;\">Ver Planes de Membresía</a>
        </div>
      </div>

      <p style=\"text-align: center; margin-top: 30px; font-size: 18px; color: #6b7280;\">
        <strong>Gracias por haber sido parte de ToursRed+</strong>
      </p>
      <p style=\"text-align: center; font-size: 16px; color: #9ca3af;\">
        ¡Esperamos verte pronto!
      </p>
    </div>

    <div class=\"footer\">
      <p><strong>Equipo ToursRed</strong></p>
      <p>Este es un correo de confirmación automático.</p>
      <p>Si tienes preguntas, contacta a: contacto@toursred.com</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: "no-reply@toursred.com",
      subject: `Confirmación de Cancelación - ToursRed+ (Activo hasta ${formattedEndDate})`,
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending membership cancellation email via SMTP2GO API...");

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

    console.log("Cancellation email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email de cancelación enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending cancellation email:", error);
    return new Response(
      JSON.stringify({ error: "Error al enviar el email de cancelación", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});