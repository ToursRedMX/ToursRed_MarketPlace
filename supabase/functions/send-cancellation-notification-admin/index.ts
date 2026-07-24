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
  admin_reason_for_traveler?: string;
  admin_reason_for_agency?: string;
  refund_amount?: number;
  refund_method?: string;
  receipt_url?: string | null;
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

    const body: RequestBody = await req.json();
    const {
      booking_id, cancellation_id,
      admin_cancellation, admin_reason_for_traveler, admin_reason_for_agency,
      refund_amount, refund_method, receipt_url
    } = body;

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
      .select('id, user_id, tour_id, agency_id')
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

    if (agencyError || !agency) {
      throw new Error('Agencia no encontrada');
    }

    const { data: emailSettings } = await supabase
      .from('email_settings')
      .select('contact_email, smtp_host, smtp_port, smtp_user, smtp_password, smtp_api_key')
      .single();

    if (!emailSettings || !emailSettings.smtp_host || !emailSettings.contact_email) {
      throw new Error('SMTP o email de administrador no configurado');
    }

    const { data: platformSettings } = await supabase
      .from('platform_settings')
      .select('agency_commission_percentage, platform_url')
      .maybeSingle();

    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    let policyTitle = '';
    let policyColor = '';

    if (admin_cancellation) {
      policyTitle = 'Cancelación Administrativa';
      policyColor = '#7c3aed';
    } else {
      switch (cancellation.cancellation_policy_type) {
        case '100_percent':
          policyTitle = 'Reembolso Completo (15+ días)';
          policyColor = '#10b981';
          break;
        case '50_percent':
          policyTitle = 'Reembolso Parcial (7-14 días)';
          policyColor = '#f59e0b';
          break;
        case 'no_refund':
          policyTitle = 'Sin Reembolso (1-6 días)';
          policyColor = '#ef4444';
          break;
        case 'no_show':
          policyTitle = 'Cancelación Tardía - No Show';
          policyColor = '#991b1b';
          break;
        case 'pending_approval':
          policyTitle = 'Reserva Pendiente Cancelada';
          policyColor = '#6b7280';
          break;
        case 'unpaid_withdrawal':
          policyTitle = 'Cancelación Sin Pago (Retiro de Reserva)';
          policyColor = '#6b7280';
          break;
      }
    }

    // Build admin-specific sections
    let adminReasonsSection = '';
    if (admin_cancellation && (admin_reason_for_traveler || admin_reason_for_agency)) {
      adminReasonsSection = `
      <div style="background-color: #faf5ff; border: 2px solid #7c3aed; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
        <h3 style="color: #5b21b6; margin: 0 0 15px 0; font-size: 16px;">Motivos de Cancelación Administrativa</h3>
        ${admin_reason_for_traveler ? `
        <div style="margin-bottom: 15px;">
          <p style="color: #6d28d9; font-size: 13px; font-weight: 600; margin: 0 0 5px 0;">Motivo para el viajero:</p>
          <p style="color: #4c1d95; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic; padding-left: 15px; border-left: 3px solid #c4b5fd;">
            "${admin_reason_for_traveler}"
          </p>
        </div>
        ` : ''}
        ${admin_reason_for_agency ? `
        <div>
          <p style="color: #6d28d9; font-size: 13px; font-weight: 600; margin: 0 0 5px 0;">Motivo para la agencia:</p>
          <p style="color: #4c1d95; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic; padding-left: 15px; border-left: 3px solid #c4b5fd;">
            "${admin_reason_for_agency}"
          </p>
        </div>
        ` : ''}
      </div>`;
    }

    let adminRefundSection = '';
    if (admin_cancellation) {
      const refundAmt = Number(refund_amount || 0);
      if (refundAmt > 0) {
        const methodLabel = refund_method === 'toursred_cash' ? 'ToursRed Cash' : 'Transferencia Bancaria';
        adminRefundSection = `
        <div style="background-color: #ecfdf5; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
          <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 16px;">Reembolso Procesado</h3>
          <table width="100%" style="border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #047857; font-size: 14px;">Monto reembolsado:</td>
              <td style="padding: 8px 0; color: #065f46; font-size: 18px; font-weight: bold; text-align: right;">$${refundAmt.toFixed(2)} MXN</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #047857; font-size: 14px;">Método:</td>
              <td style="padding: 8px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${methodLabel}</td>
            </tr>
            ${refund_method === 'bank_transfer' && receipt_url ? `
            <tr>
              <td colspan="2" style="padding-top: 12px;">
                <a href="${receipt_url}" style="color: #2563eb; font-size: 13px; text-decoration: underline;">Descargar comprobante de transferencia</a>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>`;
      } else {
        adminRefundSection = `
        <div style="background-color: #f3f4f6; border: 2px solid #6b7280; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
          <h3 style="color: #374151; margin: 0 0 10px 0; font-size: 16px;">Sin Reembolso</h3>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">La cancelación se procesó sin reembolso al viajero.</p>
        </div>`;
      }
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte de Cancelación - Admin</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="700" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 28px;">${admin_cancellation ? 'Cancelación Administrativa' : 'Reporte de Cancelación'}</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 16px;">Notificación para Administración</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${admin_cancellation ? 'El equipo administrativo de ToursRed ha procesado una cancelación.' : 'Se ha procesado una nueva cancelación en el sistema.'}
              </p>

              <div style="background-color: #f9fafb; border-left: 4px solid ${policyColor}; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
                <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">${policyTitle}</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 40%;">ID de Cancelación:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 13px; font-family: monospace; text-align: right;">${cancellation.id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">ID de Reserva:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 13px; font-family: monospace; text-align: right;">${booking.id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Fecha de cancelación:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(cancellation.cancelled_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                  ${!admin_cancellation ? `
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Días antes del tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.days_before_tour} día(s)</td>
                  </tr>
                  ` : ''}
                </table>
              </div>

              ${adminReasonsSection}

              <div style="background-color: #eff6ff; border: 2px solid #3b82f6; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px;">Información del Viajero</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; width: 40%;">Nombre:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; font-weight: 600; text-align: right;">${user.first_name} ${user.last_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Email:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${user.email}</td>
                  </tr>
                  ${user.phone_number ? `
                  <tr>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px;">Teléfono:</td>
                    <td style="padding: 6px 0; color: #1e3a8a; font-size: 14px; text-align: right;">${user.phone_number}</td>
                  </tr>
                  ` : ''}
                </table>
              </div>

              <div style="background-color: #f0fdf4; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 16px;">Tour y Agencia</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; width: 40%;">Tour:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Fecha del tour:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${new Date(tour.start_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Agencia:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${agency.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px;">Email agencia:</td>
                    <td style="padding: 6px 0; color: #047857; font-size: 14px; text-align: right;">${agency.contact_email}</td>
                  </tr>
                </table>
              </div>

              ${admin_cancellation ? adminRefundSection : `
              <div style="background-color: #fef9c3; border: 2px solid #eab308; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #713f12; margin: 0 0 15px 0; font-size: 16px;">Desglose Financiero</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px;">Anticipo original:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right;">$${cancellation.original_deposit_amount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px;">Cargo por servicio original:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.original_service_charge.toFixed(2)}</td>
                  </tr>
                  ${cancellation.service_charge_refunded_amount > 0 ? `
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px;">Cargo por servicio reembolsado:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.service_charge_refunded_amount.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  ${cancellation.insurance_refund_amount > 0 ? `
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px;">Seguro de viaje reembolsado:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.insurance_refund_amount.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  ${cancellation.optional_services_refund_amount > 0 ? `
                  <tr>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px;">Servicios opcionales reembolsados:</td>
                    <td style="padding: 8px 0; color: #854d0e; font-size: 14px; font-weight: 600; text-align: right;">${cancellation.optional_services_refund_amount.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  <tr style="border-top: 2px solid #eab308;">
                    <td style="padding: 12px 0 8px 0; color: #713f12; font-size: 14px; font-weight: bold;">Reembolsado al viajero:</td>
                    <td style="padding: 12px 0 8px 0; color: #10b981; font-size: 16px; font-weight: bold; text-align: right;">$${cancellation.refund_amount_to_traveler.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #713f12; font-size: 14px; font-weight: bold;">A pagar a la agencia:</td>
                    <td style="padding: 8px 0; color: #3b82f6; font-size: 16px; font-weight: bold; text-align: right;">$${cancellation.amount_to_agency.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #713f12; font-size: 14px; font-weight: bold;">Ganancia de la plataforma:</td>
                    <td style="padding: 8px 0; color: #8b5cf6; font-size: 16px; font-weight: bold; text-align: right;">$${cancellation.amount_to_platform.toFixed(2)}</td>
                  </tr>
                </table>
              </div>
              `}

              ${!admin_cancellation && cancellation.cancellation_reason ? `
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; margin-bottom: 25px; border-radius: 8px;">
                <h4 style="color: #374151; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Motivo de cancelación:</h4>
                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic;">
                  "${cancellation.cancellation_reason}"
                </p>
              </div>
              ` : ''}

              <div style="text-align: center; margin-top: 30px;">
                <a href="${appUrl}/admin/bookings"
                   style="display: inline-block; background-color: #667eea; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 15px;">
                  Ver Reservas
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

    const subject = admin_cancellation
      ? `[Admin] Cancelación Administrativa - ${tour.name}`
      : `[Admin] Cancelación de Reserva - ${tour.name}`;

    const sendEmailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: emailSettings.smtp_api_key,
        to: [emailSettings.contact_email],
        sender: emailSettings.contact_email,
        subject,
        html_body: emailHtml,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado al administrador' }),
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
