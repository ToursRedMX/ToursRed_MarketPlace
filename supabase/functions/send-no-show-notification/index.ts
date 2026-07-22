import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NoShowNotificationRequest {
  booking_id: string;
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

    const { booking_id }: NoShowNotificationRequest = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "El ID de reserva es requerido" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        tour:tours(*),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email, no_show_count),
        agency:agencies(*)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error("Error fetching booking:", bookingError);
      return new Response(
        JSON.stringify({ error: "No se encontró la reserva" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

    if (!emailSettings || !emailSettings.smtp_api_key) {
      console.error("Email settings not configured");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Configuración de email no disponible"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const noShowCount = booking.traveler.no_show_count || 0;
    const isHighRisk = noShowCount > 3;

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    console.log(`Sending No Show notification for booking: ${booking_id}, traveler no_show_count: ${noShowCount}`);

    const travelerEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #fed7aa; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #ea580c; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .warning-box { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .danger-box { background-color: #fee2e2; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0; }
    .counter-box { background-color: #fff7ed; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .counter-number { font-size: 48px; font-weight: bold; color: #ea580c; }
    .counter-label { font-size: 18px; color: #6b7280; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #ea580c;">⚠️ Notificación de No Show</h1>
    </div>
    <div class="content">
      <div class="title">Ausencia Registrada en Tour</div>

      <p>Estimado/a ${booking.traveler.first_name} ${booking.traveler.last_name},</p>

      <p>Te informamos que la agencia <strong>${booking.agency.name}</strong> ha reportado que <strong>no te presentaste</strong> al siguiente tour:</p>

      <div class="section">
        <div class="section-title">📍 Detalles del Tour</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Destino:</span>
          <span class="info-value">${booking.tour.destination}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha del tour:</span>
          <span class="info-value">${formatDate(booking.tour.start_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Agencia:</span>
          <span class="info-value">${booking.agency.name}</span>
        </div>
      </div>

      <div class="counter-box">
        <div class="counter-number">${noShowCount}/3</div>
        <div class="counter-label">No Shows Registrados</div>
      </div>

      ${!isHighRisk ? `
      <div class="warning-box">
        <strong>⚠️ Importante:</strong><br><br>
        Actualmente tienes <strong>${noShowCount} ausencia${noShowCount > 1 ? 's' : ''}</strong> registrada${noShowCount > 1 ? 's' : ''}.
        Si acumulas <strong>más de 3 ausencias (No Shows)</strong>, las siguientes consecuencias aplicarán:<br><br>
        • <strong>No podrás reservar tours pagando solo el anticipo</strong><br>
        • <strong>Se te requerirá pagar el 100% del costo del tour por adelantado</strong><br>
        • Esta política protege a nuestras agencias de pérdidas causadas por ausencias repetidas<br><br>
        Te recomendamos cancelar tus reservas con anticipación si no podrás asistir, en lugar de simplemente no presentarte.
      </div>
      ` : `
      <div class="danger-box">
        <strong>🚨 ATENCIÓN - ESTADO DE ALTO RIESGO</strong><br><br>
        Has acumulado <strong>${noShowCount} ausencias (No Shows)</strong>, lo cual supera el límite de 3 permitido.<br><br>
        <strong>A partir de ahora:</strong><br>
        • <strong>Deberás pagar el 100% del costo del tour por adelantado</strong> en todas tus futuras reservas<br>
        • Ya no podrás reservar pagando solo un anticipo<br>
        • Esta medida protege a nuestras agencias de pérdidas causadas por ausencias repetidas<br><br>
        Si crees que esto es un error, por favor contacta a nuestro equipo de soporte.
      </div>
      `}

      <div class="section">
        <div class="section-title">💡 ¿Qué puedes hacer?</div>
        <ul style="line-height: 1.8;">
          <li>Si hubo un error o una situación especial, contacta inmediatamente a la agencia <strong>${booking.agency.name}</strong></li>
          <li>En el futuro, cancela tus reservas con anticipación si no podrás asistir</li>
          <li>Comunícate con la agencia antes del tour si tienes algún inconveniente</li>
          ${isHighRisk ? '<li>Para recuperar tu estatus normal, deberás demostrar confiabilidad en futuras reservas</li>' : ''}
        </ul>
      </div>

      <div class="section">
        <div class="section-title">📞 Contacto de la Agencia</div>
        <div class="info-row">
          <span class="info-label">Agencia:</span>
          <span class="info-value">${booking.agency.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.agency.contact_email}</span>
        </div>
        ${booking.agency.contact_phone ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.agency.contact_phone}</span>
        </div>
        ` : ''}
      </div>

      <p style="margin-top: 30px;">Gracias por tu comprensión.</p>
      <p><strong>El equipo de ToursRed</strong></p>
    </div>
    <div class="footer">
      <p>Si tienes alguna pregunta sobre esta notificación, no dudes en contactarnos.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [booking.traveler.email],
      sender: emailSettings.contact_email,
      subject: `⚠️ Ausencia Registrada - ${booking.tour.name} (${noShowCount}/3 No Shows)`,
      html_body: travelerEmailHtml,
    };

    console.log(`Sending No Show notification to traveler:`, booking.traveler.email);

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error(`Error sending No Show notification:`, result);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Error al enviar el email de notificación",
          details: result
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`No Show notification email sent successfully to traveler`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email de notificación de No Show enviado exitosamente",
        no_show_count: noShowCount
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in No Show notification:", error);
    return new Response(
      JSON.stringify({
        error: "Error al procesar la notificación de No Show",
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
