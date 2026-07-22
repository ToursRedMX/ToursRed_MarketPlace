import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SendChannel = "email" | "notification" | "both";

interface MassMessageRequest {
  agency_id: string;
  tour_id: string;
  slot_id?: string | null;
  subject: string;
  message_body: string;
  send_channel?: SendChannel;
}

interface Attendee {
  booking_id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  travelers_count: number;
  selected_date: string | null;
  selected_time: string | null;
  booking_code: string | null;
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

    const body: MassMessageRequest = await req.json();
    const { agency_id, tour_id, slot_id, subject, message_body, send_channel = "both" } = body;

    const needsEmail = send_channel === "email" || send_channel === "both";
    const needsNotification = send_channel === "notification" || send_channel === "both";

    if (!agency_id || !tour_id || !message_body) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (needsEmail && !subject) {
      return new Response(
        JSON.stringify({ error: "El asunto es requerido para envío por email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: agency, error: agencyError } = await supabase
      .from("agencies")
      .select("id, name, contact_email, logo, user_id")
      .eq("id", agency_id)
      .maybeSingle();

    if (agencyError || !agency) {
      return new Response(
        JSON.stringify({ error: "Agencia no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isOwner = agency.user_id === user.id;

    if (!isOwner) {
      const { data: staffRecord } = await supabase
        .from("agency_staff")
        .select("id, agency_staff_permissions(can_manage_tours, can_view_messages)")
        .eq("agency_id", agency_id)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      const perms = staffRecord?.agency_staff_permissions as any;
      const hasPermission = perms?.can_manage_tours || perms?.can_view_messages;

      if (!staffRecord || !hasPermission) {
        return new Response(
          JSON.stringify({ error: "No tienes permiso para enviar mensajes de esta agencia" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("id, name, destination, start_date, end_date, tour_type")
      .eq("id", tour_id)
      .eq("agency_id", agency_id)
      .maybeSingle();

    if (tourError || !tour) {
      return new Response(
        JSON.stringify({ error: "Tour no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let slotInfo: { slot_date: string; departure_time: string } | null = null;
    if (slot_id) {
      const { data: slot } = await supabase
        .from("tour_slots")
        .select("slot_date, departure_time")
        .eq("id", slot_id)
        .maybeSingle();
      slotInfo = slot;
    }

    let emailSettings: { smtp_api_key: string; from_email: string; from_name: string } | null = null;
    if (needsEmail) {
      const { data, error: emailError } = await supabase
        .from("email_settings")
        .select("*")
        .maybeSingle();

      if (emailError || !data?.smtp_api_key) {
        return new Response(
          JSON.stringify({ error: "Configuración de email no disponible" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      emailSettings = data;
    }

    const { data: attendees, error: attendeesError } = await supabase.rpc(
      "get_tour_confirmed_attendees",
      { p_tour_id: tour_id, p_slot_id: slot_id ?? null }
    );

    if (attendeesError) {
      console.error("Error fetching attendees:", attendeesError);
      return new Response(
        JSON.stringify({ error: "Error al obtener los asistentes" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const attendeeList: Attendee[] = attendees || [];

    const { data: messageRecord, error: messageInsertError } = await supabase
      .from("agency_tour_messages")
      .insert({
        agency_id,
        tour_id,
        slot_id: slot_id ?? null,
        subject: subject || "",
        message_body,
        sent_by: user.id,
        recipients_count: attendeeList.length,
        status: "sending",
      })
      .select("id")
      .single();

    if (messageInsertError || !messageRecord) {
      console.error("Error creating message record:", messageInsertError);
      return new Response(
        JSON.stringify({ error: "Error al registrar el mensaje" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messageId = messageRecord.id;

    const formatDate = (dateString: string | null | undefined) => {
      if (!dateString) return null;
      const date = new Date(dateString + "T12:00:00");
      return date.toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    const isReceptivo = !tour.start_date && !tour.end_date;
    const tourDateLine = isReceptivo
      ? slotInfo
        ? `${formatDate(slotInfo.slot_date)}${slotInfo.departure_time ? " · " + slotInfo.departure_time : ""}`
        : null
      : `${formatDate(tour.start_date)}${tour.end_date && tour.end_date !== tour.start_date ? " – " + formatDate(tour.end_date) : ""}`;

    const logoUrl = "https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png";
    const fromEmail = emailSettings?.from_email || "noreply@toursred.com";
    const fromName = emailSettings?.from_name || "ToursRed";
    const smtp2goApiKey = emailSettings?.smtp_api_key || "";

    let successCount = 0;
    let errorCount = 0;
    const recipientRecords: Array<{
      message_id: string;
      user_id: string;
      booking_id: string;
      email: string;
      delivered: boolean;
      delivered_at: string | null;
      error_message: string | null;
    }> = [];

    const notificationInserts: Array<{
      user_id: string;
      type: string;
      title: string;
      message: string;
      data: Record<string, unknown>;
    }> = [];

    for (const attendee of attendeeList) {
      let emailDelivered = true;

      if (needsEmail) {
        const messageBodyFormatted = message_body.replace(/\n/g, "<br>");

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
    .tour-badge { background-color: #dbeafe; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; }
    .tour-name { font-size: 18px; font-weight: bold; color: #1e40af; margin: 0 0 4px 0; }
    .tour-meta { font-size: 13px; color: #4b5563; margin: 0; }
    .message-box { background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 18px 20px; margin: 20px 0; white-space: pre-wrap; word-break: break-word; font-size: 15px; color: #1f2937; }
    .agency-footer { background-color: #f3f4f6; border-radius: 8px; padding: 14px 16px; margin-top: 24px; font-size: 13px; color: #6b7280; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="ToursRed" class="logo" />
      <div style="font-size: 20px; font-weight: bold; color: #1e40af; margin-top: 6px;">Mensaje de tu Agencia</div>
    </div>
    <div class="content">
      <p style="margin-top:0;">Hola <strong>${attendee.first_name} ${attendee.last_name}</strong>,</p>
      <p style="color:#4b5563; margin-bottom: 20px;">La agencia que organiza tu tour te ha enviado el siguiente mensaje:</p>

      <div class="tour-badge">
        <p class="tour-name">${tour.name}</p>
        ${attendee.booking_code ? `<p class="tour-meta" style="font-size:12px; color:#6b7280; margin-top:2px;">Reserva #${attendee.booking_code}</p>` : ""}
        ${tourDateLine ? `<p class="tour-meta">${tourDateLine}</p>` : ""}
        <p class="tour-meta">${tour.destination}</p>
      </div>

      <div style="font-size: 13px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Mensaje de ${agency.name}</div>
      <div class="message-box">${messageBodyFormatted}</div>

      <div class="agency-footer">
        <strong>${agency.name}</strong>
        ${agency.contact_email ? `<br>Contacto: <a href="mailto:${agency.contact_email}" style="color: #3b82f6;">${agency.contact_email}</a>` : ""}
      </div>
    </div>
    <div class="footer">
      Este mensaje fue enviado a través de ToursRed.<br>
      © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
    </div>
  </div>
</body>
</html>
        `.trim();

        try {
          const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: smtp2goApiKey,
              to: [`${attendee.first_name} ${attendee.last_name} <${attendee.email}>`],
              sender: `${fromName} <${fromEmail}>`,
              subject,
              html_body: emailHtml,
            }),
          });

          const emailResult = await emailResponse.json();
          emailDelivered = emailResult?.data?.succeeded === 1;

          recipientRecords.push({
            message_id: messageId,
            user_id: attendee.user_id,
            booking_id: attendee.booking_id,
            email: attendee.email,
            delivered: emailDelivered,
            delivered_at: emailDelivered ? new Date().toISOString() : null,
            error_message: !emailDelivered ? JSON.stringify(emailResult?.data?.failures || "Send failed") : null,
          });
        } catch (sendErr) {
          console.error(`Error sending email to ${attendee.email}:`, sendErr);
          emailDelivered = false;
          recipientRecords.push({
            message_id: messageId,
            user_id: attendee.user_id,
            booking_id: attendee.booking_id,
            email: attendee.email,
            delivered: false,
            delivered_at: null,
            error_message: String(sendErr),
          });
        }
      } else {
        recipientRecords.push({
          message_id: messageId,
          user_id: attendee.user_id,
          booking_id: attendee.booking_id,
          email: attendee.email,
          delivered: true,
          delivered_at: new Date().toISOString(),
          error_message: null,
        });
      }

      if (needsNotification) {
        const notifTitle = subject || `Mensaje de ${agency.name}`;
        const truncatedMsg = message_body.length > 200 ? message_body.slice(0, 197) + "..." : message_body;
        notificationInserts.push({
          user_id: attendee.user_id,
          type: "tour_announcement",
          title: notifTitle,
          message: truncatedMsg,
          data: {
            tour_id,
            tour_name: tour.name,
            agency_name: agency.name,
            booking_id: attendee.booking_id,
            booking_code: attendee.booking_code,
            message_id: messageId,
          },
        });
      }

      const counted = needsEmail ? emailDelivered : true;
      if (counted) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    if (recipientRecords.length > 0) {
      await supabase.from("agency_tour_message_recipients").insert(recipientRecords);
    }

    if (notificationInserts.length > 0) {
      const { error: notifError } = await supabase.from("notifications").insert(notificationInserts);
      if (notifError) {
        console.error("Error inserting notifications:", notifError);
      }
    }

    await supabase
      .from("agency_tour_messages")
      .update({
        success_count: successCount,
        error_count: errorCount,
        recipients_count: attendeeList.length,
        status: errorCount === attendeeList.length && attendeeList.length > 0 ? "failed" : "completed",
      })
      .eq("id", messageId);

    return new Response(
      JSON.stringify({
        success: true,
        message_id: messageId,
        recipients_count: attendeeList.length,
        success_count: successCount,
        error_count: errorCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in send-tour-mass-message:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
