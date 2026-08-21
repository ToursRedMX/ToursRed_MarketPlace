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

    // Obtener datos del booking con tour y agencia
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        selected_date,
        selected_time,
        travelers_count,
        deposit_amount,
        toursred_cash_used,
        user_id,
        tour:tours(id, name, destination),
        agency:agencies(id, name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      throw new Error("Reserva no encontrada");
    }

    // Obtener datos del viajero
    const { data: traveler, error: travelerError } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .eq("id", booking.user_id)
      .maybeSingle();

    if (travelerError || !traveler || !traveler.email) {
      throw new Error("Viajero no encontrado");
    }

    // Obtener balance actualizado del wallet
    const { data: wallet } = await supabase
      .from("toursred_cash_wallets")
      .select("balance")
      .eq("user_id", traveler.id)
      .maybeSingle();

    const currentBalance = wallet?.balance ?? 0;

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
    const agencyName = (booking.agency as any)?.name ?? "la agencia";

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
  <title>Reserva Cancelada Automaticamente</title>
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
              <h1 style="color:#1e40af;margin:0;font-size:26px;">Reserva Cancelada Automaticamente</h1>
              <p style="color:#1e40af;margin:10px 0 0 0;font-size:15px;">No respondiste al cambio de horario propuesto</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <p style="color:#1f2937;font-size:16px;line-height:1.6;margin:0 0 20px 0;">
                Hola ${traveler.first_name},
              </p>

              <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 25px 0;">
                La agencia <strong>${agencyName}</strong> propuso un cambio de horario para tu reserva del tour
                <strong>${tourName}</strong>. Como no respondiste antes del plazo establecido,
                <strong>tu reserva fue cancelada automaticamente sin penalizacion</strong>.
              </p>

              <!-- Detalle de reserva -->
              <div style="background-color:#f9fafb;border-left:4px solid #ef4444;padding:20px;margin-bottom:25px;border-radius:4px;">
                <h3 style="color:#1f2937;margin:0 0 15px 0;font-size:17px;">Detalles de la Reserva Cancelada</h3>
                <table width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Tour:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:14px;">Agencia:</td>
                    <td style="padding:8px 0;color:#1f2937;font-size:14px;text-align:right;">${agencyName}</td>
                  </tr>
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
                </table>
              </div>

              <!-- Reembolso -->
              ${totalRefund > 0 ? `
              <div style="background-color:#ecfdf5;border:2px solid #10b981;padding:20px;margin-bottom:25px;border-radius:8px;">
                <h3 style="color:#065f46;margin:0 0 15px 0;font-size:17px;">Reembolso Procesado</h3>
                <table width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#047857;font-size:14px;">Monto reembolsado:</td>
                    <td style="padding:8px 0;color:#065f46;font-size:20px;font-weight:bold;text-align:right;">$${totalRefund.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#047857;font-size:14px;">Metodo:</td>
                    <td style="padding:8px 0;color:#047857;font-size:14px;text-align:right;">ToursRed Cash</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#047857;font-size:14px;">Tu balance actual:</td>
                    <td style="padding:8px 0;color:#065f46;font-size:14px;font-weight:600;text-align:right;">$${currentBalance.toFixed(2)}</td>
                  </tr>
                </table>
                <p style="color:#047857;font-size:13px;margin:15px 0 0 0;line-height:1.6;">
                  El monto fue acreditado inmediatamente a tu billetera ToursRed Cash y esta disponible para usar en tu proxima reserva.
                </p>
              </div>
              ` : `
              <div style="background-color:#f3f4f6;border:1px solid #d1d5db;padding:20px;margin-bottom:25px;border-radius:8px;">
                <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">
                  Esta cancelacion no genera cargo alguno ya que fue originada por un cambio de horario de la agencia al que no respondiste en tiempo.
                </p>
              </div>
              `}

              <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:15px;margin-bottom:25px;border-radius:4px;">
                <p style="color:#92400e;font-size:13px;line-height:1.6;margin:0;">
                  <strong>Para el futuro:</strong> cuando recibas una solicitud de cambio de horario, asegurate de responderla antes del plazo indicado. Si no puedes asistir al nuevo horario, rechazala para recibir tu reembolso de inmediato.
                </p>
              </div>

              <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:25px 0 0 0;">
                Si tienes dudas, contacta al equipo de soporte de ToursRed.
              </p>

              <div style="text-align:center;margin-top:30px;">
                <a href="${appUrl}/traveler/bookings"
                   style="display:inline-block;background-color:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:6px;font-weight:bold;font-size:15px;">
                  Ver Mis Reservas
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
        to: [traveler.email],
        sender: settings.contact_email,
        subject: `Tu reserva fue cancelada automaticamente - ${tourName}`,
        html_body: emailHtml,
      }),
    });

    if (!smtpRes.ok) {
      const err = await smtpRes.text();
      throw new Error(`SMTP error: ${err}`);
    }

    console.log(`Email auto-cancel enviado a viajero: ${traveler.email}`);

    return new Response(
      JSON.stringify({ success: true, sent_to: traveler.email }),
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
