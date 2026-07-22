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

    const { data: booking } = await supabase
      .from('bookings')
      .select('user_id, tour_id, agency_id, booking_code, active_travelers_count, travelers_count')
      .eq('id', booking_id)
      .single();

    if (!booking) throw new Error('Reserva no encontrada');

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

    const { data: settings } = await supabase
      .from('email_settings')
      .select('contact_email, smtp_api_key, smtp_host')
      .single();

    if (!settings || !settings.smtp_host) throw new Error('SMTP no configurado');

    const { data: platformSettings } = await supabase
      .from('platform_settings')
      .select('agency_commission_percentage')
      .single();

    const commissionRate = platformSettings?.agency_commission_percentage || 15;

    const travelers: any[] = pc.travelers_cancelled || [];
    const categoryLabels: Record<string, string> = {
      adulto: 'Adulto',
      nino: 'Niño',
      infante: 'Infante',
      adulto_mayor: 'Adulto Mayor'
    };

    let policyColor = '#ef4444';
    let policyLabel = 'Sin Reembolso';
    if (pc.cancellation_policy_type === '100_percent') { policyColor = '#10b981'; policyLabel = 'Reembolso 100%'; }
    else if (pc.cancellation_policy_type === '50_percent') { policyColor = '#f59e0b'; policyLabel = 'Reembolso 50%'; }

    const activeCount = booking.active_travelers_count ?? ((booking.travelers_count || 0) - travelers.length);

    const travelersRows = travelers.map((t: any) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #1f2937;">${t.nombre}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280;">${categoryLabels[t.categoria_viajero] || t.categoria_viajero}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #1f2937; text-align: right;">$${Number(t.precio_aplicado).toFixed(2)}</td>
      </tr>
    `).join('');

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cancelación Parcial - Admin</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #1e293b; padding: 25px 30px;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 160px; height: auto; margin-bottom: 10px; display: block;" />
              <h1 style="color: #f1f5f9; margin: 0; font-size: 22px;">Cancelación Parcial de Viajeros</h1>
              <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">Reporte administrativo • ${new Date(pc.cancelled_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">

              <div style="display: flex; gap: 12px; margin-bottom: 25px;">
                <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; flex: 1;">
                  <p style="color: #6b7280; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">Política</p>
                  <p style="color: ${policyColor}; font-size: 16px; font-weight: 700; margin: 0;">${policyLabel}</p>
                </div>
              </div>

              <table width="100%" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin-bottom: 25px;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th colspan="2" style="padding: 12px 16px; text-align: left; font-size: 14px; color: #374151; font-weight: 600; border-bottom: 1px solid #e5e7eb;">Detalles de la Operación</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6; width: 45%;">Tour:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${tour.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Fecha del tour:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; border-bottom: 1px solid #f3f4f6;">${new Date(tour.start_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                  </tr>
                  ${booking.booking_code ? `
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Código reserva:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${booking.booking_code}</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Agencia:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; border-bottom: 1px solid #f3f4f6;">${agency?.name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Viajero titular:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; border-bottom: 1px solid #f3f4f6;">${user?.first_name || ''} ${user?.last_name || ''} (${user?.email || ''})</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Días de anticipación:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${pc.days_before_tour} día(s)</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Viajeros cancelados:</td>
                    <td style="padding: 10px 16px; color: #dc2626; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${travelers.length} persona(s)</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px;">Viajeros activos restantes:</td>
                    <td style="padding: 10px 16px; color: #16a34a; font-size: 13px; font-weight: 600;">${activeCount} persona(s)</td>
                  </tr>
                </tbody>
              </table>

              <h3 style="color: #1f2937; font-size: 15px; margin: 0 0 10px 0;">Viajeros Cancelados</h3>
              <table width="100%" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin-bottom: 25px;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 9px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Nombre</th>
                    <th style="padding: 9px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Categoría</th>
                    <th style="padding: 9px 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">Anticipo</th>
                  </tr>
                </thead>
                <tbody>${travelersRows}</tbody>
                <tfoot>
                  <tr style="background-color: #f9fafb;">
                    <td colspan="2" style="padding: 9px 12px; font-size: 13px; font-weight: 600; color: #374151;">Total:</td>
                    <td style="padding: 9px 12px; font-size: 13px; font-weight: 700; color: #1f2937; text-align: right;">$${Number(pc.original_partial_amount).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              <h3 style="color: #1f2937; font-size: 15px; margin: 0 0 10px 0;">Resumen Financiero</h3>
              <table width="100%" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin-bottom: 25px;">
                <tbody>
                  <tr style="background-color: #fafafa;">
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Anticipo parcial afectado:</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">$${Number(pc.original_partial_amount).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Reembolso al viajero (ToursRed Cash):</td>
                    <td style="padding: 10px 16px; color: ${pc.refund_amount_to_traveler > 0 ? '#10b981' : '#6b7280'}; font-size: 13px; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">$${Number(pc.refund_amount_to_traveler).toFixed(2)}</td>
                  </tr>
                  <tr style="background-color: #fafafa;">
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6;">Monto para agencia (penalización):</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; text-align: right; border-bottom: 1px solid #f3f4f6;">$${Number(pc.amount_to_agency).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 16px; color: #6b7280; font-size: 13px;">Comisión plataforma (${commissionRate}%):</td>
                    <td style="padding: 10px 16px; color: #1f2937; font-size: 13px; font-weight: 600; text-align: right;">$${Number(pc.amount_to_platform).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              ${pc.cancellation_reason ? `
              <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 14px; margin-bottom: 20px; border-radius: 6px;">
                <p style="color: #374151; font-size: 13px; font-weight: 600; margin: 0 0 5px 0;">Motivo:</p>
                <p style="color: #6b7280; font-size: 13px; font-style: italic; margin: 0;">"${pc.cancellation_reason}"</p>
              </div>
              ` : ''}

            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">
                © ${new Date().getFullYear()} ToursRed. Reporte administrativo automático.
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
        to: [settings.contact_email],
        sender: settings.contact_email,
        subject: `[Admin] Cancelación Parcial - ${tour.name} (${travelers.length} viajero(s))`,
        html_body: emailHtml,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorText = await sendEmailResponse.text();
      throw new Error(`Error enviando email: ${errorText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email enviado al admin' }),
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
