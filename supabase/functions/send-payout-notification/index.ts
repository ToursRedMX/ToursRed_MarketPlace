import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { payout_id, agency_email, agency_name, amount, reference, commission_count } = await req.json();
    if (!payout_id || !agency_email || !agency_name || !amount) {
      throw new Error("Missing required fields");
    }
    const escapeHtml = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeAgencyName = escapeHtml(String(agency_name));
    const safeReference = reference ? escapeHtml(String(reference)) : '';
    const { data: settings } = await supabase.from("email_settings").select("smtp_api_key, contact_email").maybeSingle();
    if (!settings?.smtp_api_key) {
      console.log("SMTP not configured, skipping email notification");
      return new Response(JSON.stringify({
        success: true,
        message: "Email notification skipped - SMTP not configured"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const emailSubject = `Pago Procesado - ToursRed`;
    const emailBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; }
            .amount { font-size: 32px; font-weight: bold; color: #10b981; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
            .detail-label { font-weight: 600; color: #6b7280; }
            .detail-value { color: #1f2937; }
            .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">💰 Pago Procesado</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">ToursRed - Plataforma de Tours</p>
            </div>

            <div class="content">
              <p>Hola <strong>${safeAgencyName}</strong>,</p>

              <p>Te informamos que hemos procesado exitosamente un pago para tu agencia.</p>

              <div style="text-align: center; background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <div style="font-size: 14px; color: #059669; margin-bottom: 8px;">Monto del Pago</div>
                <div class="amount">$${amount.toLocaleString('es-MX', {
      minimumFractionDigits: 2
    })} MXN</div>
              </div>

              <h3 style="color: #1f2937; margin-top: 30px;">Detalles del Pago</h3>

              <div class="detail-row">
                <span class="detail-label">ID de Pago:</span>
                <span class="detail-value">${payout_id}</span>
              </div>

              ${reference ? `
              <div class="detail-row">
                <span class="detail-label">Referencia Bancaria:</span>
                <span class="detail-value" style="font-family: monospace;">${safeReference}</span>
              </div>
              ` : ''}

              <div class="detail-row">
                <span class="detail-label">Tours Incluidos:</span>
                <span class="detail-value">${commission_count} ${commission_count === 1 ? 'tour' : 'tours'}</span>
              </div>

              <div class="detail-row">
                <span class="detail-label">Fecha de Procesamiento:</span>
                <span class="detail-value">${new Date().toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}</span>
              </div>

              <p style="margin-top: 30px;">
                Este pago incluye las comisiones de ${commission_count} ${commission_count === 1 ? 'tour completado' : 'tours completados'}.
                Puedes revisar el detalle completo en tu panel de gestión financiera.
              </p>

              <div style="text-align: center;">
                <a href="${Deno.env.get("SUPABASE_URL")?.replace('/rest/v1', '')}/agency/financials" class="button">
                  Ver Detalles Financieros
                </a>
              </div>

              <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">
                Si tienes alguna pregunta sobre este pago, no dudes en contactarnos.
              </p>
            </div>

            <div class="footer">
              <p><strong>ToursRed</strong> - Plataforma de Gestión de Tours</p>
              <p>Este es un correo automático, por favor no responder directamente.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        api_key: settings.smtp_api_key,
        to: [agency_email],
        sender: settings.contact_email || "notifications@toursred.com",
        subject: emailSubject,
        html_body: emailBody
      })
    });
    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Failed to send email:", errorText);
      throw new Error(`Failed to send email: ${errorText}`);
    }
    const emailResult = await emailResponse.json();
    return new Response(JSON.stringify({
      success: true,
      message: "Payout notification email sent successfully"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error sending payout notification:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Internal server error"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
