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

    const { booking_id, cancellation_id } = await req.json();

    if (!booking_id || !cancellation_id) {
      throw new Error("Missing required fields");
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        user:users!bookings_user_id_fkey(first_name, last_name, email),
        tour:tours!bookings_tour_id_fkey(name, destination, start_date),
        agency:agencies!bookings_agency_id_fkey(name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    const { data: cancellation, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .select("*")
      .eq("id", cancellation_id)
      .single();

    if (cancellationError || !cancellation) {
      throw new Error("Booking cancellation not found");
    }

    const { data: wallet } = await supabase
      .from("toursred_cash_wallets")
      .select("balance")
      .eq("user_id", booking.user_id)
      .maybeSingle();

    const currentBalance = wallet?.balance || 0;

    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("*").single(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      throw new Error("Email settings not configured");
    }

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const recipientEmail = booking.user.email;
    const recipientName = `${booking.user.first_name} ${booking.user.last_name}`;
    const tourName = booking.tour.name;
    const refundAmount = Number(booking.cancellation_refund_amount || 0);

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const originalTourDate = formatDate(booking.tour.start_date);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reserva Cancelada</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 180px; height: auto; margin-bottom: 15px; display: block; margin-left: auto; margin-right: auto;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Reserva Cancelada</h1>
              <p style="color: #fed7aa; margin: 10px 0 0 0; font-size: 14px;">Notificación Importante</p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 16px;">⚠️ Reserva Cancelada por la Agencia</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${recipientName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Lamentamos informarte que tu reserva para el tour <strong>${tourName}</strong> (Código: <strong>${booking.booking_code}</strong>) ha sido cancelada por la agencia.
              </p>

              <div style="background-color: #f9fafb; border-left: 3px solid #f97316; padding: 20px; margin: 30px 0; border-radius: 4px;">
                <p style="margin: 0 0 10px 0; color: #1f2937; font-weight: bold; font-size: 14px;">📋 Detalles de la Reserva</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Código de reserva:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-weight: bold; text-align: right;">${booking.booking_code}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-weight: bold; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Destino:</td>
                    <td style="padding: 6px 0; color: #1f2937; text-align: right;">${booking.tour.destination}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Fecha programada:</td>
                    <td style="padding: 6px 0; color: #1f2937; text-align: right;">${originalTourDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Agencia:</td>
                    <td style="padding: 6px 0; color: #1f2937; text-align: right;">${booking.agency.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Viajeros:</td>
                    <td style="padding: 6px 0; color: #1f2937; text-align: right;">${booking.travelers_count || 1}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fff7ed; border: 2px solid #fb923c; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold; font-size: 14px;">Motivo de la Cancelación:</p>
                <p style="margin: 0; color: #7c2d12; font-size: 14px; line-height: 1.6; font-style: italic;">
                  "${cancellation.agency_cancellation_reason}"
                </p>
              </div>

              <div style="background-color: #ecfdf5; border: 2px solid #10b981; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 18px;">💰 Reembolso Procesado</h3>
                <p style="color: #047857; font-size: 14px; line-height: 1.6; margin: 0 0 15px 0;">
                  Como no fuiste responsable de esta cancelación, has recibido un <strong>reembolso del 100%</strong> de tu anticipo.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #047857; font-size: 14px;">Anticipo original:</td>
                    <td style="padding: 8px 0; color: #047857; font-weight: 600; text-align: right;">$${refundAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #047857; font-size: 14px;">Reembolsado a ToursRed Cash:</td>
                    <td style="padding: 8px 0; color: #065f46; font-size: 18px; font-weight: bold; text-align: right;">$${refundAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top: 15px; border-top: 1px solid #10b981; margin-top: 10px;">
                      <p style="color: #047857; font-size: 14px; margin: 10px 0 0 0;">
                        Tu nuevo balance de ToursRed Cash: <strong>$${currentBalance.toFixed(2)}</strong>
                      </p>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 30px 0; border-radius: 4px;">
                <p style="color: #92400e; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>Nota:</strong> El cargo por servicio de $${(booking.service_charge || 0).toFixed(2)} no es reembolsable ya que fue cobrado por Stripe al momento de la reserva.
                </p>
              </div>

              <div style="background-color: #dbeafe; border: 2px solid #3b82f6; padding: 20px; margin: 30px 0; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 15px 0; color: #1e40af; font-size: 16px; font-weight: bold;">
                  🌍 Explora Otros Tours Increíbles
                </p>
                <p style="margin: 0 0 20px 0; color: #1e3a8a; font-size: 14px;">
                  Tenemos muchos otros tours disponibles para tu próxima aventura. Usa tu ToursRed Cash en cualquier reserva.
                </p>
                <a href="${appUrl}/tours"
                   style="display: inline-block; background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
                  Ver Tours Disponibles
                </a>
              </div>

              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Si tienes alguna pregunta o necesitas asistencia, nuestro equipo de soporte está disponible para ayudarte.
              </p>

              <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 13px; margin: 0 0 5px 0;">
                  <strong>Contacto de Soporte ToursRed:</strong>
                </p>
                <p style="color: #6b7280; font-size: 13px; margin: 0;">
                  📧 ${emailSettings.contact_email}
                </p>
              </div>
            </td>
          </tr>

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

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
      },
      body: JSON.stringify({
        sender: emailSettings.contact_email,
        to: [recipientEmail],
        subject: `Reserva Cancelada - ${tourName} - ${booking.booking_code}`,
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
    console.error("Error in send-agency-booking-cancellation-notification-traveler:", error);

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
