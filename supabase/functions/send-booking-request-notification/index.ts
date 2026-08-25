import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BookingRequestNotificationRequest {
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

    console.log('📧 Iniciando envío de notificación de solicitud de reserva...');

    const { booking_id }: BookingRequestNotificationRequest = await req.json();

    console.log('📋 Booking ID recibido:', booking_id);

    if (!booking_id) {
      console.error('❌ No se proporcionó booking_id');
      return new Response(
        JSON.stringify({ error: "El ID de reserva es requerido" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log('🔍 Consultando datos de la reserva...');

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        tour:tours(*),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email, phone_number),
        agency:agencies(*)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error("❌ Error fetching booking:", bookingError);
      return new Response(
        JSON.stringify({ error: "No se encontró la reserva" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log('✅ Datos de la reserva obtenidos correctamente');
    console.log('📧 Email destino:', booking.agency.contact_email);

    const [emailSettingsResult, platformSettingsResult] = await Promise.all([
      supabase.from("email_settings").select("*").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (emailSettingsResult.error || !emailSettingsResult.data || !emailSettingsResult.data.smtp_api_key) {
      console.error("Email settings not configured:", emailSettingsResult.error);
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

    const emailSettings = emailSettingsResult.data;
    const appUrl = platformSettingsResult.data?.platform_url || "https://toursredmx.netlify.app";

    const bookingDate = new Date(booking.booking_date).toLocaleDateString('es-MX', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const agencyEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e40af; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">Nueva Solicitud de Reserva</h1>
    </div>
    <div class="content">
      <div class="title">🔔 Solicitud de Aprobación</div>

      <p>Estimado/a ${booking.agency.name},</p>

      <p>Has recibido una nueva solicitud de reserva que requiere tu aprobación.</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #dcfce7; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #166534; margin-bottom: 5px;">Código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #166534; letter-spacing: 2px;">${booking.booking_code}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📍 Detalles de la Reserva</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha del Tour:</span>
          <span class="info-value">${bookingDate}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Número de Viajeros:</span>
          <span class="info-value">${booking.travelers_count}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Monto Total:</span>
          <span class="info-value">$${booking.total_price?.toLocaleString() || '0'} MXN</span>
        </div>
      </div>

      <div class="highlight">
        <strong>⚠️ Importante:</strong> Los datos del viajero estarán disponibles en tu dashboard después de que apruebes la reserva y el viajero complete el pago.
      </div>

      <p style="text-align: center; margin-top: 30px;">
        <a href="${appUrl}/agency/bookings" class="button">
          Ver en Dashboard
        </a>
      </p>

      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
        Por favor, revisa la solicitud y apruébala o recházala lo antes posible.
        El viajero recibirá una notificación con tu decisión.
      </p>
    </div>
    <div class="footer">
      <p>Este es un correo automático de ToursRed. Por favor, no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [booking.agency.contact_email],
      sender: emailSettings.contact_email,
      subject: `Nueva Solicitud de Reserva - ${booking.tour.name}`,
      html_body: agencyEmailHtml,
    };

    console.log(`📧 Enviando email a ${booking.agency.contact_email}...`);

    const emailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await emailResponse.json();

    if (!emailResponse.ok || result.data?.error) {
      console.error('❌ Error sending agency email:', result);
      throw new Error(`Failed to send agency email: ${JSON.stringify(result)}`);
    }

    console.log(`✅ Email de solicitud enviado a la agencia ${booking.agency.agency_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Notificación enviada exitosamente"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("Error sending booking request notification:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error al enviar la notificación"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
