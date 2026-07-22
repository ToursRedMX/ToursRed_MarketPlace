import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SendGiftCardEmailRequest {
  giftCardId: string;
  sendToRecipient?: boolean;
  sendToPurchaser?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { giftCardId, sendToRecipient = true, sendToPurchaser = true }: SendGiftCardEmailRequest = await req.json();

    if (!giftCardId) {
      return new Response(
        JSON.stringify({ error: "Gift card ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: giftCard, error: giftCardError } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("id", giftCardId)
      .single();

    if (giftCardError || !giftCard) {
      return new Response(
        JSON.stringify({ error: "Gift card not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("smtp_api_key").single(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      throw new Error("Email settings not configured");
    }

    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";
    const redeemUrl = `${appUrl}/gift-card/redeem?code=${giftCard.code}`;

    const results = {
      recipientSent: false,
      purchaserSent: false,
      errors: [] as string[],
    };

    if (sendToRecipient && giftCard.recipient_email) {
      try {
        await sendGiftCardEmail(
          emailSettings.smtp_api_key,
          giftCard,
          giftCard.recipient_email,
          giftCard.recipient_name || "Estimado viajero",
          redeemUrl,
          false,
          appUrl
        );
        results.recipientSent = true;
      } catch (error) {
        results.errors.push(`Failed to send to recipient: ${error.message}`);
      }
    }

    if (sendToPurchaser) {
      try {
        await sendGiftCardEmail(
          emailSettings.smtp_api_key,
          giftCard,
          giftCard.purchaser_email,
          giftCard.purchaser_name,
          redeemUrl,
          true,
          appUrl
        );
        results.purchaserSent = true;
      } catch (error) {
        results.errors.push(`Failed to send to purchaser: ${error.message}`);
      }
    }

    if (results.recipientSent || results.purchaserSent) {
      await supabase
        .from("gift_cards")
        .update({
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", giftCardId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-gift-card-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function sendGiftCardEmail(
  apiKey: string,
  giftCard: any,
  recipientEmail: string,
  recipientName: string,
  redeemUrl: string,
  isPurchaserCopy: boolean,
  appUrl: string
): Promise<void> {
  const formattedAmount = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(giftCard.amount);

  const expiryDate = new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(giftCard.expires_at));

  const subject = isPurchaserCopy
    ? `Confirmación de tu Tarjeta de Regalo ToursRed - ${formattedAmount}`
    : `¡Has recibido una Tarjeta de Regalo ToursRed! ${formattedAmount}`;

  const greeting = isPurchaserCopy
    ? `Hola ${recipientName},`
    : giftCard.recipient_name
    ? `Hola ${giftCard.recipient_name},`
    : "Hola,";

  const introMessage = isPurchaserCopy
    ? `<p>🎁 Gracias por comprar una Tarjeta de Regalo ToursRed de <strong>${formattedAmount}</strong>.</p>`
    : giftCard.personal_message
    ? `<p>🎁 <strong>${giftCard.purchaser_name}</strong> te ha enviado una Tarjeta de Regalo ToursRed de <strong>${formattedAmount}</strong>.</p>
       <div style="background: #EFF6FF; border-left: 4px solid #3B82F6; padding: 16px; margin: 20px 0; border-radius: 4px;">
         <p style="margin: 0; font-style: italic; color: #1E40AF;">"${giftCard.personal_message}"</p>
         <p style="margin: 8px 0 0 0; font-size: 14px; color: #1E40AF;">- ${giftCard.purchaser_name}</p>
       </div>`
    : `<p>🎁 <strong>${giftCard.purchaser_name}</strong> te ha enviado una Tarjeta de Regalo ToursRed de <strong>${formattedAmount}</strong>.</p>`;

  const recipientInfo = isPurchaserCopy && giftCard.recipient_email
    ? `<p style="color: #6B7280; font-size: 14px; margin-top: 20px;">Esta tarjeta de regalo fue enviada a: <strong>${giftCard.recipient_email}</strong></p>`
    : "";

  const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); padding: 40px 30px; text-align: center; }
    .logo { max-width: 180px; height: auto; margin-bottom: 15px; }
    .content { background-color: #ffffff; padding: 40px 30px; }
    .gift-card-box { background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border: 3px solid #F59E0B; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2); }
    .code-display { background: #FFFFFF; border-radius: 8px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: #FFFFFF !important; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 20px 0; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }
    .message-box { background: #FFF8E6; border-left: 4px solid #F59E0B; padding: 20px; margin: 25px 0; border-radius: 4px; }
    .info-box { background: #FEF3C7; border-radius: 8px; padding: 20px; margin-top: 30px; }
    .footer { background-color: #F9FAFB; padding: 30px; text-align: center; border-top: 1px solid #E5E7EB; }
    @media only screen and (max-width: 600px) {
      .content { padding: 25px 15px !important; }
      .code-display p { font-size: 24px !important; }
    }
  </style>
</head>
<body style="background-color: #F3F4F6; margin: 0; padding: 0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F3F4F6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table class="container" width="600" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);">

          <!-- Header con Logo -->
          <tr>
            <td class="header">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
              <h1 style="color: #1F2937; margin: 10px 0 0 0; font-size: 32px; font-weight: bold;">Tarjeta de Regalo</h1>
              <p style="color: #DC2626; margin: 10px 0 0 0; font-size: 18px; font-weight: 600;">🎁 ¡El regalo perfecto para los amantes de viajar!</p>
            </td>
          </tr>

          <!-- Contenido Principal -->
          <tr>
            <td class="content">
              <p style="font-size: 16px; color: #1F2937; margin: 0 0 20px 0;">${greeting}</p>

              ${introMessage}

              <!-- Tarjeta de Regalo Visual -->
              <div class="gift-card-box">
                <div style="margin-bottom: 25px;">
                  <p style="color: #78350F; font-size: 16px; margin: 0 0 15px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">✨ Tu Código de Regalo ✨</p>
                </div>
                <div class="code-display">
                  <p style="color: #1F2937; font-size: 36px; font-weight: bold; margin: 0; letter-spacing: 4px; font-family: 'Courier New', Courier, monospace; line-height: 1.2;">${giftCard.code}</p>
                </div>
                <div style="background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%); padding: 20px; border-radius: 8px;">
                  <p style="color: #78350F; font-size: 14px; margin: 0 0 8px 0; font-weight: 600;">VALOR TOTAL</p>
                  <p style="color: #D97706; font-size: 42px; font-weight: bold; margin: 0; line-height: 1;">${formattedAmount}</p>
                  <p style="color: #92400E; font-size: 14px; margin: 8px 0 0 0;">Válido hasta: ${expiryDate}</p>
                </div>
              </div>

              <!-- Instrucciones -->
              <div style="background: #F0F9FF; border-radius: 8px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #0369A1; margin: 0 0 15px 0; font-size: 18px;">📝 Cómo canjear tu tarjeta:</h3>
                <ol style="color: #0C4A6E; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li><strong>Haz clic</strong> en el botón de abajo o copia tu código único</li>
                  <li><strong>Crea una cuenta</strong> en ToursRed (si aún no tienes una)</li>
                  <li>El monto se <strong>agregará automáticamente</strong> a tu ToursRed Cash</li>
                  <li><strong>Elige tu aventura</strong> y usa tu saldo para pagar tus tours</li>
                </ol>
              </div>

              <!-- Botón CTA -->
              <div style="text-align: center; margin: 35px 0;">
                <a href="${redeemUrl}" class="cta-button" style="display: inline-block; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: #FFFFFF; padding: 18px 50px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;">
                  🎁 Canjear Mi Tarjeta Ahora
                </a>
                <p style="color: #6B7280; font-size: 13px; margin: 15px 0 0 0;">
                  O copia y pega este enlace: <br/>
                  <span style="color: #F59E0B; word-break: break-all; font-size: 12px;">${redeemUrl}</span>
                </p>
              </div>

              ${recipientInfo ? `<div style="background: #E0F2FE; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="color: #0C4A6E; font-size: 14px; margin: 0;">
                  📧 Esta tarjeta de regalo fue enviada a: <strong>${giftCard.recipient_email}</strong>
                </p>
              </div>` : ''}

              <!-- Información Importante -->
              <div class="info-box" style="background: #FEF3C7; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <p style="margin: 0; color: #78350F; font-size: 14px; line-height: 1.8;">
                  <strong style="font-size: 15px;">⚠️ Información Importante:</strong><br/>
                  • Esta tarjeta de regalo es válida hasta el <strong>${expiryDate}</strong><br/>
                  • El código puede usarse <strong>una sola vez</strong><br/>
                  • No puede ser canjeado por dinero en efectivo<br/>
                  • El saldo se agregará a tu ToursRed Cash y puede usarse para cualquier reserva
                </p>
              </div>

              <!-- Llamado a la acción -->
              <div style="background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border-left: 4px solid #10B981; padding: 20px; border-radius: 6px; margin: 25px 0;">
                <p style="margin: 0; color: #065F46; font-size: 15px; line-height: 1.6;">
                  <strong style="font-size: 16px;">🌍 ¡Tu próxima aventura te espera!</strong><br/>
                  Explora cientos de experiencias únicas en México y comienza a planear tu viaje perfecto.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="footer">
              <p style="margin: 0 0 10px 0; color: #6B7280; font-size: 14px;">¿Tienes preguntas o necesitas ayuda?</p>
              <p style="margin: 0 0 20px 0;">
                <a href="mailto:contacto@toursred.com" style="color: #F59E0B; font-size: 16px; font-weight: 600; text-decoration: none;">contacto@toursred.com</a>
              </p>
              <p style="margin: 0; color: #9CA3AF; font-size: 12px;">© 2025 ToursRed. Todos los derechos reservados.</p>
              <p style="margin: 10px 0 0 0; color: #9CA3AF; font-size: 11px;">
                <a href="${appUrl}" style="color: #9CA3AF; text-decoration: none;">${appUrl.replace(/^https?:\/\//, '')}</a>
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

  const textBody = `
${greeting}

${isPurchaserCopy
  ? `Gracias por comprar una Tarjeta de Regalo ToursRed de ${formattedAmount}.`
  : `${giftCard.purchaser_name} te ha enviado una Tarjeta de Regalo ToursRed de ${formattedAmount}.`}

${giftCard.personal_message ? `Mensaje: "${giftCard.personal_message}" - ${giftCard.purchaser_name}` : ""}

CÓDIGO DE LA TARJETA: ${giftCard.code}
Valor: ${formattedAmount}

Para canjear tu tarjeta:
1. Visita: ${redeemUrl}
2. Crea una cuenta en ToursRed (si no tienes una)
3. El monto se agregará a tu ToursRed Cash
4. Úsalo para pagar tus reservas

${recipientInfo ? `Esta tarjeta fue enviada a: ${giftCard.recipient_email}` : ""}

Válida hasta: ${expiryDate}

¿Preguntas? Contáctanos en contacto@toursred.com

© 2025 ToursRed
  `;

  const emailPayload = {
    to: [recipientEmail],
    sender: "ToursRed <noreply@toursred.com>",
    subject: subject,
    html_body: htmlBody,
    text_body: textBody,
  };

  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": apiKey,
    },
    body: JSON.stringify(emailPayload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to send email: ${JSON.stringify(errorData)}`);
  }
}
