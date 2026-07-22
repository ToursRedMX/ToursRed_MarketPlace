import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RenewalReminderData {
  email: string;
  firstName: string;
  planType: 'monthly' | 'annual';
  renewalDate: string;
  amount: string;
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

    const { email, firstName, planType, renewalDate, amount }: RenewalReminderData = await req.json();

    if (!email || !firstName || !planType || !renewalDate || !amount) {
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

    const formattedRenewalDate = new Date(renewalDate).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const monthlyBenefitsText = `
✓ Exención de $500 MXN mensuales en Cargos por Servicio en reservas nacionales
✓ Ahorra hasta un 5% en cada Reserva Nacional
✓ Acceso prioritario a nuevos tours
✓ Soporte premium
`;

    const annualBenefitsText = `
✓ Todo lo del plan mensual (Exención de $500 MXN + 5% descuento + acceso prioritario + soporte premium)
✓ 2 meses gratis de la membresía
✓ Descuentos exclusivos en tours selectos
✓ Invitaciones a eventos especiales
`;

    const benefitsText = planType === 'monthly' ? monthlyBenefitsText : annualBenefitsText;

    const textContent = `
Hola ${firstName},

Tu membresía ToursRed+ está próxima a renovarse.

RECORDATORIO DE RENOVACIÓN:

Tu membresía ToursRed+ (Plan ${planName}) se renovará automáticamente el ${formattedRenewalDate}.

DETALLES DE LA RENOVACIÓN:
- Plan: ${planName}
- Monto: ${amount}
- Fecha de renovación: ${formattedRenewalDate}
- Método de pago: Tarjeta registrada en tu cuenta

IMPORTANTE - AVISO LEGAL:
De acuerdo con la normativa vigente, te informamos que si no cancelas tu membresía antes del ${formattedRenewalDate}, se realizará automáticamente el cargo de ${amount} a tu forma de pago registrada y tu membresía se renovará por el período contratado (${planName.toLowerCase()}).

¿DESEAS CANCELAR TU MEMBRESÍA?

Si no deseas que tu membresía se renueve automáticamente, puedes cancelarla en cualquier momento antes de la fecha de renovación siguiendo estos pasos:

1. Inicia sesión en tu cuenta de ToursRed
2. Ve a "Mi Perfil" > "Membresía"
3. Haz clic en "Cancelar Membresía"

IMPORTANTE: Si cancelas tu membresía, mantendrás acceso a todos tus beneficios hasta el ${formattedRenewalDate}. No se realizarán reembolsos por el tiempo restante.

¿DESEAS CONTINUAR CON TU MEMBRESÍA?

¡Excelente! No necesitas hacer nada. El cargo se procesará automáticamente y seguirás disfrutando de:

${benefitsText}

¿Tienes preguntas?
Contáctanos en: contacto@toursred.com

Gracias por ser parte de ToursRed+

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
    .header { background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .plus-badge { display: inline-block; background: white; color: #3b82f6; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 18px; margin-top: 10px; }
    .content { background-color: #f9fafb; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .reminder-box { background-color: #dbeafe; padding: 25px; border-radius: 10px; margin: 20px 0; text-align: center; border: 2px solid #3b82f6; }
    .reminder-box h2 { color: #1e40af; margin: 0 0 10px 0; font-size: 24px; }
    .renewal-details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #e5e7eb; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: bold; color: #6b7280; }
    .detail-value { color: #1f2937; }
    .legal-notice { background-color: #fef3c7; padding: 20px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 6px; }
    .legal-notice h3 { color: #92400e; margin-top: 0; }
    .legal-notice p { color: #78350f; margin: 10px 0; line-height: 1.8; }
    .action-section { margin: 25px 0; }
    .action-box { background-color: white; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #3b82f6; }
    .action-box h3 { color: #1e40af; margin-top: 0; }
    .action-box p { color: #6b7280; margin: 10px 0; }
    .action-box ol { color: #374151; margin: 10px 0 10px 20px; }
    .action-box ol li { padding: 5px 0; }
    .cancel-box { border-left-color: #ef4444; }
    .cancel-box h3 { color: #dc2626; }
    .continue-box { border-left-color: #10b981; }
    .continue-box h3 { color: #059669; }
    .benefits-list { margin: 15px 0; padding-left: 20px; }
    .benefits-list li { padding: 5px 0; color: #059669; }
    .button { display: inline-block; padding: 15px 30px; color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; font-weight: bold; }
    .button-primary { background-color: #3b82f6; }
    .button-primary:hover { background-color: #1e40af; }
    .button-cancel { background-color: #ef4444; }
    .button-cancel:hover { background-color: #dc2626; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; margin-top: 20px; }
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"header\">
      <img src=\"https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png\" alt=\"ToursRed Logo\" class=\"logo\" />
      <div class=\"plus-badge\">ToursRed+</div>
      <h1 style=\"margin: 15px 0 5px 0;\">Recordatorio de Renovación</h1>
      <p style=\"margin: 0; font-size: 16px; opacity: 0.9;\">Tu membresía está próxima a renovarse</p>
    </div>

    <div class=\"content\">
      <div class=\"reminder-box\">
        <h2>🔔 Hola ${firstName}</h2>
        <p style=\"font-size: 16px; color: #1e3a8a; margin: 10px 0;\">Tu membresía ToursRed+ se renovará automáticamente en 5 días.</p>
      </div>

      <div class=\"renewal-details\">
        <h3 style=\"color: #3b82f6; margin-top: 0; text-align: center;\">Detalles de la Renovación</h3>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Plan:</span>
          <span class=\"detail-value\"><strong>${planName}</strong></span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Monto a cargar:</span>
          <span class=\"detail-value\"><strong>${amount}</strong></span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Fecha de renovación:</span>
          <span class=\"detail-value\"><strong>${formattedRenewalDate}</strong></span>
        </div>
        <div class=\"detail-row\">
          <span class=\"detail-label\">Método de pago:</span>
          <span class=\"detail-value\">Tarjeta registrada</span>
        </div>
      </div>

      <div class=\"legal-notice\">
        <h3>⚠️ IMPORTANTE - Aviso Legal</h3>
        <p>De acuerdo con la normativa vigente, te informamos que:</p>
        <p><strong>Si no cancelas tu membresía antes del ${formattedRenewalDate}</strong>, se realizará automáticamente el cargo de <strong>${amount}</strong> a tu forma de pago registrada y tu membresía se renovará por el período contratado (${planName.toLowerCase()}).</p>
      </div>

      <div class=\"action-section\">
        <div class=\"action-box cancel-box\">
          <h3>❌ ¿Deseas Cancelar tu Membresía?</h3>
          <p>Si no deseas que tu membresía se renueve automáticamente, puedes cancelarla siguiendo estos pasos:</p>
          <ol>
            <li>Inicia sesión en tu cuenta de ToursRed</li>
            <li>Ve a "Mi Perfil" > "Membresía"</li>
            <li>Haz clic en "Cancelar Membresía"</li>
          </ol>
          <p style=\"color: #dc2626; margin-top: 15px;\"><strong>Importante:</strong> Si cancelas, mantendrás acceso a todos tus beneficios hasta el ${formattedRenewalDate}. No se realizarán reembolsos por el tiempo restante.</p>
          <div style=\"text-align: center; margin-top: 20px;\">
            <a href=\"${appUrl}/traveler/membership\" class=\"button button-cancel\">Gestionar mi Membresía</a>
          </div>
        </div>

        <div class=\"action-box continue-box\">
          <h3>✅ ¿Deseas Continuar con tu Membresía?</h3>
          <p><strong>¡Excelente!</strong> No necesitas hacer nada. El cargo se procesará automáticamente y seguirás disfrutando de:</p>
          <ul class=\"benefits-list\">
            ${planType === 'monthly' ? `
            <li>✓ Exención de $500 MXN mensuales en Cargos por Servicio</li>
            <li>✓ Ahorra hasta un 5% en cada Reserva Nacional</li>
            <li>✓ Acceso prioritario a nuevos tours</li>
            <li>✓ Soporte premium</li>
            ` : `
            <li>✓ Todo lo del plan mensual incluido</li>
            <li>✓ 2 meses gratis de la membresía</li>
            <li>✓ Descuentos exclusivos en tours selectos</li>
            <li>✓ Invitaciones a eventos especiales</li>
            `}
          </ul>
          <div style=\"text-align: center; margin-top: 20px;\">
            <a href=\"${appUrl}/tours\" class=\"button button-primary\">Explorar Tours</a>
          </div>
        </div>
      </div>

      <p style=\"text-align: center; color: #6b7280; margin-top: 30px;\">
        ¿Tienes preguntas sobre tu membresía o renovación?<br>
        Estamos aquí para ayudarte: <a href=\"mailto:contacto@toursred.com\" style=\"color: #3b82f6;\">contacto@toursred.com</a>
      </p>

      <p style=\"text-align: center; margin-top: 30px; font-size: 16px; color: #3b82f6;\">
        <strong>Gracias por ser parte de ToursRed+</strong>
      </p>
    </div>

    <div class=\"footer\">
      <p><strong>Equipo ToursRed</strong></p>
      <p>Este es un recordatorio automático requerido por ley.</p>
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
      subject: `⏰ Recordatorio: Tu membresía ToursRed+ se renueva el ${formattedRenewalDate}`,
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending membership renewal reminder email via SMTP2GO API...");

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

    console.log("Renewal reminder email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email de recordatorio enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending renewal reminder email:", error);
    return new Response(
      JSON.stringify({ error: "Error al enviar el email de recordatorio", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});