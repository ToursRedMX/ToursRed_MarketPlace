import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SubscribeRequest {
  email: string;
  name?: string;
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

    const { email, name }: SubscribeRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "El email es requerido" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "El formato del email no es válido" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingSubscription } = await supabase
      .from("newsletter_subscriptions")
      .select("email, active, unsubscribe_token")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    let unsubscribeToken: string;

    if (existingSubscription) {
      if (existingSubscription.active) {
        return new Response(
          JSON.stringify({
            error: "Este email ya está suscrito a nuestro boletín",
            already_subscribed: true
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Reactivate previously unsubscribed user
      const { data: reactivated, error: reactivateError } = await supabase
        .from("newsletter_subscriptions")
        .update({
          active: true,
          unsubscribed_at: null,
          name: name || null,
        })
        .eq("email", email.toLowerCase())
        .select("unsubscribe_token")
        .single();

      if (reactivateError || !reactivated) {
        throw new Error("Error al reactivar la suscripción");
      }

      unsubscribeToken = reactivated.unsubscribe_token;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("newsletter_subscriptions")
        .insert({
          email: email.toLowerCase(),
          active: true,
          name: name || null,
        })
        .select("unsubscribe_token")
        .single();

      if (insertError || !inserted) {
        console.error("Error inserting subscription:", insertError);
        throw new Error("Error al guardar la suscripción");
      }

      unsubscribeToken = inserted.unsubscribe_token;
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

    if (settingsError || !emailSettings) {
      console.error("Error fetching email settings:", settingsError);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Suscripción guardada pero no se pudo enviar el email de confirmación"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emailSettings.smtp_api_key) {
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Suscripción guardada pero no se pudo enviar el email de confirmación"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch platform_url for unsubscribe link
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("platform_url")
      .maybeSingle();
    const platformUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const unsubscribeLink = `${platformUrl}/unsubscribe?token=${unsubscribeToken}`;

    const textContent = `
¡Bienvenido a ToursRed!

Gracias por suscribirte a nuestro boletín. A partir de ahora recibirás las últimas novedades sobre destinos, ofertas especiales y consejos de viaje directamente en tu correo.

Estamos emocionados de tenerte con nosotros y esperamos ayudarte a descubrir experiencias increíbles.

¡Felices viajes!
El equipo de ToursRed

---
Si no te suscribiste a este boletín, puedes ignorar este mensaje.
Para darte de baja visita: ${unsubscribeLink}
    `;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; color: white; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #f9fafb; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .welcome { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
    .message { margin-bottom: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .highlight { background-color: white; padding: 15px; border-left: 4px solid #1e40af; margin: 20px 0; }
    .unsubscribe-link { color: #6b7280; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">¡Bienvenido a ToursRed!</h1>
    </div>
    <div class="content">
      <div class="welcome">¡Gracias por suscribirte!</div>

      <div class="message">
        <p>Estamos emocionados de tenerte en nuestra comunidad de viajeros. A partir de ahora recibirás:</p>
      </div>

      <div class="highlight">
        <ul style="margin: 0; padding-left: 20px;">
          <li>Las últimas novedades sobre destinos increíbles</li>
          <li>Ofertas especiales y descuentos exclusivos</li>
          <li>Consejos de viaje y recomendaciones</li>
          <li>Historias inspiradoras de otros viajeros</li>
        </ul>
      </div>

      <div class="message">
        <p>¡Prepárate para descubrir experiencias inolvidables!</p>
        <p><strong>¡Felices viajes!</strong><br>El equipo de ToursRed</p>
      </div>
    </div>
    <div class="footer">
      <p>Si no te suscribiste a este boletín, puedes ignorar este mensaje.</p>
      <p><a href="${unsubscribeLink}" class="unsubscribe-link">Darse de baja del boletín</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email.toLowerCase()],
      sender: `no-reply@toursred.com`,
      subject: `¡Bienvenido al boletín de ToursRed!`,
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
      return new Response(
        JSON.stringify({
          success: true,
          message: "¡Gracias por suscribirte! Sin embargo, hubo un problema al enviar el email de confirmación."
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Welcome email sent successfully:", result);

    return new Response(
      JSON.stringify({
        success: true,
        message: "¡Gracias por suscribirte! Revisa tu correo para confirmar tu suscripción."
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in newsletter subscription:", error);
    return new Response(
      JSON.stringify({
        error: "Error al procesar la suscripción",
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
