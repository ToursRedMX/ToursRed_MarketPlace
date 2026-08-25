import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  console.log("============================================");
  console.log("FUNCIÓN SEND-RESCHEDULE-RESPONSE-AGENCY INICIADA");
  console.log("============================================");

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

    const { booking_id, response } = await req.json();

    console.log("📥 Request recibida en send-reschedule-response-agency:");
    console.log("- Booking ID:", booking_id);
    console.log("- Response:", response);

    if (!booking_id || !response) {
      throw new Error("Missing required fields");
    }

    if (!["accepted", "rejected"].includes(response)) {
      throw new Error("Invalid response value");
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        booking_code,
        user:users!bookings_user_id_fkey(first_name, last_name, email),
        tour:tours!bookings_tour_id_fkey(name, destination, start_date, end_date),
        agency:agencies!bookings_agency_id_fkey(name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    const { data: rescheduleResponse, error: responseError } = await supabase
      .from("booking_reschedule_responses")
      .select(`
        *,
        reschedule:tour_reschedules!booking_reschedule_responses_tour_reschedule_id_fkey(*)
      `)
      .eq("booking_id", booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (responseError || !rescheduleResponse) {
      throw new Error("Reschedule response not found");
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("*")
      .single();

    console.log("📧 Email settings obtenidas:", emailSettings ? "SÍ" : "NO");
    console.log("📧 SMTP API Key presente:", emailSettings?.smtp_api_key ? "SÍ" : "NO");
    console.log("📧 From email:", emailSettings?.from_email);
    console.log("📧 From name:", emailSettings?.from_name);

    if (!emailSettings?.smtp_api_key) {
      throw new Error("Email settings not configured");
    }

    const agencyEmail = booking.agency.contact_email;
    const agencyName = booking.agency.name;
    const travelerName = `${booking.user.first_name} ${booking.user.last_name}`;
    const tourName = booking.tour.name;
    const bookingCode = booking.booking_code;

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    let htmlContent = "";
    let subject = "";

    if (response === "accepted") {
      const newDate = formatDate(rescheduleResponse.reschedule.new_start_date);
      const newEndDate = formatDate(rescheduleResponse.reschedule.new_end_date);

      subject = `✓ Reagendamiento Aceptado - ${travelerName} - ${tourName}`;

      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reagendamiento Aceptado</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="width: 120px; height: auto; margin-bottom: 20px;" />
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">✓ Reagendamiento Aceptado</h1>
              <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 14px;">El viajero aceptó la nueva fecha</p>
            </td>
          </tr>

          <!-- Success Banner -->
          <tr>
            <td style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #065f46; font-weight: bold; font-size: 16px;">La reserva ha sido confirmada con la nueva fecha</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${agencyName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Te informamos que <strong>${travelerName}</strong> ha <strong style="color: #10b981;">aceptado</strong> el reagendamiento del tour <strong>${tourName}</strong>.
              </p>

              <!-- Updated Booking Info -->
              <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #10b981; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h2 style="margin: 0 0 20px 0; color: #065f46; font-size: 18px;">📅 Información de la Reserva</h2>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Viajero:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${travelerName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Código:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nueva Fecha Inicio:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">${newDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nueva Fecha Fin:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">${newEndDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Destino:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${booking.tour.destination}</td>
                  </tr>
                </table>
              </div>

              <!-- Important Info -->
              <div style="background-color: #dbeafe; border: 1px solid #93c5fd; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: bold; font-size: 14px;">ℹ️ Importante</p>
                <ul style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px; line-height: 1.8;">
                  <li>La reserva está confirmada con la nueva fecha</li>
                  <li>El pago y depósito del viajero siguen siendo válidos</li>
                  <li>No se requieren acciones adicionales</li>
                  <li>Prepara todo para la nueva fecha del tour</li>
                </ul>
              </div>

              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Puedes gestionar esta reserva desde tu panel de agencia en ToursRed.
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

    } else {
      const refundAmount = Number(booking.cancellation_refund_amount || booking.deposit_amount);

      subject = `⚠️ Reagendamiento Rechazado - ${travelerName} - ${tourName}`;

      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reagendamiento Rechazado</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="width: 120px; height: auto; margin-bottom: 20px;" />
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">⚠️ Reagendamiento Rechazado</h1>
              <p style="color: #fecaca; margin: 10px 0 0 0; font-size: 14px;">El viajero rechazó la nueva fecha</p>
            </td>
          </tr>

          <!-- Alert Banner -->
          <tr>
            <td style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #991b1b; font-weight: bold; font-size: 16px;">La reserva ha sido cancelada y reembolsada</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${agencyName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Te informamos que <strong>${travelerName}</strong> ha <strong style="color: #ef4444;">rechazado</strong> el reagendamiento del tour <strong>${tourName}</strong>.
              </p>

              <!-- Booking Info -->
              <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border: 2px solid #ef4444; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h2 style="margin: 0 0 20px 0; color: #991b1b; font-size: 18px;">📋 Información de la Reserva Cancelada</h2>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Viajero:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${travelerName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Código:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Monto Reembolsado:</td>
                    <td style="padding: 8px 0; color: #ef4444; font-weight: bold; font-size: 14px; text-align: right;">$${refundAmount.toFixed(2)} MXN</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Destino:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${booking.tour.destination}</td>
                  </tr>
                </table>
              </div>

              <!-- Important Info -->
              <div style="background-color: #fef3c7; border: 1px solid #fbbf24; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #92400e; font-weight: bold; font-size: 14px;">⚠️ Importante</p>
                <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px; line-height: 1.8;">
                  <li>La reserva ha sido cancelada automáticamente</li>
                  <li>El viajero recibió el 100% de reembolso en ToursRed Cash</li>
                  <li>La plaza quedó disponible para otros viajeros</li>
                  <li>No se requieren acciones de tu parte</li>
                </ul>
              </div>

              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Puedes ver los detalles de esta cancelación en tu panel de agencia en ToursRed.
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
    }

    console.log("\n🚀 ENVIANDO CON SMTP2GO...");
    console.log("📧 Destinatario:", agencyEmail);
    console.log("📧 Asunto:", subject);

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
      },
      body: JSON.stringify({
        sender: emailSettings.contact_email,
        to: [agencyEmail],
        subject: subject,
        html_body: htmlContent,
      }),
    });

    const emailResult = await emailResponse.json();

    console.log("📧 SMTP2GO status:", emailResponse.status);
    console.log("📧 SMTP2GO response:", emailResult);

    if (!emailResponse.ok || emailResult.data?.error) {
      console.error("❌ SMTP2GO error:", emailResult);
      throw new Error(emailResult.data?.error || "Failed to send email");
    }

    console.log("✅✅✅ Email enviado exitosamente a la agencia!");

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
