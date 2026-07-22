import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id, refund_amount } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "booking_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener datos del booking con tour, viajero y agencia
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        selected_date,
        travelers_count,
        deposit_amount,
        user_id,
        agency_id,
        tour:tours(id, name, destination),
        agency:agencies(id, name, contact_email),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      throw new Error("Reserva no encontrada");
    }

    const agencyEmail = (booking.agency as any)?.contact_email;
    if (!agencyEmail) {
      throw new Error("Email de agencia no encontrado");
    }

    // Obtener configuracion SMTP y URL de plataforma
    const [{ data: settings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("contact_email, smtp_api_key").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!settings?.smtp_api_key) {
      throw new Error("SMTP no configurado");
    }

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const totalRefund: number = refund_amount ?? 0;
    const tourName = (booking.tour as any)?.name ?? "Tour";
    const agencyName = (booking.agency as any)?.name ?? "Agencia";
    const traveler = (booking.traveler as any);
    const travelerName = traveler
      ? `${traveler.first_name} ${traveler.last_name}`.trim()
      : "El viajero";

    const formatDate = (d: string) =>
      new Date(d).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reserva Cancelada - Sin Respuesta al Reagendamiento</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:#b8dfe6;padding:30px 20px;text-align:center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png"
                   alt="ToursRed Logo" style="max-width:200px;height:auto;margin-bottom:10px;" />
              <h1 style="color:#1e40af;margin:0;font-size:26px;">Reserva Cancelada por Plazo Vencido</h1>
              <p style="color:#1e40af;margin:10px 0 0 0;font-size:15px;">El viajero no respondio al cambio de horario a tiempo</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <p style="color:#1f2937;font-size:16px;line-height:1.6;margin:0 0 20px 0;">
                Hola equipo de <strong>${agencyName}</strong>,
              </p>

              <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 25px 0;">
                Te informamos que la reserva de <strong>${travelerName}</strong> para el tour
                <strong>${tourName}</strong> fue <strong>cancelada automaticamente</strong> porque el viajero
                no respondio al cambio de horario antes del plazo establecido.
              </p>

              <!-- Detalle de reserva -->
              <div style="background-color:#f9fafb;border-left:4px solid #ef4444;padding:20px;margin-bottom:25px;border-radius:4px;">
                <h3 style="color:#1f2937;margin:0 0 15px 0;font-size:17px;">Detalles de la Reserva</h3>
                <table width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Tour:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Viajero:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;">${travelerName}</td>
                  </tr>
                  ${traveler?.email ? `
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Email del viajero:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;">${traveler.email}</td>
                  </tr>
                  ` : ""}
                  ${booking.booking_code ? `
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Codigo de reserva:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;font-family:monospace;">${booking.booking_code}</td>
                  </tr>
                  ` : ""}
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Fecha original:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;">${booking.selected_date ? formatDate(booking.selected_date) : "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Viajeros:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;">${booking.travelers_count ?? 1}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Motivo de cancelacion:</td>
                    <td style="padding:8px 0;color:#ef4444;font-size:14px;font-weight:600;text-align:right;">Sin respuesta al reagendamiento</td>
                  </tr>
                </table>
              </div>

              <!-- Reembolso info -->
              ${totalRefund > 0 ? `
              <div style="background-color:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin-bottom:25px;border-radius:4px;">
                <p style="color:#92400e;font-size:14px;line-height:1.6;margin:0;">
                  <strong>Nota:</strong> Se reembolsaron <strong>$${totalRefund.toFixed(2)}</strong> al viajero en su billetera ToursRed Cash. Esta cancelacion no genera penalizacion para el viajero ya que el cambio de horario fue iniciado por la agencia.
                </p>
              </div>
              ` : ""}

              <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 15px 0;">
                Puedes revisar el estado actualizado de tu tour y los cupos disponibles desde tu panel de agencia.
              </p>

              <div style="text-align:center;margin-top:30px;">
                <a href="${appUrl}/agency/bookings"
                   style="display:inline-block;background-color:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:6px;font-weight:bold;font-size:15px;">
                  Ver Reservas de la Agencia
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 30px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
                &copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.<br>
                Este es un correo automatico, por favor no respondas a este mensaje.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const smtpRes = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: settings.smtp_api_key,
        to: [agencyEmail],
        sender: settings.contact_email,
        subject: `Reserva cancelada por plazo vencido - ${tourName} (${travelerName})`,
        html_body: emailHtml,
      }),
    });

    if (!smtpRes.ok) {
      const err = await smtpRes.text();
      throw new Error(`SMTP error: ${err}`);
    }

    console.log(`Email auto-cancel enviado a agencia: ${agencyEmail}`);

    return new Response(
      JSON.stringify({ success: true, sent_to: agencyEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
