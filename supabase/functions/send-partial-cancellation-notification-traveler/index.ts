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
      .select('user_id, tour_id, booking_code')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) throw new Error('Reserva no encontrada');

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('id', booking.user_id)
      .single();

    if (userError || !user || !user.email) throw new Error('Usuario no encontrado');

    const { data: tour, error: tourError } = await supabase
      .from('tours')
      .select('id, name, start_date')
      .eq('id', booking.tour_id)
      .single();

    if (tourError || !tour) throw new Error('Tour no encontrado');

    const { data: wallet } = await supabase
      .from('toursred_cash_wallets')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle();

    const currentBalance = wallet?.balance || 0;

    const [{ data: settings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from('email_settings').select('contact_email, smtp_api_key, smtp_host').single(),
      supabase.from('platform_settings').select('platform_url').maybeSingle(),
    ]);

    if (!settings || !settings.smtp_host) throw new Error('SMTP no configurado');

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const travelers: any[] = pc.travelers_cancelled || [];

    let policyColor = '#ef4444';
    let policyBadge = 'Sin Reembolso';
    let policyLabel = 'Sin reembolso (menos de 7 días)';

    if (pc.cancellation_policy_type === '100_percent') {
      policyColor = '#10b981';
      policyBadge = 'Reembolso Completo';
      policyLabel = 'Reembolso del 100% (15+ días)';
    } else if (pc.cancellation_policy_type === '50_percent') {
      policyColor = '#f59e0b';
      policyBadge = 'Reembolso Parcial 50%';
      policyLabel = 'Reembolso del 50% (7-14 días)';
    }

    const categoryLabels: Record<string, string> = {
      adulto: 'Adulto',
      nino: 'Niño',
      infante: 'Infante',
      adulto_mayor: 'Adulto Mayor'
    };

    const travelersRows = travelers.map((t: any) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">${t.nombre}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${categoryLabels[t.categoria_viajero] || t.categoria_viajero}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px; text-align: right;">$${Number(t.precio_aplicado).toFixed(2)}</td>
      </tr>
    `).join('');

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cancelación Parcial Confirmada</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 26px;">Cancelación Parcial Confirmada</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 15px;">Se han cancelado viajeros de tu reserva</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Hola ${user.first_name},</p>
              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                Tu cancelación parcial ha sido procesada exitosamente. A continuación encontrarás los detalles:
              </p>

              <div style="background-color: #f9fafb; border-left: 4px solid ${policyColor}; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
                <div style="display: inline-block; background-color: ${policyColor}; color: white; padding: 5px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; margin-bottom: 12px;">${policyBadge}</div>
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
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Días de anticipación:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${pc.days_before_tour} día(s)</td>
                  </tr>
                  <tr>
                    <td style="padding: 7px 0; color: #6b7280; font-size: 14px;">Política aplicada:</td>
                    <td style="padding: 7px 0; color: #1f2937; font-size: 14px; text-align: right;">${policyLabel}</td>
                  </tr>
                </table>
              </div>

              <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 12px 0;">Viajeros Cancelados</h3>
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
                    <td colspan="2" style="padding: 10px 12px; font-size: 14px; font-weight: 600; color: #374151;">Total anticipo cancelado:</td>
                    <td style="padding: 10px 12px; font-size: 14px; font-weight: 700; color: #1f2937; text-align: right;">$${Number(pc.original_partial_amount).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              ${pc.refund_amount_to_traveler > 0 ? `
              <div style="background-color: #ecfdf5; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 12px 0; font-size: 17px;">Reembolso a ToursRed Cash</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 7px 0; color: #047857; font-size: 14px;">Anticipo parcial original:</td>
                    <td style="padding: 7px 0; color: #047857; font-size: 14px; text-align: right;">$${Number(pc.original_partial_amount).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 7px 0; color: #047857; font-size: 14px; font-weight: 600;">Reembolso acreditado:</td>
                    <td style="padding: 7px 0; color: #065f46; font-size: 18px; font-weight: bold; text-align: right;">$${Number(pc.refund_amount_to_traveler).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top: 12px; border-top: 1px solid #10b981;">
                      <p style="color: #047857; font-size: 14px; margin: 8px 0 0 0;">
                        Tu nuevo balance de ToursRed Cash: <strong>$${Number(currentBalance).toFixed(2)}</strong>
                      </p>
                    </td>
                  </tr>
                </table>
              </div>
              ` : `
              <div style="background-color: #fef2f2; border: 2px solid #ef4444; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #991b1b; margin: 0 0 8px 0; font-size: 16px;">Sin Reembolso</h3>
                <p style="color: #7f1d1d; font-size: 14px; line-height: 1.6; margin: 0;">
                  Debido a que la cancelación se realizó con menos de 7 días de anticipación (o el tour no permite reembolsos), no se generará reembolso. La cancelación se procesó para evitar una penalización de No Show.
                </p>
              </div>
              `}

              ${pc.cancellation_reason ? `
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; margin-bottom: 25px; border-radius: 6px;">
                <p style="color: #374151; font-size: 14px; font-weight: 600; margin: 0 0 6px 0;">Motivo de cancelación:</p>
                <p style="color: #6b7280; font-size: 14px; font-style: italic; margin: 0;">"${pc.cancellation_reason}"</p>
              </div>
              ` : ''}

              <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 0 0 25px 0;">
                Tu reserva continúa activa con los viajeros restantes. Si tienes alguna pregunta, contáctanos.
              </p>

              <div style="text-align: center; margin-top: 25px;">
                <a href="${appUrl}/traveler/bookings"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
                  Ver Mis Reservas
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
        to: [user.email],
        sender: settings.contact_email,
        subject: `Cancelación Parcial Confirmada - ${tour.name}`,
        html_body: emailHtml,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado al viajero' }),
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
