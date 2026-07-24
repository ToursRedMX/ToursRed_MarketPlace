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
        tour:tours!bookings_tour_id_fkey(id, name, destination, start_date, price),
        agency:agencies!bookings_agency_id_fkey(id, name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    const { data: cancellation, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .select(`
        *,
        cancelled_by:users!booking_cancellations_cancelled_by_user_id_fkey(first_name, last_name, email)
      `)
      .eq("id", cancellation_id)
      .single();

    if (cancellationError || !cancellation) {
      throw new Error("Booking cancellation not found");
    }

    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("*").single(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key || !emailSettings.contact_email) {
      throw new Error("Email settings not configured");
    }

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const formatDateTime = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const tourDate = formatDate(booking.tour.start_date);
    const cancellationDateTime = formatDateTime(cancellation.cancelled_at);
    const bookingDateTime = formatDateTime(booking.created_at);
    const refundAmount = Number(cancellation.refund_amount_to_traveler || 0);
    const serviceCharge = Number(booking.service_charge || 0);
    const insuranceRefundAmount = Number(cancellation.insurance_refund_amount || 0);
    const optionalServicesRefundAmount = Number(cancellation.optional_services_refund_amount || 0);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte de Cancelación de Reserva Individual</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="700" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🚫 Cancelación de Reserva - Reporte Admin</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 16px;">Cancelación Individual por Agencia</p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 16px;">⚠️ Una agencia ha cancelado una reserva individual</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Se ha procesado la cancelación de una reserva individual en la plataforma por parte de una agencia.
              </p>

              <div style="background-color: #f0fdf4; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 16px;">🏢 Información de la Agencia</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; width: 40%;">Agencia:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${booking.agency.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Email de contacto:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${booking.agency.contact_email}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Cancelado por:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${cancellation.cancelled_by.first_name} ${cancellation.cancelled_by.last_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Email del responsable:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${cancellation.cancelled_by.email}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px;">🎯 Información del Tour</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; width: 40%;">Tour:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; font-weight: 600; text-align: right;">${booking.tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Destino:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${booking.tour.destination}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Fecha programada:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${tourDate}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fef3f2; border: 2px solid #ef4444; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #991b1b; margin: 0 0 15px 0; font-size: 16px;">👤 Información del Viajero Afectado</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; width: 40%;">Código de reserva:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; font-weight: 600; text-align: right;">${booking.booking_code}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px;">Nombre:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; font-weight: 600; text-align: right;">${booking.user.first_name} ${booking.user.last_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px;">Email:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; text-align: right;">${booking.user.email}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px;">Viajeros:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; text-align: right;">${booking.travelers_count || 1}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px;">Fecha de reserva:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; text-align: right;">${bookingDateTime}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px;">Fecha de cancelación:</td>
                    <td style="padding: 6px 0; color: #991b1b; font-size: 14px; text-align: right;">${cancellationDateTime}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fff7ed; border: 2px solid #fb923c; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #9a3412; margin: 0 0 10px 0; font-size: 16px;">📋 Motivo de la Cancelación</h3>
                <p style="color: #7c2d12; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic; background-color: #fff; padding: 15px; border-radius: 4px; border: 1px solid #fed7aa;">
                  "${cancellation.agency_cancellation_reason}"
                </p>
              </div>

              <div style="background-color: #fef3c7; border: 2px solid #eab308; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #713f12; margin: 0 0 15px 0; font-size: 16px;">💰 Impacto Financiero</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; border-bottom: 1px solid #fde68a;">Anticipo original:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #fde68a;">${Number(booking.deposit_amount || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; border-bottom: 1px solid #fde68a;">Cargo por servicio reembolsado:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #fde68a;">${serviceCharge.toFixed(2)}</td>
                  </tr>
                  ${insuranceRefundAmount > 0 ? `
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; border-bottom: 1px solid #fde68a;">Seguro de viaje reembolsado:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #fde68a;">${insuranceRefundAmount.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  ${optionalServicesRefundAmount > 0 ? `
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; border-bottom: 1px solid #fde68a;">Servicios opcionales reembolsados:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #fde68a;">${optionalServicesRefundAmount.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 12px 0 8px 0; color: #10b981; font-size: 15px; font-weight: bold;">Reembolsado al viajero (ToursRed Cash):</td>
                    <td style="padding: 12px 0 8px 0; color: #10b981; font-size: 18px; font-weight: bold; text-align: right;">$${refundAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #dc2626; font-size: 14px; font-weight: bold; border-top: 2px solid #fde68a;">Comisión NO pagada a la agencia:</td>
                    <td style="padding: 8px 0; color: #dc2626; font-size: 14px; font-weight: bold; text-align: right; border-top: 2px solid #fde68a;">$${Number(booking.commission_amount || 0).toFixed(2)}</td>
                  </tr>

                </table>
              </div>

              <div style="background-color: #f3f4f6; border: 1px solid #d1d5db; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #374151; margin: 0 0 15px 0; font-size: 16px;">📊 Estadísticas de la Reserva</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                  <div style="background-color: #fff; padding: 15px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #3b82f6; margin-bottom: 5px;">${cancellation.days_before_tour}</div>
                    <div style="font-size: 12px; color: #6b7280;">Días antes del tour</div>
                  </div>
                  <div style="background-color: #fff; padding: 15px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 5px;">100%</div>
                    <div style="font-size: 12px; color: #6b7280;">Reembolso al viajero</div>
                  </div>
                  <div style="background-color: #fff; padding: 15px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #ef4444; margin-bottom: 5px;">0%</div>
                    <div style="font-size: 12px; color: #6b7280;">Comisión a agencia</div>
                  </div>
                </div>
              </div>

              <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <p style="color: #1e40af; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>📌 Nota Importante:</strong> Esta cancelación fue iniciada por la agencia, no por el viajero. El viajero ha recibido un reembolso completo del 100% en ToursRed Cash, incluyendo anticipo, cargo por servicio, seguro y servicios opcionales. La agencia NO recibirá comisión por esta reserva.
                </p>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${appUrl}/admin/agencies"
                   style="display: inline-block; background-color: #667eea; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px; margin-right: 10px;">
                  Ver Agencias
                </a>
                <a href="${appUrl}/admin/dashboard"
                   style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
                  Ver Dashboard
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0;">
                © ${new Date().getFullYear()} ToursRed - Panel de Administración<br>
                Este es un correo automático de sistema.
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
        to: [emailSettings.contact_email],
        subject: `[Admin] Cancelación de Reserva por Agencia: ${booking.agency.name} - ${booking.booking_code}`,
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
        message: "Email sent successfully to admin",
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
    console.error("Error in send-agency-booking-cancellation-notification-admin:", error);

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
