import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PayoutConfirmationRequest {
  agency_id: string;
  commission_ids: string[];
  total_amount: number;
  payment_method: string;
  payment_notes?: string;
  receipt_url?: string;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Transferencia Bancaria",
  check: "Cheque",
  paypal: "PayPal",
  mercadopago: "Mercado Pago",
  other: "Otro"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("send-payout-confirmation: Funcion iniciada");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      agency_id,
      commission_ids,
      total_amount,
      payment_method,
      payment_notes,
      receipt_url
    }: PayoutConfirmationRequest = await req.json();

    console.log("Agency ID:", agency_id);
    console.log("Commission IDs:", commission_ids);
    console.log("Total Amount:", total_amount);

    const { data: agency, error: agencyError } = await supabase
      .from("agencies")
      .select("*, users!agencies_user_id_fkey(email, first_name, last_name)")
      .eq("id", agency_id)
      .single();

    if (agencyError || !agency) {
      console.error("Error al obtener agencia:", agencyError);
      throw new Error("Agencia no encontrada");
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

    if (settingsError || !emailSettings?.smtp_api_key) {
      console.error("Error configuracion email:", settingsError);
      throw new Error("Configuracion de email no disponible");
    }

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("admin_email, logo_url, platform_url")
      .eq("id", 1)
      .maybeSingle();

    const appUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const logoUrl = platformSettings?.logo_url || "https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png";
    const agencyEmail = agency.users?.email || agency.email;
    const agencyName = agency.name;
    const adminEmail = platformSettings?.admin_email || emailSettings.from_email || "admin@toursred.com";
    const paymentMethodLabel = PAYMENT_METHOD_LABELS[payment_method] || payment_method;

    const formattedAmount = new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(total_amount);

    const currentDate = new Date().toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const receiptSection = receipt_url
      ? `
        <tr>
          <td style="padding: 20px 0 0 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 15px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                  <p style="margin: 0 0 10px 0; color: #0369a1; font-weight: 600; font-size: 14px;">Comprobante de Pago</p>
                  <a href="${receipt_url}"
                     style="display: inline-block; padding: 10px 20px; background-color: #0369a1; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">
                    Descargar Comprobante
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
      : '';

    const notesSection = payment_notes
      ? `
        <tr>
          <td style="padding: 20px 0 0 0;">
            <p style="color: #374151; margin: 0 0 5px 0; font-weight: 600; font-size: 14px;">Notas del pago:</p>
            <p style="color: #6b7280; margin: 0; font-size: 14px; line-height: 1.5;">${payment_notes}</p>
          </td>
        </tr>
      `
      : '';

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmacion de Pago</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 35px 30px; text-align: center;">
              <img src="${logoUrl}" alt="ToursRed" style="max-width: 160px; height: auto; margin-bottom: 18px; display: block; margin-left: auto; margin-right: auto;">
              <h1 style="color: white; margin: 0; font-size: 26px; font-weight: 700;">Pago Procesado</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0 0; font-size: 15px;">Se ha realizado un pago a tu agencia</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 35px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hola <strong>${agencyName}</strong>,
              </p>
              <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 28px 0;">
                Te informamos que se ha procesado un pago correspondiente a las comisiones generadas por tus tours en ToursRed.
              </p>

              <!-- Payment Summary Box -->
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
                <tr>
                  <td style="padding: 24px; background-color: #f0fdf4; border-radius: 10px; border: 1px solid #bbf7d0;">
                    <table style="width: 100%;">
                      <tr>
                        <td style="padding-bottom: 16px; border-bottom: 1px solid #d1fae5;">
                          <p style="color: #166534; margin: 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Monto Total Pagado</p>
                          <p style="color: #15803d; margin: 6px 0 0 0; font-size: 34px; font-weight: 700;">${formattedAmount}</p>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <table style="width: 100%; margin-top: 16px;">
                            <tr>
                              <td style="width: 50%; padding-right: 10px; vertical-align: top;">
                                <p style="color: #4b5563; margin: 0; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Metodo de Pago</p>
                                <p style="color: #1f2937; margin: 4px 0 0 0; font-size: 15px; font-weight: 600;">${paymentMethodLabel}</p>
                              </td>
                              <td style="width: 25%; padding-right: 10px; vertical-align: top;">
                                <p style="color: #4b5563; margin: 0; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Comisiones</p>
                                <p style="color: #1f2937; margin: 4px 0 0 0; font-size: 15px; font-weight: 600;">${commission_ids.length}</p>
                              </td>
                              <td style="width: 25%; vertical-align: top;">
                                <p style="color: #4b5563; margin: 0; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Fecha</p>
                                <p style="color: #1f2937; margin: 4px 0 0 0; font-size: 15px; font-weight: 600;">${currentDate}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Receipt and Notes -->
              <table style="width: 100%; border-collapse: collapse;">
                ${receiptSection}
                ${notesSection}
              </table>

              <!-- CTA Button -->
              <table style="width: 100%; margin: 30px 0 10px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${appUrl}/agency/financials"
                       style="display: inline-block; padding: 14px 32px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
                      Ver Estado Financiero
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <div style="margin-top: 28px; padding: 18px 20px; background-color: #fefce8; border-left: 4px solid #ca8a04; border-radius: 6px;">
                <p style="color: #92400e; margin: 0 0 6px 0; font-weight: 600; font-size: 14px;">Informacion Importante</p>
                <p style="color: #78350f; margin: 0; font-size: 13px; line-height: 1.6;">
                  El pago puede tardar de 1 a 3 dias habiles en reflejarse en tu cuenta, dependiendo del metodo de pago utilizado.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 25px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; margin: 0 0 8px 0; font-size: 13px;">
                Si tienes alguna pregunta, contactanos en
              </p>
              <p style="margin: 0 0 12px 0;">
                <a href="mailto:${adminEmail}" style="color: #dc2626; text-decoration: none; font-weight: 600; font-size: 13px;">${adminEmail}</a>
              </p>
              <p style="color: #9ca3af; margin: 0; font-size: 12px;">
                Este es un correo automatico, por favor no respondas a este mensaje.
              </p>
              <p style="color: #9ca3af; margin: 6px 0 0 0; font-size: 12px;">
                &copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
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
Hola ${agencyName},

Se ha procesado un pago correspondiente a las comisiones de tus tours en ToursRed.

DETALLE DEL PAGO:
- Monto Total: ${formattedAmount}
- Metodo de Pago: ${paymentMethodLabel}
- Comisiones Pagadas: ${commission_ids.length}
- Fecha: ${currentDate}
${payment_notes ? `- Notas: ${payment_notes}` : ''}
${receipt_url ? `- Comprobante: ${receipt_url}` : ''}

Puedes consultar tu estado financiero en: ${appUrl}/agency/financials

El pago puede tardar de 1 a 3 dias habiles en reflejarse en tu cuenta.

Para cualquier duda, contactanos en: ${adminEmail}

Equipo ToursRed
    `;

    console.log("Enviando email a agencia:", agencyEmail);

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [agencyEmail, adminEmail],
      sender: "no-reply@toursred.com",
      subject: `Pago Procesado - ${formattedAmount} | ToursRed`,
      html_body: htmlContent,
      text_body: textBody,
    };

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await emailResponse.json();

    if (!emailResponse.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO API Error: ${emailResponse.status}`);
    }

    console.log("Email enviado exitosamente:", result);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email de confirmacion enviado exitosamente"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("Error en send-payout-confirmation:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Error al enviar confirmacion de pago"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
