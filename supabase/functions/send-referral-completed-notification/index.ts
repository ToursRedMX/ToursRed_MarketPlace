import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { referrerEmail, referrerName, referredName, pointsAwarded, bookingCode, isReferredUser } = await req.json();

    const [{ data: emailSettings, error: settingsError }, { data: platformSettingsData }] = await Promise.all([
      supabase.from('email_settings').select('*').maybeSingle(),
      supabase.from('platform_settings').select('platform_url').maybeSingle(),
    ]);

    if (settingsError || !emailSettings?.smtp_api_key) {
      console.log('Email settings not configured, skipping');
      return new Response(
        JSON.stringify({ success: true, message: 'Email skipped - not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const appUrl = platformSettingsData?.platform_url || 'https://toursredmx.netlify.app';
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Referido Completado!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 40px 30px 40px; text-align: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px 8px 0 0;">
              <img src="${logoUrl}" alt="ToursRed" style="max-width: 160px; height: auto; margin-bottom: 16px; background: white; padding: 8px 16px; border-radius: 8px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: bold;">${isReferredUser ? '¡Bono de Bienvenida!' : '¡Referido Completado!'}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; color: #374151; font-size: 16px; line-height: 24px;">
                Hola <strong>${referrerName}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; color: #374151; font-size: 16px; line-height: 24px;">
                ${isReferredUser
                  ? `¡Bienvenido a ToursRed! Has completado tu primera reserva${bookingCode ? ` (${bookingCode})` : ''} y has recibido un bono de puntos por registrarte con un código de referido.`
                  : `¡Excelentes noticias! <strong>${referredName}</strong> ha completado su primera reserva${bookingCode ? ` (${bookingCode})` : ''} en ToursRed gracias a tu recomendación.`
                }
              </p>
              <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 24px; margin: 24px 0; border-radius: 6px; text-align: center;">
                <p style="margin: 0 0 8px 0; color: #065f46; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                  Puntos Ganados
                </p>
                <p style="margin: 0; color: #065f46; font-size: 40px; font-weight: bold; line-height: 1.2;">
                  +${Number(pointsAwarded).toLocaleString('es-MX')}
                </p>
                <p style="margin: 4px 0 0 0; color: #065f46; font-size: 15px; font-weight: 600;">
                  puntos ToursRed
                </p>
              </div>
              <div style="background-color: #eff6ff; padding: 16px; margin: 24px 0; border-radius: 6px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 22px;">
                  <strong>Recuerda:</strong> Los puntos se acumulan siempre, pero solo puedes usarlos si tienes una membresía ToursRed Plus activa.
                </p>
              </div>
              <p style="margin: 24px 0 0 0; color: #374151; font-size: 16px; line-height: 24px;">
                Inicia sesión en tu cuenta para ver tus puntos acumulados y seguir compartiendo tu código con amigos.
              </p>
              <div style="text-align: center; margin: 32px 0 8px 0;">
                <a href="${appUrl}/traveler/points"
                   style="display: inline-block; padding: 14px 36px; background-color: #e11d48; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 16px;">
                  Ver Mis Puntos
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 13px;">
                Gracias por ser parte de ToursRed
              </p>
              <p style="margin: 6px 0 0 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const emailPayload = {
      sender: emailSettings.contact_email,
      to: [referrerEmail],
      subject: isReferredUser
        ? `¡Bono de bienvenida! Has ganado ${Number(pointsAwarded).toLocaleString('es-MX')} puntos ToursRed`
        : `¡Has ganado ${Number(pointsAwarded).toLocaleString('es-MX')} puntos ToursRed por tu referido!`,
      html_body: htmlContent,
    };

    const response = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Smtp2go-Api-Key': emailSettings.smtp_api_key,
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error('smtp2go error:', result);
      throw new Error(`Failed to send email: ${JSON.stringify(result)}`);
    }

    console.log('Referral notification sent to:', referrerEmail);

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-referral-completed-notification:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
