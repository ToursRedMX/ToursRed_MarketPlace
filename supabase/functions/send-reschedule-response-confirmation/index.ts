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

    const { booking_id, response } = await req.json();

    if (!booking_id || !response) {
      throw new Error("Missing required fields");
    }

    if (!["accepted", "rejected"].includes(response)) {
      throw new Error("Invalid response value");
    }

    // Obtener información completa
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

    // Obtener respuesta de reagendamiento para datos adicionales
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

    // Obtener configuración de email
    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("*")
      .single();

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

    let htmlContent = "";
    let subject = "";

    if (response === "accepted") {
      // EMAIL DE ACEPTACIÓN
      const newDate = formatDate(rescheduleResponse.reschedule.new_start_date);
      const newEndDate = formatDate(rescheduleResponse.reschedule.new_end_date);

      subject = `✓ Confirmación: Nueva Fecha Aceptada - ${tourName}`;

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
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">✓ Confirmación Exitosa</h1>
              <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 14px;">Tu respuesta ha sido registrada</p>
            </td>
          </tr>

          <!-- Success Banner -->
          <tr>
            <td style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #065f46; font-weight: bold; font-size: 16px;">Has aceptado la nueva fecha del tour</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${recipientName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Confirmamos que has <strong style="color: #10b981;">aceptado</strong> la nueva fecha para el tour <strong>${tourName}</strong>.
              </p>

              <!-- Updated Booking Info -->
              <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #10b981; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h2 style="margin: 0 0 20px 0; color: #065f46; font-size: 18px;">📅 Tu Reserva Actualizada</h2>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Código de Reserva:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nueva Fecha de Inicio:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">${newDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nueva Fecha de Fin:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">${newEndDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Destino:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${booking.tour.destination}</td>
                  </tr>
                </table>
              </div>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 30px 0 20px 0;">
                Tu reserva sigue siendo válida y no hay cargos adicionales. Te esperamos en la nueva fecha para disfrutar esta experiencia.
              </p>

              <!-- Important Info -->
              <div style="background-color: #dbeafe; border: 1px solid #93c5fd; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: bold; font-size: 14px;">ℹ️ Información Importante</p>
                <ul style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px; line-height: 1.8;">
                  <li>Tu pago y depósito siguen siendo válidos</li>
                  <li>No necesitas realizar ninguna acción adicional</li>
                  <li>Recibirás un recordatorio antes de la fecha del tour</li>
                  <li>Puedes ver los detalles en tu panel de reservas</li>
                </ul>
              </div>

              <!-- Contact Agency -->
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Si tienes alguna pregunta, puedes contactar a la agencia:
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

    } else {
      // EMAIL DE RECHAZO CON REEMBOLSO
      const refundAmount = Number(booking.cancellation_refund_amount || booking.deposit_amount);

      // Obtener balance actualizado del wallet
      const { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("balance")
        .eq("user_id", booking.user_id)
        .single();

      const newBalance = wallet ? Number(wallet.balance) : 0;

      subject = `💰 Reembolso Procesado - ${tourName}`;

      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0;">
  <title>Reembolso Procesado</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="width: 120px; height: auto; margin-bottom: 20px;" />
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">💰 Reembolso Procesado</h1>
              <p style="color: #dbeafe; margin: 10px 0 0 0; font-size: 14px;">Tu dinero ha sido acreditado</p>
            </td>
          </tr>

          <!-- Info Banner -->
          <tr>
            <td style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #1e40af; font-weight: bold; font-size: 16px;">Has rechazado el reagendamiento del tour</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${recipientName}</strong>,
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Confirmamos que has rechazado la nueva fecha para el tour <strong>${tourName}</strong>. Tu reserva ha sido cancelada y hemos procesado tu reembolso completo.
              </p>

              <!-- Refund Amount -->
              <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px solid #3b82f6; padding: 30px; margin: 30px 0; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 10px 0; color: #1e40af; font-size: 14px; font-weight: bold;">MONTO REEMBOLSADO</p>
                <p style="margin: 0; color: #1e3a8a; font-size: 42px; font-weight: bold;">$${refundAmount.toFixed(2)}</p>
                <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 14px;">MXN</p>
              </div>

              <!-- Wallet Info -->
              <div style="background-color: #f0fdf4; border: 1px solid #86efac; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h2 style="margin: 0 0 15px 0; color: #065f46; font-size: 18px;">💳 Tu Monedero ToursRed Cash</h2>
                <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 15px 0;">
                  El reembolso ha sido acreditado a tu monedero ToursRed Cash. Puedes usar este saldo para pagar futuras reservas en la plataforma.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nuevo Saldo Disponible:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 18px; text-align: right;">$${newBalance.toFixed(2)} MXN</td>
                  </tr>
                </table>
              </div>

              <!-- Cancellation Details -->
              <div style="background-color: #f9fafb; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 16px;">Detalles de la Cancelación</h3>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Tour Cancelado:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Código de Reserva:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Motivo:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">Reagendamiento Rechazado</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Política Aplicada:</td>
                    <td style="padding: 6px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">Reembolso 100%</td>
                  </tr>
                </table>
              </div>

              <!-- Explore Tours CTA -->
              <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 30px; margin: 30px 0; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0 0 15px 0; color: #ffffff; font-size: 20px;">¿Buscas Tu Próxima Aventura?</h3>
                <p style="margin: 0 0 20px 0; color: #fed7aa; font-size: 14px;">
                  Explora cientos de tours y experiencias increíbles. Usa tu saldo ToursRed Cash en tu próxima reserva.
                </p>
                <a href="${Deno.env.get("SUPABASE_URL")?.replace('//', '//')}/catalog" style="display: inline-block; background-color: #ffffff; color: #ea580c; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Explorar Tours
                </a>
              </div>

              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0; text-align: center;">
                Lamentamos que no pudieras asistir en la nueva fecha. Esperamos verte pronto en otra aventura.
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
        subject: subject,
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
        message: "Confirmation email sent successfully",
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
    console.error("Error in send-reschedule-response-confirmation:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error sending confirmation email"
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
