import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SendChannel = "email" | "notification" | "both";
type Audience = "travelers" | "agencies" | "all";

interface BroadcastRequest {
  subject: string;
  message_body: string;
  audience: Audience;
  send_channel: SendChannel;
}

interface Recipient {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
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

    const body: BroadcastRequest = await req.json();
    const { subject, message_body, audience, send_channel = "both" } = body;

    if (!subject || !message_body || !audience) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos: subject, message_body, audience" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const needsEmail = send_channel === "email" || send_channel === "both";
    const needsNotification = send_channel === "notification" || send_channel === "both";

    let roleFilter: string[] = [];
    if (audience === "travelers") roleFilter = ["traveler"];
    else if (audience === "agencies") roleFilter = ["agency"];
    else roleFilter = ["traveler", "agency"];

    const { data: recipients, error: recipientsError } = await supabase
      .from("users")
      .select("id, email, first_name, last_name, role")
      .in("role", roleFilter)
      .eq("is_active", true);

    if (recipientsError) {
      return new Response(
        JSON.stringify({ error: "Error al obtener destinatarios" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipientList: Recipient[] = recipients || [];

    let emailSettings: { smtp_api_key: string; from_email: string; from_name: string } | null = null;
    if (needsEmail) {
      const { data: esData, error: esError } = await supabase
        .from("email_settings")
        .select("*")
        .maybeSingle();

      if (esError || !esData?.smtp_api_key) {
        return new Response(
          JSON.stringify({ error: "Configuración de email no disponible" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      emailSettings = esData;
    }

    const { data: broadcastRecord, error: broadcastInsertError } = await supabase
      .from("admin_broadcast_messages")
      .insert({
        subject,
        message_body,
        audience,
        send_channel,
        sent_by: user.id,
        recipients_count: recipientList.length,
        status: "sending",
      })
      .select("id")
      .single();

    if (broadcastInsertError || !broadcastRecord) {
      return new Response(
        JSON.stringify({ error: "Error al registrar el mensaje" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const broadcastId = broadcastRecord.id;

    const logoUrl = "https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png";
    const fromEmail = emailSettings?.from_email || "noreply@toursred.com";
    const fromName = emailSettings?.from_name || "ToursRed";
    const smtp2goApiKey = emailSettings?.smtp_api_key || "";

    let successCount = 0;
    let errorCount = 0;

    const notificationInserts: Array<{
      user_id: string;
      type: string;
      title: string;
      message: string;
      data: Record<string, unknown>;
    }> = [];

    const BATCH_SIZE = 50;

    for (let i = 0; i < recipientList.length; i += BATCH_SIZE) {
      const batch = recipientList.slice(i, i + BATCH_SIZE);

      const emailPromises = needsEmail
        ? batch.map(async (recipient) => {
            const firstName = recipient.first_name || "";
            const lastName = recipient.last_name || "";
            const displayName = (firstName + " " + lastName).trim() || recipient.email;

            const audienceLabel =
              audience === "travelers"
                ? "viajeros de ToursRed"
                : audience === "agencies"
                ? "agencias de ToursRed"
                : "usuarios de ToursRed";

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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="ToursRed" class="logo" />
      <div style="font-size: 20px; font-weight: bold; color: #1e40af; margin-top: 6px;">Comunicado Oficial</div>
    </div>
    <div class="content">
      <p style="margin-top:0;">Hola${displayName ? " <strong>" + displayName + "</strong>" : ""},</p>
      <div class="badge">Mensaje para todos los ${audienceLabel}</div>
      <div style="font-size: 13px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Mensaje del equipo ToursRed</div>
      <div class="message-box">${message_body}</div>
    </div>
    <div class="footer">
      Este mensaje fue enviado a todos los ${audienceLabel} de ToursRed.<br>
      © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
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
                  to: [displayName ? `${displayName} <${recipient.email}>` : recipient.email],
                  sender: `${fromName} <${fromEmail}>`,
                  subject,
                  html_body: emailHtml,
                }),
              });
              const result = await emailResponse.json();
              return result?.data?.succeeded === 1;
            } catch {
              return false;
            }
          })
        : batch.map(() => Promise.resolve(true));

      const results = await Promise.all(emailPromises);

      results.forEach((ok, idx) => {
        if (ok) successCount++;
        else errorCount++;

        if (needsNotification) {
          const recipient = batch[idx];
          const truncated = message_body.length > 300 ? message_body.slice(0, 297) + "..." : message_body;
          notificationInserts.push({
            user_id: recipient.id,
            type: "system_announcement",
            title: subject,
            message: truncated,
            data: {
              broadcast_id: broadcastId,
              audience,
              sent_by_admin: true,
            },
          });
        }
      });
    }

    if (notificationInserts.length > 0) {
      const NOTIF_BATCH = 100;
      for (let i = 0; i < notificationInserts.length; i += NOTIF_BATCH) {
        await supabase.from("notifications").insert(notificationInserts.slice(i, i + NOTIF_BATCH));
      }
    }

    await supabase
      .from("admin_broadcast_messages")
      .update({
        success_count: successCount,
        error_count: errorCount,
        status: errorCount === recipientList.length && recipientList.length > 0 ? "failed" : "completed",
      })
      .eq("id", broadcastId);

    return new Response(
      JSON.stringify({
        success: true,
        broadcast_id: broadcastId,
        recipients_count: recipientList.length,
        success_count: successCount,
        error_count: errorCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in admin-send-broadcast-message:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
