import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BookingApprovalNotificationRequest {
  booking_id: string;
  approved: boolean;
  rejection_reason?: string;
  auto_confirmed?: boolean;
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

    const { booking_id, approved, rejection_reason, auto_confirmed = false }: BookingApprovalNotificationRequest = await req.json();

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
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email, phone_number),
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

    // When auto_confirmed, delegate to send-booking-confirmation which has full templates
    // (3 emails: traveler + agency + admin, with QR, breakdown, insurance)
    if (approved && auto_confirmed) {
      console.log("✅ auto_confirmed=true → delegating to send-booking-confirmation for full 3-email flow");
      const confirmResponse = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ booking_id }),
      });

      const confirmResult = await confirmResponse.json();
      console.log("send-booking-confirmation result:", confirmResult);

      return new Response(
        JSON.stringify({
          success: true,
          message: "Correos de confirmación completos enviados (viajero, agencia, admin)",
          delegated: true,
          result: confirmResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

    let travelerEmailHtml = '';
    let subject = '';

    if (approved) {
      // Approved but NOT auto_confirmed — traveler still needs to pay
      subject = `¡Tu reserva ha sido aprobada! - ${booking.tour.name}`;
      travelerEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #d1fae5; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .success-icon { font-size: 48px; text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #10b981;">¡Reserva Aprobada!</h1>
    </div>
    <div class="content">
      <div class="success-icon">🎉</div>
      <div class="title">¡Excelentes Noticias!</div>

      <p>Estimado/a ${booking.traveler.first_name} ${booking.traveler.last_name},</p>

      <p>Tu solicitud de reserva ha sido aprobada por <strong>${booking.agency.name}</strong>.</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #92400e; margin-bottom: 5px;">Tu código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #92400e; letter-spacing: 2px;">${booking.booking_code}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📍 Detalles de tu Reserva</div>
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
        <strong>📝 Siguiente Paso: Completar el Pago</strong><br>
        Para confirmar tu reserva, por favor completa el pago haciendo clic en el botón de abajo.
        Puedes usar tu saldo de ToursRed Cash si tienes disponible.
      </div>

      <p style="text-align: center; margin-top: 30px;">
        <a href="${appUrl}/traveler/bookings" class="button">
          Completar Pago
        </a>
      </p>

      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
        Si tienes alguna pregunta, no dudes en contactar a ${booking.agency.name}.
      </p>
    </div>
    <div class="footer">
      <p>Este es un correo automático de ToursRed. Por favor, no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
      `;
    } else {
      subject = `Tu reserva no fue aprobada - ${booking.tour.name}`;
      travelerEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #ef4444; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #fee2e2; padding: 15px; border-left: 4px solid #ef4444; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e40af; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #ef4444;">Actualización de tu Reserva</h1>
    </div>
    <div class="content">
      <div class="title">Sobre tu solicitud de reserva</div>

      <p>Estimado/a ${booking.traveler.first_name} ${booking.traveler.last_name},</p>

      <p>Lamentablemente, tu solicitud de reserva no pudo ser aprobada por <strong>${booking.agency.name}</strong>.</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #fee2e2; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #991b1b; margin-bottom: 5px;">Código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #991b1b; letter-spacing: 2px;">${booking.booking_code}</div>
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
      </div>

      ${rejection_reason ? `
        <div class="highlight">
          <strong>Motivo:</strong><br>
          ${rejection_reason}
        </div>
      ` : ''}

      <p>Te invitamos a explorar otros tours disponibles en nuestra plataforma.</p>

      <p style="text-align: center; margin-top: 30px;">
        <a href="${appUrl}/tours" class="button">
          Ver Otros Tours
        </a>
      </p>

      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
        Si tienes alguna pregunta, no dudes en contactar a ${booking.agency.name}.
      </p>
    </div>
    <div class="footer">
      <p>Este es un correo automático de ToursRed. Por favor, no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
      `;
    }

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [booking.traveler.email],
      sender: emailSettings.contact_email,
      subject: subject,
      html_body: travelerEmailHtml,
    };

    const emailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error('Error sending traveler email:', errorText);
      throw new Error(`Failed to send traveler email: ${errorText}`);
    }

    const emailType = approved ? 'aprobación' : 'rechazo';
    console.log(`✅ Email de ${emailType} enviado al viajero ${booking.traveler.email}`);

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
    console.error("Error sending booking approval notification:", error);
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
