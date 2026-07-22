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

    const { tour_cancellation_id } = await req.json();

    if (!tour_cancellation_id) {
      throw new Error("Missing tour_cancellation_id");
    }

    const { data: cancellation, error: cancellationError } = await supabase
      .from("tour_cancellations")
      .select(`
        *,
        tour:tours!tour_cancellations_tour_id_fkey(id, name, destination, start_date, price),
        agency:agencies!tour_cancellations_agency_id_fkey(id, name, contact_email),
        cancelled_by:users!tour_cancellations_cancelled_by_user_id_fkey(first_name, last_name, email)
      `)
      .eq("id", tour_cancellation_id)
      .single();

    if (cancellationError || !cancellation) {
      throw new Error("Tour cancellation not found");
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select(`
        *,
        user:users!bookings_user_id_fkey(first_name, last_name, email)
      `)
      .eq("agency_cancellation_id", tour_cancellation_id);

    if (bookingsError) {
      throw new Error("Error fetching cancelled bookings");
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

    const originalTourDate = formatDate(cancellation.tour.start_date);
    const cancellationDateTime = formatDateTime(cancellation.cancelled_at);

    const bookingsList = bookings?.map(b => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${b.booking_code}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${b.user.first_name} ${b.user.last_name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${b.user.email}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right;">$${Number(b.cancellation_refund_amount || 0).toFixed(2)}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" style="padding: 8px; text-align: center;">No bookings data</td></tr>';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte de Cancelación de Tour</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="700" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🚫 Cancelación de Tour - Reporte Admin</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 16px;">Notificación de Cancelación por Agencia</p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 16px;">⚠️ Una agencia ha cancelado un tour completo</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Se ha procesado una cancelación completa de un tour en la plataforma.
              </p>

              <div style="background-color: #f0fdf4; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 16px;">🏢 Información de la Agencia</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; width: 40%;">Agencia:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.agency.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Email:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${cancellation.agency.contact_email}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Cancelado por:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${cancellation.cancelled_by.first_name} ${cancellation.cancelled_by.last_name}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px;">🎯 Información del Tour</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; width: 40%;">Tour:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Destino:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${cancellation.tour.destination}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Fecha programada:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${originalTourDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Fecha de cancelación:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${cancellationDateTime}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fff7ed; border: 2px solid #fb923c; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #9a3412; margin: 0 0 10px 0; font-size: 16px;">📋 Motivo de la Cancelación</h3>
                <p style="color: #7c2d12; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic; background-color: #fff; padding: 15px; border-radius: 4px; border: 1px solid #fed7aa;">
                  "${cancellation.cancellation_reason}"
                </p>
              </div>

              <div style="background-color: #fef3c7; border: 2px solid #eab308; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #713f12; margin: 0 0 15px 0; font-size: 16px;">📊 Impacto de la Cancelación</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                  <div style="background-color: #fff; padding: 15px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #f59e0b; margin-bottom: 5px;">${cancellation.affected_bookings_count}</div>
                    <div style="font-size: 13px; color: #854d0e;">Reservas Canceladas</div>
                  </div>
                  <div style="background-color: #fff; padding: 15px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold; color: #10b981; margin-bottom: 5px;">$${Number(cancellation.total_refunded_amount).toFixed(2)}</div>
                    <div style="font-size: 13px; color: #854d0e;">Total Reembolsado</div>
                  </div>
                </div>
                <p style="color: #854d0e; font-size: 13px; margin: 15px 0 0 0; text-align: center;">
                  ${cancellation.emails_sent_to_travelers} de ${cancellation.affected_bookings_count} emails enviados exitosamente
                </p>
              </div>

              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #374151; margin: 0 0 15px 0; font-size: 16px;">👥 Detalle de Reservas Canceladas</h3>
                <div style="overflow-x: auto;">
                  <table width="100%" style="border-collapse: collapse; background-color: #fff; font-size: 13px;">
                    <thead>
                      <tr style="background-color: #f3f4f6;">
                        <th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">Código</th>
                        <th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">Viajero</th>
                        <th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">Email</th>
                        <th style="padding: 10px 8px; text-align: right; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">Reembolso</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${bookingsList}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <p style="color: #1e40af; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>📌 Nota Importante:</strong> Todos los viajeros han recibido un reembolso del 100% de su anticipo en ToursRed Cash. Los cargos por servicio no son reembolsables ya que fueron cobrados por Stripe.
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
        subject: `[Admin] Tour Cancelado por Agencia: ${cancellation.tour.name} - ${cancellation.affected_bookings_count} viajeros afectados`,
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
    console.error("Error in send-agency-cancellation-notification-admin:", error);

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
