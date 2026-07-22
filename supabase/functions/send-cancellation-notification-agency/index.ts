import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.39.6';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  booking_id: string;
  cancellation_id: string;
  admin_cancellation?: boolean;
  admin_reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id, cancellation_id, admin_cancellation, admin_reason }: RequestBody = await req.json();

    const { data: cancellation, error: cancellationError } = await supabase
      .from('booking_cancellations')
      .select('*')
      .eq('id', cancellation_id)
      .single();

    if (cancellationError || !cancellation) {
      throw new Error('Cancelación no encontrada');
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('user_id, tour_id, agency_id')
      .eq('id', cancellation.booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error('Reserva no encontrada');
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, phone_number')
      .eq('id', booking.user_id)
      .single();

    if (userError || !user) {
      throw new Error('Usuario no encontrado');
    }

    const { data: tour, error: tourError } = await supabase
      .from('tours')
      .select('id, name, start_date')
      .eq('id', booking.tour_id)
      .single();

    if (tourError || !tour) {
      throw new Error('Tour no encontrado');
    }

    const { data: agency, error: agencyError } = await supabase
      .from('agencies')
      .select('id, name, contact_email')
      .eq('id', booking.agency_id)
      .single();

    if (agencyError || !agency || !agency.contact_email) {
      throw new Error('Agencia no encontrada');
    }

    const { data: emailSettings } = await supabase
      .from('email_settings')
      .select('contact_email, smtp_host, smtp_port, smtp_user, smtp_password, smtp_api_key')
      .single();

    if (!emailSettings || !emailSettings.smtp_host) {
      throw new Error('SMTP no configurado');
    }

    const { data: platformSettings } = await supabase
      .from('platform_settings')
      .select('agency_commission_percentage, platform_url')
      .single();

    const commissionRate = platformSettings?.agency_commission_percentage || 15;
    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    let policyTitle = '';
    let policyColor = '';
    let policyDescription = '';
    let paymentInfo = '';

    if (admin_cancellation) {
      policyTitle = 'Cancelación Administrativa';
      policyColor = '#7c3aed';
      policyDescription = 'El equipo administrativo de ToursRed ha cancelado esta reserva.';
      paymentInfo = 'No recibirá ningún pago por esta reserva.';
    } else {
      switch (cancellation.cancellation_policy_type) {
        case '100_percent':
          policyTitle = 'Reembolso Completo (15+ días)';
          policyColor = '#10b981';
          policyDescription = 'El viajero canceló con más de 15 días de anticipación y recibió un reembolso del 100% en su ToursRed Cash.';
          paymentInfo = 'No recibirá ningún pago por esta reserva.';
          break;
        case '50_percent':
          policyTitle = 'Reembolso Parcial (7-14 días)';
          policyColor = '#f59e0b';
          policyDescription = 'El viajero canceló entre 7 y 14 días antes del tour. Se reembolsó el 50% del anticipo al viajero.';
          paymentInfo = `<strong>Recibirá ${cancellation.amount_to_agency.toFixed(2)}</strong> (70% del 50% retenido) en su próximo depósito de comisiones.`;
          break;
        case 'no_refund':
          policyTitle = 'Sin Reembolso (1-6 días)';
          policyColor = '#ef4444';
          policyDescription = 'El viajero canceló entre 1 y 6 días antes del tour. No hay reembolso para el viajero.';
          paymentInfo = `<strong>Recibirá ${cancellation.amount_to_agency.toFixed(2)}</strong> (anticipo menos comisión del ${commissionRate.toFixed(0)}%) en su próximo depósito de comisiones.`;
          break;
        case 'no_show':
          policyTitle = 'Cancelación Tardía - No Show';
          policyColor = '#991b1b';
          policyDescription = 'El viajero canceló con menos de 1 día de anticipación y se marcó como No Show.';
          paymentInfo = `<strong>Recibirá ${cancellation.amount_to_agency.toFixed(2)}</strong> (anticipo menos comisión del ${commissionRate.toFixed(0)}%) en su próximo depósito de comisiones.`;
          break;
        case 'pending_approval':
          policyTitle = 'Reserva Pendiente Cancelada';
          policyColor = '#6b7280';
          policyDescription = 'El viajero canceló una reserva que aún estaba pendiente de su aprobación. No se había realizado ningún pago.';
          paymentInfo = 'No había pago asociado a esta reserva.';
          break;
      }
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notificación de Cancelación</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 28px;">Cancelación de Reserva</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 16px;">${admin_cancellation ? 'Cancelación administrativa de reserva' : 'Un viajero ha cancelado su reserva'}</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Estimado equipo de ${agency.name},
              </p>

              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                ${admin_cancellation ? 'Le informamos que el equipo administrativo de ToursRed ha cancelado una reserva para uno de sus tours.' : 'Le informamos que se ha cancelado una reserva para uno de sus tours.'}
              </p>

              <div style="background-color: #f9fafb; border-left: 4px solid ${policyColor}; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
                <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">${policyTitle}</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Fecha del tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(tour.start_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Viajero:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${user.first_name} ${user.last_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Email del viajero:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${user.email}</td>
                  </tr>
                  ${user.phone_number ? `
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Teléfono:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${user.phone_number}</td>
                  </tr>
                  ` : ''}
                  ${!admin_cancellation ? `
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Cancelado con:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.days_before_tour} día(s) de anticipación</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Fecha de cancelación:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(cancellation.cancelled_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 16px;">📋 Política Aplicada</h3>
                <p style="color: #1e3a8a; font-size: 14px; line-height: 1.6; margin: 0 0 15px 0;">
                  ${policyDescription}
                </p>
                <p style="color: #1e3a8a; font-size: 14px; line-height: 1.6; margin: 0;">
                  ${paymentInfo}
                </p>
              </div>

              ${(admin_cancellation && admin_reason) || (!admin_cancellation && cancellation.cancellation_reason) ? `
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; margin-bottom: 25px; border-radius: 8px;">
                <h4 style="color: #374151; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Motivo de cancelación:</h4>
                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic;">
                  "${admin_cancellation ? admin_reason : cancellation.cancellation_reason}"
                </p>
              </div>
              ` : ''}

              ${cancellation.cancellation_policy_type !== 'pending_approval' ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <p style="color: #92400e; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>Nota:</strong> El botón "Marcar No Show" ya no aparecerá para esta reserva en su panel de control, ya que el viajero canceló con anticipación.
                </p>
              </div>
              ` : ''}

              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 25px 0 0 0;">
                Si tiene alguna pregunta sobre esta cancelación, por favor contáctenos.
              </p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${appUrl}/agency/bookings"
                   style="display: inline-block; background-color: #667eea; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
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
</html>
    `;

    const emailData = {
      from: `ToursRed <${emailSettings.contact_email}>`,
      to: agency.contact_email,
      subject: admin_cancellation ? `Cancelación Administrativa de Reserva - ${tour.name}` : `Cancelación de Reserva - ${tour.name}`,
      html: emailHtml,
    };

    const sendEmailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: emailSettings.smtp_api_key,
        to: [agency.contact_email],
        sender: emailSettings.contact_email,
        subject: emailData.subject,
        html_body: emailData.html,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado a la agencia' }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
