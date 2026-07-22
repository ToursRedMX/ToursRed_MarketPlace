import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BroadcastRequest {
  subject: string;
  message_body: string;
}

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: adminUser, error: adminCheckError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (adminCheckError || !adminUser || adminUser.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "No tienes permisos de administrador" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { subject, message_body } = await req.json() as BroadcastRequest;

    if (!subject?.trim() || !message_body?.trim()) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos: subject, message_body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch email settings
    const { data: emailSettings, error: esError } = await supabase
      .from("email_settings")
      .select("smtp_api_key")
      .maybeSingle();

    if (esError || !emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ error: "Configuracion de email no disponible" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch platform_url for unsubscribe links
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("platform_url")
      .maybeSingle();
    const platformUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";

    // Fetch all active subscribers
    const { data: subscribers, error: subError } = await supabase
      .from("newsletter_subscriptions")
      .select("id, email, name, unsubscribe_token")
      .eq("active", true)
      .order("email");

    if (subError) {
      return new Response(
        JSON.stringify({ error: "Error al obtener suscriptores" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subscriberList: Subscriber[] = subscribers || [];

    if (subscriberList.length === 0) {
      return new Response(
        JSON.stringify({ error: "No hay suscriptores activos para enviar el comunicado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create broadcast record
    const { data: broadcastRecord, error: broadcastInsertError } = await supabase
      .from("newsletter_broadcasts")
      .insert({
        subject: subject.trim(),
        message_body: message_body.trim(),
        sent_by: user.id,
        recipients_count: subscriberList.length,
        status: "sending",
      })
      .select("id")
      .single();

    if (broadcastInsertError || !broadcastRecord) {
      return new Response(
        JSON.stringify({ error: "Error al registrar el comunicado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const broadcastId = broadcastRecord.id;
    const logoUrl = "https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png";
    const smtp2goApiKey = emailSettings.smtp_api_key;

    let successCount = 0;
    let errorCount = 0;

    const BATCH_SIZE = 50;

    for (let i = 0; i < subscriberList.length; i += BATCH_SIZE) {
      const batch = subscriberList.slice(i, i + BATCH_SIZE);

      const emailPromises = batch.map(async (subscriber) => {
        const displayName = subscriber.name || subscriber.email;
        const unsubscribeLink = `${platformUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background-color: #b8dfe6; padding: 28px 20px; text-align: center; }
    .logo { max-width: 180px; height: auto; margin-bottom: 8px; }
    .content { background-color: #ffffff; padding: 30px 24px; border: 1px solid #e5e7eb; }
    .badge { background-color: #dbeafe; border-radius: 8px; padding: 10px 14px; margin-bottom: 24px; display: inline-block; font-size: 12px; font-weight: 600; color: #1e40af; text-transform: uppercase; letter-spacing: 0.05em; }
    .message-box { background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 18px 20px; margin: 20px 0; font-size: 15px; color: #1f2937; word-break: break-word; }
    .message-box img { max-width: 100% !important; height: auto !important; border-radius: 8px; margin: 10px 0; }
    .message-box a { color: #2563eb; text-decoration: underline; }
    .message-box ul, .message-box ol { margin: 10px 0; padding-left: 24px; }
    .message-box li { margin: 4px 0; }
    .message-box h1 { font-size: 22px; font-weight: bold; margin: 14px 0 8px; }
    .message-box h2 { font-size: 18px; font-weight: bold; margin: 12px 0 6px; }
    .message-box h3 { font-size: 16px; font-weight: bold; margin: 10px 0 4px; }
    .message-box p { margin: 8px 0; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; }
    .unsubscribe-link { color: #6b7280; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="ToursRed" class="logo" />
      <div style="font-size: 20px; font-weight: bold; color: #1e40af; margin-top: 6px;">Boletin ToursRed</div>
    </div>
    <div class="content">
      <p style="margin-top:0;">Hola${subscriber.name ? " <strong>" + subscriber.name + "</strong>" : ""},</p>
      <div class="badge">Comunicado del boletin</div>
      <div style="font-size: 13px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">${subject.trim()}</div>
      <div class="message-box">${message_body}</div>
    </div>
    <div class="footer">
      <p>Recibes este correo porque estas suscrito al boletin de ToursRed.</p>
      <p><a href="${unsubscribeLink}" class="unsubscribe-link">Darse de baja del boletin</a></p>
      <p>(c) ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>`.trim();

        try {
          const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: smtp2goApiKey,
              to: [displayName ? `${displayName} <${subscriber.email}>` : subscriber.email],
              sender: `ToursRed <noreply@toursred.com>`,
              subject: subject.trim(),
              html_body: emailHtml,
            }),
          });
          const result = await emailResponse.json();
          return result?.data?.succeeded === 1;
        } catch {
          return false;
        }
      });

      const results = await Promise.all(emailPromises);
      results.forEach(ok => { ok ? successCount++ : errorCount++; });
    }

    await supabase
      .from("newsletter_broadcasts")
      .update({
        success_count: successCount,
        error_count: errorCount,
        status: errorCount === subscriberList.length ? "failed" : "completed",
      })
      .eq("id", broadcastId);

    return new Response(
      JSON.stringify({
        success: true,
        broadcast_id: broadcastId,
        recipients_count: subscriberList.length,
        success_count: successCount,
        error_count: errorCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-newsletter-broadcast:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
