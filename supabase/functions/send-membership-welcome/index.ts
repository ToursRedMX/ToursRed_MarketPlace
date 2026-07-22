import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MembershipWelcomeData {
  email: string;
  firstName: string;
  planType: 'monthly' | 'annual';
  startDate: string;
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

    const { email, firstName, planType, startDate, endDate }: MembershipWelcomeData = await req.json();

    if (!email || !firstName || !planType || !startDate || !endDate) {
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

    const { data: platformSettings, error: platformError } = await supabase
      .from("platform_settings")
      .select("membership_monthly_price, membership_annual_price, platform_url")
      .maybeSingle();

    if (platformError || !platformSettings) {
      console.error("Error fetching platform settings:", platformError);
      return new Response(
        JSON.stringify({ error: "Error al obtener configuración de precios" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const appUrl = platformSettings.platform_url || "https://toursredmx.netlify.app";
    const monthlyPrice = parseFloat(platformSettings.membership_monthly_price) || 49;
    const annualPrice = parseFloat(platformSettings.membership_annual_price) || 490;
    const annualSavings = (monthlyPrice * 12) - annualPrice;

    const planName = planType === 'monthly' ? 'Mensual' : 'Anual';
    const planPrice = planType === 'monthly' ? `$${monthlyPrice.toFixed(0)} MXN/mes` : `$${annualPrice.toFixed(0)} MXN/año`;

    const formattedStartDate = new Date(startDate).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const formattedEndDate = new Date(endDate).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const monthlyBenefits = `
✓ Exención de $500 MXN mensuales en Cargos por Servicio en reservas nacionales
  Ahorra en comisiones cada mes

✓ Ahorra hasta un 5% en cada Reserva Nacional
  Descuento aplicado automáticamente en tours dentro de México

✓ Acceso prioritario a nuevos tours
  Sé el primero en reservar experiencias exclusivas

✓ Soporte premium
  Atención preferencial para miembros ToursRed+
`;

    const annualBenefits = `
✓ Todo lo del plan mensual incluido
  Exención de $500 MXN mensuales + 5% de descuento + acceso prioritario + soporte premium

✓ 2 meses gratis de la membresía
  Paga 10 meses y recibe 12 meses completos

✓ Descuentos exclusivos en tours selectos
  Ofertas especiales adicionales en experiencias seleccionadas

✓ Invitaciones a eventos especiales
  Acceso VIP a eventos y experiencias exclusivas para miembros anuales
`;

    const benefitsText = planType === 'monthly' ? monthlyBenefits : annualBenefits;

    const textContent = `
¡Bienvenido a ToursRed+ ${firstName}!

Gracias por unirte a ToursRed+. Tu membresía ha sido activada exitosamente.

DETALLES DE TU MEMBRESÍA:
Plan: ${planName}
Precio: ${planPrice}
Fecha de inicio: ${formattedStartDate}
Fecha de renovación: ${formattedEndDate}

BENEFICIOS INCLUIDOS:
${benefitsText}

RENOVACIÓN AUTOMÁTICA:
Tu membresía se renovará automáticamente el ${formattedEndDate}.
Te enviaremos un recordatorio 5 días antes de la fecha de renovación.
Si deseas cancelar, puedes hacerlo en cualquier momento desde tu perfil.

COMIENZA A DISFRUTAR:
1. Explora nuestro catálogo de tours
2. Reserva con tus beneficios de miembro
3. Ahorra en cada reserva

¿Tienes preguntas?
Nuestro equipo de soporte está disponible en: contacto@toursred.com

¡Disfruta de tu membresía ToursRed+!

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
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .plus-badge { display: inline-block; background: white; color: #f59e0b; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 18px; margin-top: 10px; }
    .content { background-color: #f9fafb; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .welcome-box { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 25px; border-radius: 10px; margin: 20px 0; text-align: center; border: 2px solid #f59e0b; }
    .welcome-box h2 { color: #92400e; margin: 0 0 10px 0; font-size: 28px; }
    .membership-details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #e5e7eb; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: bold; color: #6b7280; }
    .detail-value { color: #1f2937; }
    .benefits-section { margin: 25px 0; }
    .benefit-item { background-color: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #f59e0b; display: flex; align-items: flex-start; }
    .benefit-icon { font-size: 24px; margin-right: 15px; }
    .benefit-content h4 { margin: 0 0 5px 0; color: #f59e0b; font-size: 16px; }
    .benefit-content p { margin: 0; color: #6b7280; font-size: 14px; }
    .renewal-box { background-color: #dbeafe; padding: 20px; border-left: 4px solid #3b82f6; margin: 20px 0; border-radius: 6px; }
    .renewal-box h3 { color: #1e40af; margin-top: 0; }
    .renewal-box p { color: #1e3a8a; margin: 5px 0; }
    .cta-section { background-color: white; padding: 25px; margin: 20px 0; border-radius: 8px; text-align: center; border: 2px solid #f59e0b; }
    .cta-section h3 { color: #f59e0b; margin-top: 0; }
    .button { display: inline-block; padding: 15px 30px; background-color: #f59e0b; color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; font-weight: bold; }
    .button:hover { background-color: #d97706; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; margin-top: 20px; }
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"header\">
      <img src=\"https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png\" alt=\"ToursRed Logo\" class=\"logo\" />
      <div class=\"plus-badge\">ToursRed+</div>
      <h1 style=\"margin: 15px 0 5px 0;\">¡Bienvenido a ToursRed+!</h1>
      <p style=\"margin: 0; font-size: 16px; opacity: 0.9;\">Tu membresía premium ha sido activada</p>
    </div>

    <div class=\"content\">
      <div class=\"welcome-box\">
        <h2>¡Hola ${firstName}!</h2>
        <p style=\"font-size: 16px; color: #78350f; margin: 10px 0;\">Gracias por unirte a ToursRed+. Ahora eres parte de nuestra comunidad premium de viajeros.</p>
      </div>

      <div class=\"membership-details\">
        <h3 style=\"color: #f59e0b; margin-top: 0; text-align: center;\">Detalles de tu Membresía</h3>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Plan:</span>
          <span class=\"detail-value\"><strong>${planName}</strong></span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Precio:</span>
          <span class=\"detail-value\"><strong>${planPrice}</strong></span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Fecha de inicio:</span>
          <span class=\"detail-value\">${formattedStartDate}</span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Próxima renovación:</span>
          <span class=\"detail-value\"><strong>${formattedEndDate}</strong></span>
        </div>
      </div>

      <div class=\"benefits-section\">
        <h2 style=\"color: #f59e0b; text-align: center;\">Tus Beneficios Exclusivos</h2>

        ${planType === 'monthly' ? `
        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">💰</div>
          <div class=\"benefit-content\">
            <h4>Exención de $500 MXN mensuales</h4>
            <p>Ahorra en Cargos por Servicio en reservas nacionales cada mes</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">🎯</div>
          <div class=\"benefit-content\">
            <h4>Ahorra hasta un 5% en cada Reserva Nacional</h4>
            <p>Descuento aplicado automáticamente en tours dentro de México</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">⚡</div>
          <div class=\"benefit-content\">
            <h4>Acceso prioritario a nuevos tours</h4>
            <p>Sé el primero en reservar experiencias exclusivas</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">🎧</div>
          <div class=\"benefit-content\">
            <h4>Soporte premium</h4>
            <p>Atención preferencial para miembros ToursRed+</p>
          </div>
        </div>
        ` : `
        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">✨</div>
          <div class=\"benefit-content\">
            <h4>Todo lo del plan mensual incluido</h4>
            <p>Exención de $500 MXN mensuales + 5% de descuento + acceso prioritario + soporte premium</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">🎁</div>
          <div class=\"benefit-content\">
            <h4>2 meses gratis de la membresía</h4>
            <p>Paga 10 meses y recibe 12 meses completos</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">🏆</div>
          <div class=\"benefit-content\">
            <h4>Descuentos exclusivos en tours selectos</h4>
            <p>Ofertas especiales adicionales en experiencias seleccionadas</p>
          </div>
        </div>

        <div class=\"benefit-item\">
          <div class=\"benefit-icon\">🎉</div>
          <div class=\"benefit-content\">
            <h4>Invitaciones a eventos especiales</h4>
            <p>Acceso VIP a eventos y experiencias exclusivas para miembros anuales</p>
          </div>
        </div>
        `}
      </div>

      <div class=\"renewal-box\">
        <h3>📅 Renovación Automática</h3>
        <p>Tu membresía se renovará automáticamente el <strong>${formattedEndDate}</strong>.</p>
        <p>Te enviaremos un recordatorio 5 días antes de la fecha de renovación.</p>
        <p style=\"margin-top: 10px;\">Si deseas cancelar tu membresía, puedes hacerlo en cualquier momento desde tu perfil. Tu acceso continuará hasta el final del período pagado.</p>
      </div>

      <div class=\"cta-section\">
        <h3>¡Comienza a Disfrutar tus Beneficios!</h3>
        <a href=\"${appUrl}/tours\" class=\"button\">Explorar Tours</a>
        <a href=\"${appUrl}/traveler/membership\" class=\"button\" style=\"background-color: #6b7280;\">Ver mi Membresía</a>
      </div>

      <p style=\"text-align: center; color: #6b7280; margin-top: 30px;\">
        ¿Tienes preguntas sobre tu membresía?<br>
        Estamos aquí para ayudarte: <a href=\"mailto:contacto@toursred.com\" style=\"color: #f59e0b;\">contacto@toursred.com</a>
      </p>

      <p style=\"text-align: center; margin-top: 30px; font-size: 18px; color: #f59e0b;\">
        <strong>¡Disfruta de tu membresía ToursRed+!</strong>
      </p>
    </div>

    <div class=\"footer\">
      <p><strong>Equipo ToursRed</strong></p>
      <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
      <p>Para soporte, contacta a: contacto@toursred.com</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: "no-reply@toursred.com",
      subject: `¡Bienvenido a ToursRed+ ${firstName}! 🌟`,
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending membership welcome email via SMTP2GO API...");

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

    console.log("Membership welcome email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email de bienvenida enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending membership welcome email:", error);
    return new Response(
      JSON.stringify({ error: "Error al enviar el email de bienvenida", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});