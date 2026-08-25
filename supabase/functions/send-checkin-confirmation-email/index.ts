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

    const { booking_id, checkin_type, no_show_traveler_names } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "booking_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, booking_code, total_price, deposit_amount, travelers_count, checkin_at,
        tour:tours(name, destination, start_date, end_date),
        traveler:users!bookings_user_id_fkey(first_name, last_name, email),
        agency:agencies(name, contact_email, contact_phone)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ success: false, message: "Configuración de email no disponible" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatDateTime = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleString('es-MX', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    };

    const isPartial = checkin_type === 'partial';
    const noShowNames: string[] = no_show_traveler_names || [];

    const noShowSection = isPartial && noShowNames.length > 0 ? `
      <div style="background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <div style="font-weight: bold; color: #92400e; margin-bottom: 8px;">Viajeros con inasistencia registrada:</div>
        <ul style="margin: 0; padding-left: 20px; color: #92400e;">
          ${noShowNames.map(name => `<li>${name}</li>`).join('')}
        </ul>
        <div style="font-size: 12px; color: #92400e; margin-top: 8px;">
          Si consideras que esto es un error, por favor contacta a la agencia directamente.
        </div>
      </div>
    ` : '';

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .badge { display: inline-block; background-color: #dcfce7; color: #166534; font-weight: bold; padding: 6px 16px; border-radius: 20px; font-size: 14px; margin-bottom: 16px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; border-bottom: 2px solid #dbeafe; padding-bottom: 6px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .success-box { background-color: #dcfce7; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">${isPartial ? 'Check-in Parcial Registrado' : 'Asistencia Confirmada'}</h1>
    </div>
    <div class="content">
      <div class="badge">${isPartial ? 'CHECK-IN PARCIAL' : 'CHECK-IN COMPLETO'}</div>

      <p>Estimado/a <strong>${booking.traveler.first_name} ${booking.traveler.last_name}</strong>,</p>

      <p>${isPartial
        ? 'Tu asistencia al tour ha sido registrada. Sin embargo, se reportó que no todos los viajeros de tu reserva se presentaron.'
        : '¡Tu asistencia al tour ha sido confirmada exitosamente por la agencia!'
      }</p>

      <div class="success-box">
        <div style="font-size: 13px; color: #166534; margin-bottom: 6px;">Código de Reserva</div>
        <div style="font-size: 26px; font-weight: bold; color: #166534; letter-spacing: 2px;">${booking.booking_code}</div>
        <div style="font-size: 12px; color: #166534; margin-top: 6px;">
          Check-in registrado el ${formatDateTime(booking.checkin_at || new Date().toISOString())}
        </div>
      </div>

      ${noShowSection}

      <div class="section">
        <div class="section-title">Detalles del Tour</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Destino:</span>
          <span class="info-value">${booking.tour.destination}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha de inicio:</span>
          <span class="info-value">${formatDate(booking.tour.start_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha de finalización:</span>
          <span class="info-value">${formatDate(booking.tour.end_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Total de viajeros:</span>
          <span class="info-value">${booking.travelers_count}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Agencia</div>
        <div class="info-row">
          <span class="info-label">Nombre:</span>
          <span class="info-value">${booking.agency.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.agency.contact_email}</span>
        </div>
        ${booking.agency.contact_phone ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.agency.contact_phone}</span>
        </div>
        ` : ''}
      </div>

      <p style="margin-top: 30px;">¡Esperamos que hayas disfrutado tu tour con <strong>${booking.agency.name}</strong>!</p>
      <p><strong>El equipo de ToursRed</strong></p>
    </div>
    <div class="footer">
      <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [booking.traveler.email],
      sender: emailSettings.contact_email,
      subject: isPartial
        ? `Check-in Parcial Registrado - ${booking.tour.name}`
        : `Asistencia Confirmada - ${booking.tour.name}`,
      html_body: emailHtml,
    };

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error("Error enviando email de check-in:", result);
      return new Response(
        JSON.stringify({ success: false, error: result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Email de confirmación de check-in enviado" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en send-checkin-confirmation-email:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
