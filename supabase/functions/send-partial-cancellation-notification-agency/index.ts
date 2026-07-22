import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.39.6';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  booking_id: string;
  partial_cancellation_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id, partial_cancellation_id }: RequestBody = await req.json();

    const { data: pc, error: pcError } = await supabase
      .from('booking_partial_cancellations')
      .select('*')
      .eq('id', partial_cancellation_id)
      .single();

    if (pcError || !pc) throw new Error('Cancelación parcial no encontrada');

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('user_id, tour_id, agency_id, booking_code, active_travelers_count, travelers_count')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) throw new Error('Reserva no encontrada');

    const { data: user } = await supabase
      .from('users')
      .select('first_name, last_name, email, phone_number')
      .eq('id', booking.user_id)
      .single();

    const { data: tour } = await supabase
      .from('tours')
      .select('id, name, start_date')
      .eq('id', booking.tour_id)
      .single();

    if (!tour) throw new Error('Tour no encontrado');

    const { data: agency } = await supabase
      .from('agencies')
      .select('id, name, contact_email')
      .eq('id', booking.agency_id)
      .single();

    if (!agency || !agency.contact_email) throw new Error('Agencia no encontrada');

    const { data: settings } = await supabase
      .from('email_settings')
      .select('contact_email, smtp_api_key, smtp_host')
      .single();

    if (!settings || !settings.smtp_host) throw new Error('SMTP no configurado');

    const { data: platformSettings } = await supabase
      .from('platform_settings')
      .select('agency_commission_percentage, platform_url')
      .single();

    const commissionRate = platformSettings?.agency_commission_percentage || 15;
    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    const travelers: any[] = pc.travelers_cancelled || [];
    const categoryLabels: Record<string, string> = {
      adulto: 'Adulto',
      nino: 'Niño',
      infante: 'Infante',
      adulto_mayor: 'Adulto Mayor'
    };

    let policyColor = '#ef4444';
    let policyTitle = 'Sin Reembolso (menos de 7 días)';
    let policyDescription = 'El viajero canceló con menos de 7 días de anticipación. No hay reembolso para el viajero.';
    let paymentInfo = `<strong>Recibirá $${Number(pc.amount_to_agency).toFixed(2)}</strong> (anticipo parcial menos comisión del ${commissionRate.toFixed(0)}%) en su próximo depósito.`;

    if (pc.cancellation_policy_type === '100_percent') {
      policyColor = '#10b981';
      policyTitle = 'Reembolso Completo (15+ días)';
      policyDescription = 'El viajero canceló con más de 15 días de anticipación. Se reembolsó el 100% del anticipo parcial al viajero.';
      paymentInfo = 'No recibirá pago por los viajeros cancelados.';
    } else if (pc.cancellation_policy_type === '50_percent') {
      policyColor = '#f59e0b';
      policyTitle = 'Reembolso Parcial (7-14 días)';
      policyDescription = 'El viajero canceló entre 7 y 14 días antes del tour. Se reembolsó el 50% del anticipo parcial al viajero.';
      paymentInfo = `<strong>Recibirá $${Number(pc.amount_to_agency).toFixed(2)}</strong> (70% del 50% retenido) en su próximo depósito de comisiones.`;
    }

    const travelersRows = travelers.map((t: any) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">${t.nombre}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${categoryLabels[t.categoria_viajero] || t.categoria_viajero}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px; text-align: right;">$${Number(t.precio_aplicado).toFixed(2)}</td>
      </tr>
    `).join('');

    const activeCount = booking.active_travelers_count ?? ((booking.travelers_count || 0) - travelers.length);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cancelación Parcial de Viajeros</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 26px;">Cancelación Parcial de Viajeros</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 15px;">Un viajero ha cancelado personas de su reserva</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Estimado equipo de ${agency.name},
              </p>
              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                Un viajero ha realizado una cancelación parcial en una reserva de su tour.
              </p>

              <div style="background-color: #f9fafb; border-left: 4px solid ${policyColor}; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
                <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 17px;">${policyTitle}</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Fecha del tour:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(tour.start_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                  </tr>
                  ${booking.booking_code ? `
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Código de reserva:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${booking.booking_code}</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Viajero titular:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; text-align: right;">${user?.first_name || ''} ${user?.last_name || ''}</td>
                  </tr>
                  ${user?.phone_number ? `
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Teléfono:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; text-align: right;">${user.phone_number}</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Cancelado con:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${pc.days_before_tour} día(s) de anticipación</td>
                  </tr>
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Viajeros cancelados:</td>
                    <td style="padding: 7px 0; color: #dc2626; font-size: 14px; font-weight: 600; text-align: right;">${travelers.length} persona(s)</td>
                  </tr>
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Viajeros activos restantes:</td>
                    <td style="padding: 7px 0; color: #16a34a; font-size: 14px; font-weight: 600; text-align: right;">${activeCount} persona(s)</td>
                  </tr>
                </table>
              </div>

              <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 12px 0;">Viajeros Removidos de la Reserva</h3>
              <table width="100%" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin-bottom: 25px;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; font-weight: 600;">Nombre</th>
                    <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; font-weight: 600;">Categoría</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 13px; color: #6b7280; font-weight: 600;">Anticipo</th>
                  </tr>
                </thead>
                <tbody>${travelersRows}</tbody>
                <tfoot>
                  <tr style="background-color: #f9fafb;">
                    <td colspan="2" style="padding: 10px 12px; font-size: 14px; font-weight: 600; color: #374151;">Total anticipo afectado:</td>
                    <td style="padding: 10px 12px; font-size: 14px; font-weight: 700; color: #1f2937; text-align: right;">$${Number(pc.original_partial_amount).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 16px;">Impacto Financiero</h3>
                <p style="color: #1e3a8a; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">${policyDescription}</p>
                <p style="color: #1e3a8a; font-size: 14px; line-height: 1.6; margin: 0;">${paymentInfo}</p>
              </div>

              ${pc.cancellation_reason ? `
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; margin-bottom: 25px; border-radius: 6px;">
                <p style="color: #374151; font-size: 14px; font-weight: 600; margin: 0 0 6px 0;">Motivo de cancelación:</p>
                <p style="color: #6b7280; font-size: 14px; font-style: italic; margin: 0;">"${pc.cancellation_reason}"</p>
              </div>
              ` : ''}

              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <p style="color: #92400e; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>Nota:</strong> La reserva continúa activa con ${activeCount} viajero(s). Actualice sus listas de pasajeros según corresponda.
                </p>
              </div>

              <div style="text-align: center; margin-top: 25px;">
                <a href="${appUrl}/agency/bookings"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
                  Ver Reservas
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0;">
                © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.<br>
                Este es un correo automático, por favor no respondas a este mensaje.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const sendEmailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: settings.smtp_api_key,
        to: [agency.contact_email],
        sender: settings.contact_email,
        subject: `Cancelación Parcial de Viajeros - ${tour.name}`,
        html_body: emailHtml,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado a la agencia' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
