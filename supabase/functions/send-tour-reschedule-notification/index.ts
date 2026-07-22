import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { booking_id, tour_reschedule_id } = await req.json();

    if (!booking_id || !tour_reschedule_id) {
      throw new Error("Missing required fields");
    }

    // Obtener información completa
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        booking_code,
        user:users!bookings_user_id_fkey(first_name, last_name, email),
        tour:tours!bookings_tour_id_fkey(name, destination),
        agency:agencies!bookings_agency_id_fkey(name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    const { data: reschedule, error: rescheduleError } = await supabase
      .from("tour_reschedules")
      .select("*")
      .eq("id", tour_reschedule_id)
      .single();

    if (rescheduleError || !reschedule) {
      throw new Error("Reschedule not found");
    }

    // Obtener configuración de email y URL de plataforma
    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("*").single(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      throw new Error("Email settings not configured");
    }

    const recipientEmail = booking.user.email;
    const recipientName = `${booking.user.first_name} ${booking.user.last_name}`;
    const tourName = booking.tour.name;
    const bookingCode = booking.booking_code;

    // Formatear fechas
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const originalStartDate = formatDate(reschedule.original_start_date);
    const newStartDate = formatDate(reschedule.new_start_date);
    const deadline = new Date(reschedule.response_deadline);
    const deadlineFormatted = deadline.toLocaleDateString('es-MX', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // URLs para aceptar/rechazar (apuntan a la página de reservas del viajero)
    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";
    const acceptUrl = `${appUrl}/traveler/bookings?action=accept&booking=${booking_id}`;
    const rejectUrl = `${appUrl}/traveler/bookings?action=reject&booking=${booking_id}`;

    // Crear HTML del email
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tour Reagendado - Respuesta Requerida</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 180px; height: auto; margin-bottom: 15px; display: block; margin-left: auto; margin-right: auto;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">ToursRed</h1>
              <p style="color: #fed7aa; margin: 10px 0 0 0; font-size: 14px;">Plataforma de Tours y Experiencias</p>
            </td>
          </tr>

          <!-- Alert Banner -->
          <tr>
            <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 16px;">⚠️ IMPORTANTE: Tu tour ha sido reagendado</p>
              <p style="margin: 8px 0 0 0; color: #78350f; font-size: 14px;">Se requiere tu respuesta antes del ${deadlineFormatted}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${recipientName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Te informamos que el tour <strong>${tourName}</strong> (Código de reserva: <strong>${bookingCode}</strong>) ha sido reagendado por la agencia.
              </p>

              <!-- Comparison Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <tr>
                  <th style="background-color: #f3f4f6; color: #1f2937; padding: 15px; text-align: left; font-size: 14px; border-bottom: 1px solid #e5e7eb;">Fecha Original</th>
                  <th style="background-color: #f3f4f6; color: #1f2937; padding: 15px; text-align: left; font-size: 14px; border-bottom: 1px solid #e5e7eb;">Nueva Fecha</th>
                </tr>
                <tr>
                  <td style="padding: 15px; color: #6b7280; font-size: 14px; text-decoration: line-through;">${originalStartDate}</td>
                  <td style="padding: 15px; color: #059669; font-weight: bold; font-size: 14px;">${newStartDate}</td>
                </tr>
              </table>

              <!-- Reason -->
              <div style="background-color: #f9fafb; border-left: 3px solid #f97316; padding: 20px; margin: 30px 0; border-radius: 4px;">
                <p style="margin: 0 0 10px 0; color: #1f2937; font-weight: bold; font-size: 14px;">Motivo del cambio:</p>
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">${reschedule.reason}</p>
              </div>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 30px 0 20px 0;">
                <strong>¿Puedes asistir en la nueva fecha?</strong>
              </p>

              <!-- Action Buttons -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td width="48%" style="padding-right: 2%;">
                    <a href="${acceptUrl}" style="display: block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 16px 24px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 16px;">
                      ✓ Acepto la Nueva Fecha
                    </a>
                  </td>
                  <td width="48%" style="padding-left: 2%;">
                    <a href="${rejectUrl}" style="display: block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 16px 24px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 16px;">
                      ✗ No Puedo Asistir
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Refund Info -->
              <div style="background-color: #dbeafe; border: 1px solid #93c5fd; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: bold; font-size: 14px;">💰 Información sobre Reembolso</p>
                <p style="margin: 0; color: #1e3a8a; font-size: 14px; line-height: 1.6;">
                  Si no puedes asistir en la nueva fecha, recibirás un <strong>reembolso del 100%</strong> de tu depósito sin ninguna penalización.
                  El monto será acreditado a tu monedero ToursRed Cash y podrás usarlo en futuras reservas.
                </p>
              </div>

              <!-- Deadline Warning -->
              <div style="background-color: #fef3c7; border: 1px solid #fbbf24; padding: 15px; margin: 30px 0; border-radius: 8px; text-align: center;">
                <p style="margin: 0; color: #92400e; font-size: 14px;">
                  <strong>⏰ Fecha límite para responder:</strong><br>
                  ${deadlineFormatted}
                </p>
                <p style="margin: 8px 0 0 0; color: #78350f; font-size: 12px;">
                  Si no respondes antes de esta fecha, se aceptará automáticamente la nueva fecha.
                </p>
              </div>

              <!-- Contact Agency -->
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Si tienes alguna duda sobre el cambio de fecha, puedes contactar directamente a la agencia:
              </p>
              <p style="color: #374151; font-size: 14px; margin: 10px 0;">
                <strong>${booking.agency.name}</strong><br>
                📧 ${booking.agency.contact_email}<br>
                ${booking.agency.contact_phone ? `📞 ${booking.agency.contact_phone}` : ''}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0 0 10px 0;">
                Este correo fue enviado por ToursRed
              </p>
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    // Enviar email usando SMTP2GO API
    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
      },
      body: JSON.stringify({
        sender: emailSettings.contact_email,
        to: [recipientEmail],
        subject: `⚠️ Tour Reagendado - Respuesta Requerida: ${tourName}`,
        html_body: htmlContent,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok || emailResult.data?.error) {
      console.error("SMTP2GO Error:", emailResult);
      throw new Error(emailResult.data?.error || "Failed to send email");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email sent successfully",
        email_id: emailResult.data?.email_id
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error: any) {
    console.error("Error in send-tour-reschedule-notification:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error sending email"
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
