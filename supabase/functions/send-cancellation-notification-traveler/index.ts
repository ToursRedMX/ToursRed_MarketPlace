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
  refund_amount?: number;
  refund_method?: string;
  receipt_url?: string | null;
  receipt_file_path?: string | null;
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
    const { booking_id, cancellation_id, admin_cancellation, admin_reason, refund_amount, refund_method, receipt_url, receipt_file_path } = body;

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
      .select('user_id, tour_id')
      .eq('id', cancellation.booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error('Reserva no encontrada');
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('id', booking.user_id)
      .single();

    if (userError || !user || !user.email) {
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

    const { data: wallet } = await supabase
      .from('toursred_cash_wallets')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle();

    const currentBalance = wallet?.balance || 0;

    const [{ data: settings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from('email_settings').select('contact_email, smtp_host, smtp_port, smtp_user, smtp_password, smtp_api_key').single(),
      supabase.from('platform_settings').select('platform_url').maybeSingle(),
    ]);

    if (!settings || !settings.smtp_host) {
      throw new Error('SMTP no configurado');
    }

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    let policyTitle = '';
    let policyColor = '';
    let policyBadge = '';

    if (admin_cancellation) {
      policyTitle = 'Cancelación Administrativa';
      policyColor = '#7c3aed';
      policyBadge = 'Cancelación Administrativa';
    } else {
      switch (cancellation.cancellation_policy_type) {
        case '100_percent':
          policyTitle = 'Reembolso del 100%';
          policyColor = '#10b981';
          policyBadge = 'Reembolso Completo';
          break;
        case '50_percent':
          policyTitle = 'Reembolso del 50%';
          policyColor = '#f59e0b';
          policyBadge = 'Reembolso Parcial';
          break;
        case 'no_refund':
          policyTitle = 'Sin Reembolso';
          policyColor = '#ef4444';
          policyBadge = 'Sin Reembolso';
          break;
        case 'no_show':
          policyTitle = 'Cancelación Tardía - No Show';
          policyColor = '#991b1b';
          policyBadge = 'No Show';
          break;
        case 'pending_approval':
          policyTitle = 'Reserva Pendiente Cancelada';
          policyColor = '#6b7280';
          policyBadge = 'Sin Cargos';
          break;
      }
    }

    // Build refund section for admin cancellation
    let adminRefundSection = '';
    if (admin_cancellation) {
      const refundAmt = Number(refund_amount || 0);
      if (refundAmt > 0) {
        const methodLabel = refund_method === 'toursred_cash' ? 'ToursRed Cash' : 'Transferencia Bancaria';
        adminRefundSection = `
        <div style="background-color: #ecfdf5; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
          <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 18px;">Detalles del Reembolso</h3>
          <table width="100%" style="border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #047857; font-size: 14px;">Monto reembolsado:</td>
              <td style="padding: 8px 0; color: #065f46; font-size: 18px; font-weight: bold; text-align: right;">$${refundAmt.toFixed(2)} MXN</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #047857; font-size: 14px;">Método:</td>
              <td style="padding: 8px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">${methodLabel}</td>
            </tr>
            ${refund_method === 'toursred_cash' ? `
            <tr>
              <td colspan="2" style="padding-top: 15px; border-top: 1px solid #10b981; margin-top: 10px;">
                <p style="color: #047857; font-size: 14px; margin: 10px 0 0 0;">
                  Tu nuevo balance de ToursRed Cash: <strong>$${currentBalance.toFixed(2)}</strong>
                </p>
              </td>
            </tr>
            ` : ''}
            ${refund_method === 'bank_transfer' && receipt_url ? `
            <tr>
              <td colspan="2" style="padding-top: 15px; border-top: 1px solid #10b981;">
                <p style="color: #047857; font-size: 14px; margin: 10px 0 0 0;">
                  Puedes descargar el comprobante de transferencia adjunto a este correo.
                </p>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>`;
      }
    }

    // Build admin reason section
    let adminReasonSection = '';
    if (admin_cancellation && admin_reason) {
      adminReasonSection = `
      <div style="background-color: #f9fafb; border-left: 4px solid #7c3aed; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
        <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">Motivo de Cancelación</h3>
        <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0;">
          ${admin_reason}
        </p>
      </div>`;
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmación de Cancelación</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color: #b8dfe6; padding: 30px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 10px;" />
              <h1 style="color: #1e40af; margin: 0; font-size: 28px;">Cancelación Confirmada</h1>
              <p style="color: #1e40af; margin: 10px 0 0 0; font-size: 16px;">${admin_cancellation ? 'Tu reserva ha sido cancelada administrativamente' : 'Tu reserva ha sido cancelada exitosamente'}</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px;">
              <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola ${user.first_name},
              </p>

              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                ${admin_cancellation ? 'Tu reserva ha sido cancelada por el equipo administrativo de ToursRed. A continuación encontrarás los detalles:' : 'Tu cancelación ha sido procesada con éxito. A continuación encontrarás los detalles:'}
              </p>

              <div style="background-color: #f9fafb; border-left: 4px solid ${policyColor}; padding: 20px; margin-bottom: 25px; border-radius: 4px;">
                <div style="display: inline-block; background-color: ${policyColor}; color: white; padding: 6px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; margin-bottom: 15px;">
                  ${policyBadge}
                </div>
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

              ${adminReasonSection}

              ${admin_cancellation ? adminRefundSection : ''}

              ${!admin_cancellation && cancellation.refund_amount_to_traveler > 0 ? `
              <div style="background-color: #ecfdf5; border: 2px solid #10b981; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #065f46; margin: 0 0 15px 0; font-size: 18px;">Detalles del Reembolso</h3>
                <table width="100%" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #047857; font-size: 14px;">Anticipo original:</td>
                    <td style="padding: 8px 0; color: #047857; font-size: 14px; font-weight: 600; text-align: right;">$${cancellation.original_deposit_amount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #047857; font-size: 14px;">Reembolsado a ToursRed Cash:</td>
                    <td style="padding: 8px 0; color: #065f46; font-size: 18px; font-weight: bold; text-align: right;">$${cancellation.refund_amount_to_traveler.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top: 15px; border-top: 1px solid #10b981; margin-top: 10px;">
                      <p style="color: #047857; font-size: 14px; margin: 10px 0 0 0;">
                        Tu nuevo balance de ToursRed Cash: <strong>$${currentBalance.toFixed(2)}</strong>
                      </p>
                    </td>
                  </tr>
                </table>
              </div>
              ` : ''}

              ${!admin_cancellation && (cancellation.cancellation_policy_type === 'no_refund' || cancellation.cancellation_policy_type === 'no_show') ? `
              <div style="background-color: #fef2f2; border: 2px solid #ef4444; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #991b1b; margin: 0 0 10px 0; font-size: 16px;">Información Importante</h3>
                <p style="color: #7f1d1d; font-size: 14px; line-height: 1.6; margin: 0;">
                  ${cancellation.cancellation_policy_type === 'no_show'
                    ? 'Al cancelar con menos de 1 día de anticipación, se ha registrado un No Show en tu perfil. Esto puede afectar tu capacidad para hacer reservas futuras.'
                    : 'No se realizará reembolso debido a la proximidad de la fecha del tour, sin embargo, no se te marcará como No Show.'}
                </p>
              </div>
              ` : ''}

              ${!admin_cancellation && cancellation.cancellation_policy_type === 'pending_approval' ? `
              <div style="background-color: #f3f4f6; border: 2px solid #6b7280; padding: 20px; margin-bottom: 25px; border-radius: 8px;">
                <h3 style="color: #374151; margin: 0 0 10px 0; font-size: 16px;">Reserva Pendiente</h3>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 0;">
                  Esta reserva estaba pendiente de aprobación por la agencia y no se había realizado ningún pago. La cancelación no tiene ningún costo.
                </p>
              </div>
              ` : ''}

              ${!admin_cancellation && cancellation.original_service_charge > 0 ? `
              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <p style="color: #92400e; font-size: 13px; line-height: 1.6; margin: 0;">
                  <strong>Nota:</strong> El cargo por servicio de $${cancellation.original_service_charge.toFixed(2)} no es reembolsable. Si utilizaste beneficios de ToursRed+, estos tampoco son recuperables.
                </p>
              </div>
              ` : ''}

              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 25px 0 0 0;">
                Si tienes alguna pregunta sobre esta cancelación, no dudes en contactarnos.
              </p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="${appUrl}/traveler/bookings"
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

    // For bank transfer refunds, try to attach the receipt file
    let attachments: any[] = [];
    if (admin_cancellation && refund_method === 'bank_transfer' && receipt_file_path) {
      try {
        const { data: fileData, error: fileErr } = await supabase.storage
          .from('cancellation-receipts')
          .download(receipt_file_path);

        if (fileData && !fileErr) {
          const arrayBuffer = await fileData.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          const fileName = receipt_file_path.split("/").pop() || "comprobante.pdf";
          const fileExt = fileName.split(".").pop()?.toLowerCase() || "pdf";
          const mimeType = fileExt === "pdf" ? "application/pdf"
            : fileExt === "png" ? "image/png"
            : "image/jpeg";

          attachments = [{
            filename: fileName,
            fileblob: base64,
            mimetype: mimeType,
          }];
        }
      } catch (e) {
        console.error('Error downloading receipt for attachment:', e);
      }
    }

    const subject = admin_cancellation
      ? `Cancelación Administrativa - ${tour.name}`
      : `Confirmación de Cancelación - ${tour.name}`;

    const emailPayload: any = {
      api_key: settings.smtp_api_key,
      to: [user.email],
      sender: settings.contact_email,
      subject,
      html_body: emailHtml,
    };

    if (attachments.length > 0) {
      emailPayload.attachments = attachments;
    }

    const sendEmailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado al viajero' }),
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
