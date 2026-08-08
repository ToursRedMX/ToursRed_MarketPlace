import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PaymentFailedEmailData {
  email: string;
  firstName: string;
  planType: 'monthly' | 'annual';
  nextAttemptDate: string | null;
  amountDue: number | null;
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

    const { email, firstName, planType, nextAttemptDate, amountDue }: PaymentFailedEmailData = await req.json();

    if (!email || !firstName || !planType) {
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
        JSON.stringify({ error: "Error al obtener configuracion de email" }),
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
    const planPrice = planType === 'monthly' ? '$49 MXN/mes' : '$490 MXN/ano';
    const hasRetry = nextAttemptDate !== null;

    const formattedNextAttempt = hasRetry
      ? new Date(nextAttemptDate!).toLocaleDateString('es-MX', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';

    const amountText = amountDue !== null && amountDue !== undefined
      ? `$${amountDue.toFixed(2)} MXN`
      : '';

    const subject = hasRetry
      ? "Hubo un problema con tu pago de ToursRed+"
      : "Accion requerida: tu membresia ToursRed+ esta en riesgo";

    const textContent = hasRetry
      ? `Hola ${firstName},

Hubo un problema al procesar el pago de tu membresia ToursRed+.

DETALLES DEL PAGO:
${amountText ? `- Monto: ${amountText}` : ''}
- Plan: ${planName} (${planPrice})

NO TE PREOCUPES:
Stripe reintentara automaticamente el cobro el ${formattedNextAttempt}.

QUE DEBES HACER?
Te recomendamos actualizar tu metodo de pago antes de la fecha del reintento para evitar interrupciones en tu membresia:
1. Inicia sesion en tu cuenta de ToursRed
2. Ve a "Mi Membresia"
3. Actualiza tu metodo de pago

Si el pago se procesa correctamente en el reintento, no necesitas hacer nada mas.

Saludos,
Equipo ToursRed`
      : `Hola ${firstName},

IMPORTANTE: El ultimo intento de cobro de tu membresia ToursRed+ ha fallado.

DETALLES DEL PAGO:
${amountText ? `- Monto: ${amountText}` : ''}
- Plan: ${planName} (${planPrice})

ACCION REQUERIDA:
Este fue el ultimo intento de cobro automatico. Si no actualizas tu metodo de pago, tu membresia ToursRed+ sera cancelada y perderas acceso a todos los beneficios:
- Exencion de $500 MXN mensuales en Cargos por Servicio
- Ahorro de hasta un 5% en cada Reserva Nacional
- Acceso prioritario a nuevos tours
- Soporte premium

COMO ACTUALIZAR TU METODO DE PAGO:
1. Inicia sesion en tu cuenta de ToursRed
2. Ve a "Mi Membresia"
3. Actualiza tu metodo de pago lo antes posible

Saludos,
Equipo ToursRed`;

    const alertBg = hasRetry ? '#fef3c7' : '#fee2e2';
    const alertBorder = hasRetry ? '#f59e0b' : '#ef4444';
    const alertTitleColor = hasRetry ? '#92400e' : '#991b1b';
    const alertTextColor = hasRetry ? '#78350f' : '#7f1d1d';
    const alertTitle = hasRetry ? 'Hubo un problema con tu pago' : 'Ultimo intento de cobro fallido';
    const alertBody = hasRetry
      ? 'no se pudo procesar el pago de tu membresia ToursRed+.'
      : 'el ultimo intento de cobro de tu membresia ToursRed+ ha fallado.';
    const headerTitle = hasRetry ? 'Problema con tu Pago' : 'Accion Requerida';
    const headerSubtitle = hasRetry ? 'Tu cobro no se pudo procesar' : 'Tu membresia esta en riesgo';

    const retrySection = hasRetry ? `
      <div class="info-box">
        <h3>Que pasara ahora?</h3>
        <p>No te preocupes. <strong>Stripe reintentara automaticamente</strong> el cobro el <strong>${formattedNextAttempt}</strong>.</p>
        <p>Te recomendamos actualizar tu metodo de pago antes de esa fecha para asegurar que el proximo intento se procese correctamente.</p>
      </div>` : `
      <div class="info-box">
        <h3>Tu membresia esta en riesgo</h3>
        <p>Este fue el <strong>ultimo intento</strong> de cobro automatico. Si no actualizas tu metodo de pago, tu membresia ToursRed+ sera cancelada y <strong>perderas acceso a:</strong></p>
        <ul>
          <li>Exencion de $500 MXN mensuales en Cargos por Servicio</li>
          <li>Descuentos exclusivos del 5% en reservas nacionales</li>
          <li>Acceso prioritario a nuevos tours</li>
          <li>Soporte premium</li>
        </ul>
      </div>`;

    const stepsTitle = hasRetry ? 'Actualiza tu metodo de pago' : 'Actualiza tu metodo de pago ahora';
    const stepsReason = hasRetry ? 'evitar interrupciones' : 'evitar la cancelacion de tu membresia';
    const buttonText = hasRetry ? 'Actualizar metodo de pago' : 'Salvar mi membresia';
    const closingMsg = hasRetry ? 'Gracias por ser parte de ToursRed+' : 'No dejes que tu membresia se cancele!';

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); color: white; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .plus-badge { display: inline-block; background: white; color: #6b7280; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 18px; margin-top: 10px; }
    .content { background-color: #f9fafb; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .alert-box { background-color: ${alertBg}; padding: 25px; border-radius: 10px; margin: 20px 0; text-align: center; border: 2px solid ${alertBorder}; }
    .alert-box h2 { color: ${alertTitleColor}; margin: 0 0 10px 0; font-size: 24px; }
    .alert-box p { color: ${alertTextColor}; margin: 10px 0; }
    .info-box { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #3b82f6; }
    .info-box h3 { color: #1e40af; margin-top: 0; }
    .info-box ul { margin: 10px 0 10px 20px; color: #374151; }
    .info-box ul li { padding: 5px 0; }
    .steps-box { background-color: #d1fae5; padding: 20px; border-left: 4px solid #10b981; margin: 20px 0; border-radius: 6px; }
    .steps-box h3 { color: #065f46; margin-top: 0; }
    .steps-box ol { color: #059669; margin: 10px 0 10px 20px; }
    .steps-box ol li { padding: 5px 0; }
    .button { display: inline-block; padding: 15px 30px; color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; font-weight: bold; }
    .button-primary { background-color: #10b981; }
    .button-primary:hover { background-color: #059669; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <div class="plus-badge">ToursRed+</div>
      <h1 style="margin: 15px 0 5px 0;">${headerTitle}</h1>
      <p style="margin: 0; font-size: 16px; opacity: 0.9;">${headerSubtitle}</p>
    </div>
    <div class="content">
      <div class="alert-box">
        <h2>${alertTitle}</h2>
        <p style="font-size: 16px;">Hola ${firstName}, ${alertBody}</p>
      </div>
      <div class="info-box">
        <h3>Detalles del Pago</h3>
        ${amountText ? `<p><strong>Monto:</strong> ${amountText}</p>` : ''}
        <p><strong>Plan:</strong> ${planName}</p>
        <p><strong>Precio:</strong> ${planPrice}</p>
        ${hasRetry ? `<p><strong>Fecha del proximo intento:</strong> <strong style="color: #f59e0b;">${formattedNextAttempt}</strong></p>` : ''}
      </div>
      ${retrySection}
      <div class="steps-box">
        <h3>${stepsTitle}</h3>
        <p>Para ${stepsReason}, sigue estos pasos:</p>
        <ol>
          <li>Inicia sesion en tu cuenta de ToursRed</li>
          <li>Ve a "Mi Membresia"</li>
          <li>Actualiza tu metodo de pago</li>
        </ol>
        <div style="text-align: center; margin-top: 20px;">
          <a href="${appUrl}/traveler/membership" class="button button-primary">${buttonText}</a>
        </div>
      </div>
      <p style="text-align: center; margin-top: 30px; font-size: 18px; color: #6b7280;">
        <strong>${closingMsg}</strong>
      </p>
    </div>
    <div class="footer">
      <p><strong>Equipo ToursRed</strong></p>
      <p>Este es un correo automatico.</p>
      <p>Si tienes preguntas, contacta a: contacto@toursred.com</p>
    </div>
  </div>
</body>
</html>`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: "no-reply@toursred.com",
      subject,
      text_body: textContent,
      html_body: htmlContent,
    };

    console.log("Sending membership payment failed email via SMTP2GO API...");

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

    console.log("Payment failed email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email de pago fallido enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending payment failed email:", error);
    return new Response(
      JSON.stringify({ error: "Error al enviar el email de pago fallido", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
