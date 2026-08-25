import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      booking_id,
      request_id,
      original_date,
      original_time,
      new_date,
      new_time,
      reason,
      response_deadline,
    } = await req.json();

    if (!booking_id || !original_date || !new_date) {
      throw new Error("Faltan campos requeridos");
    }

    const { data: booking, error: bookingError } = await adminClient
      .from("bookings")
      .select(`
        id, booking_code, user_id,
        user:users!bookings_user_id_fkey(first_name, last_name, email),
        tour:tours!bookings_tour_id_fkey(name, destination),
        agency:agencies!bookings_agency_id_fkey(name)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) throw new Error("Reserva no encontrada");

    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      adminClient.from("email_settings").select("smtp_api_key, contact_email, platform_name").single(),
      adminClient.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) throw new Error("Configuracion de email no encontrada");

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const recipientEmail = (booking.user as any).email;
    const recipientName = `${(booking.user as any).first_name} ${(booking.user as any).last_name}`;
    const tourName = (booking.tour as any).name;
    const agencyName = (booking.agency as any).name;
    const bookingCode = booking.booking_code || booking_id.slice(0, 8).toUpperCase();

    const formatDate = (dateStr: string) => {
      if (!dateStr) return "N/A";
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString("es-MX", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    const formatTime = (timeStr: string) => {
      if (!timeStr) return "";
      return timeStr.slice(0, 5);
    };

    const formatDeadline = (deadlineStr: string) => {
      if (!deadlineStr) return "N/A";
      return new Date(deadlineStr).toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    };


    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cambio de Horario en tu Reserva</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 180px; height: auto; margin-bottom: 15px; display: block; margin-left: auto; margin-right: auto;">
              <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: bold;">Cambio de Horario</h1>
              <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 14px;">Tu reserva ha sido reagendada</p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 18px 30px;">
              <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 15px;">Accion requerida: tienes hasta el ${formatDeadline(response_deadline)} para responder</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 35px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${recipientName}</strong>,
              </p>

              <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                La agencia <strong>${agencyName}</strong> ha reagendado el horario del tour <strong>${tourName}</strong> al que tienes una reserva activa (Codigo: <strong>${bookingCode}</strong>).
              </p>

              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 0 0 25px 0;">
                <p style="margin: 0 0 15px 0; color: #1f2937; font-weight: bold; font-size: 14px;">Detalle del cambio</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 12px; background-color: #fee2e2; border-radius: 6px; width: 45%;">
                      <p style="margin: 0; color: #991b1b; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Horario anterior</p>
                      <p style="margin: 4px 0 0 0; color: #7f1d1d; font-size: 15px; font-weight: bold; text-decoration: line-through;">${formatDate(original_date)}</p>
                      ${original_time ? `<p style="margin: 2px 0 0 0; color: #991b1b; font-size: 13px;">${formatTime(original_time)} hrs</p>` : ""}
                    </td>
                    <td style="width: 10%; text-align: center; color: #6b7280; font-size: 20px;">&#8594;</td>
                    <td style="padding: 8px 12px; background-color: #dcfce7; border-radius: 6px; width: 45%;">
                      <p style="margin: 0; color: #166534; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Nuevo horario</p>
                      <p style="margin: 4px 0 0 0; color: #14532d; font-size: 15px; font-weight: bold;">${formatDate(new_date)}</p>
                      ${new_time ? `<p style="margin: 2px 0 0 0; color: #166534; font-size: 13px;">${formatTime(new_time)} hrs</p>` : ""}
                    </td>
                  </tr>
                </table>
              </div>

              ${reason ? `
              <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 15px; margin: 0 0 25px 0;">
                <p style="margin: 0 0 6px 0; color: #9a3412; font-size: 13px; font-weight: bold;">Motivo del cambio:</p>
                <p style="margin: 0; color: #7c2d12; font-size: 14px; line-height: 1.5; font-style: italic;">"${reason}"</p>
              </div>
              ` : ""}

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 0 0 25px 0;">
                <p style="margin: 0 0 12px 0; color: #1e40af; font-size: 15px; font-weight: bold;">Tienes 2 opciones:</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 0 8px 0 0; width: 50%; vertical-align: top;">
                      <div style="background-color: #ffffff; border: 1px solid #86efac; border-radius: 6px; padding: 14px; text-align: center;">
                        <p style="margin: 0 0 6px 0; font-size: 22px;">✅</p>
                        <p style="margin: 0 0 4px 0; color: #166534; font-weight: bold; font-size: 13px;">Acepto el nuevo horario</p>
                        <p style="margin: 0; color: #4b7c5b; font-size: 12px;">Tu reserva se actualiza automaticamente</p>
                      </div>
                    </td>
                    <td style="padding: 0 0 0 8px; width: 50%; vertical-align: top;">
                      <div style="background-color: #ffffff; border: 1px solid #fca5a5; border-radius: 6px; padding: 14px; text-align: center;">
                        <p style="margin: 0 0 6px 0; font-size: 22px;">💰</p>
                        <p style="margin: 0 0 4px 0; color: #991b1b; font-weight: bold; font-size: 13px;">No puedo asistir</p>
                        <p style="margin: 0; color: #7f1d1d; font-size: 12px;">Reembolso del 100% en ToursRed Cash</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="text-align: center; margin: 0 0 25px 0;">
                <a href="${appUrl}/traveler/bookings"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: bold; font-size: 16px; letter-spacing: 0.3px;">
                  Responder ahora
                </a>
                <p style="margin: 12px 0 0 0; color: #6b7280; font-size: 12px;">
                  Plazo: <strong>${formatDeadline(response_deadline)}</strong><br>
                  Si no respondes, el nuevo horario se aceptara automaticamente.
                </p>
              </div>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">

              <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0;">
                Si tienes dudas contacta a soporte: <strong>${emailSettings.contact_email}</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Este correo fue enviado por ToursRed &bull; &copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
      },
      body: JSON.stringify({
        sender: emailSettings.contact_email,
        to: [recipientEmail],
        subject: `Cambio de horario en tu reserva - ${tourName}`,
        html_body: htmlContent,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok || emailResult.data?.error) {
      console.error("SMTP2GO Error:", emailResult);
      throw new Error(emailResult.data?.error || "Error al enviar email");
    }

    if (request_id) {
      await adminClient
        .from("slot_reschedule_responses")
        .update({ email_sent: true })
        .eq("request_id", request_id)
        .eq("booking_id", booking_id);
    }

    return new Response(
      JSON.stringify({ success: true, email_id: emailResult.data?.email_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error en send-slot-reschedule-notification:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Error interno" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
