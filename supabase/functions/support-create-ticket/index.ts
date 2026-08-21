import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const contentType = req.headers.get("content-type") ?? "";
    let ticketData: any;
    let files: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const dataStr = formData.get("data");
      if (!dataStr) throw new Error("Falta el campo 'data'");
      ticketData = JSON.parse(dataStr as string);
      files = formData.getAll("files").filter(f => f instanceof File) as File[];
    } else {
      ticketData = await req.json();
    }

    const { tipo, subcategory_id, solicitante_nombre, solicitante_email, descripcion, user_id, extra_data } = ticketData;

    if (!tipo || !subcategory_id || !solicitante_nombre || !solicitante_email || !descripcion) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get subcategory to validate and get category_id + priority
    const { data: subcategory, error: subError } = await supabase
      .from("support_subcategories")
      .select("*, category:support_categories(id)")
      .eq("id", subcategory_id)
      .maybeSingle();

    if (subError || !subcategory) {
      return new Response(
        JSON.stringify({ error: "Subcategoria no encontrada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate folio
    const { data: folioData, error: folioError } = await supabase
      .rpc("generate_ticket_folio", { p_subcategory_id: subcategory_id });

    if (folioError || !folioData) {
      throw new Error(`Error generando folio: ${folioError?.message}`);
    }

    // Insert ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        folio: folioData,
        tipo,
        category_id: subcategory.category.id,
        subcategory_id,
        prioridad: subcategory.prioridad_default,
        status: "sin_atender",
        user_id: user_id ?? null,
        solicitante_nombre,
        solicitante_email,
        descripcion,
        extra_data: extra_data ?? null,
      })
      .select()
      .single();

    if (ticketError || !ticket) {
      throw new Error(`Error creando ticket: ${ticketError?.message}`);
    }

    // Insert creation history event
    await supabase.from("support_ticket_history").insert({
      ticket_id: ticket.id,
      tipo_evento: "creacion",
      descripcion: `Ticket creado por ${solicitante_nombre} (${solicitante_email})`,
      actor_name: solicitante_nombre,
      metadata: { tipo, subcategory_id },
    });

    // Upload attachments
    if (files.length > 0 && subcategory.permite_adjuntos) {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) continue;
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
        if (!allowedTypes.includes(file.type)) continue;

        const ext = file.name.split(".").pop() ?? "bin";
        const path = `tickets/${ticket.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const buffer = await file.arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from("support-attachments")
          .upload(path, buffer, { contentType: file.type });

        if (!uploadError) {
          await supabase.from("support_ticket_attachments").insert({
            ticket_id: ticket.id,
            storage_path: path,
            nombre_archivo: file.name,
            mime_type: file.type,
            tamano_bytes: file.size,
            subido_por_id: user_id ?? null,
          });
        }
      }
    }

    // Create in-app notification for registered users
    if (user_id) {
      await supabase.from("notifications").insert({
        user_id,
        type: "support_ticket_created",
        title: `Ticket creado: ${folioData}`,
        message: `Tu solicitud de soporte fue registrada con el folio ${folioData}`,
        data: { ticket_id: ticket.id, folio: folioData },
      });
    }

    // Send confirmation email to user
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-support-ticket-created`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          folio: folioData,
          solicitante_nombre,
          solicitante_email,
          descripcion,
          categoria: subcategory.nombre,
          sla_horas: subcategory.sla_horas,
        }),
      });
    } catch {
      // Non-fatal
    }

    // Notify support team
    try {
      const { data: emailSettings } = await supabase
        .from("email_settings")
        .select("smtp_api_key")
        .maybeSingle();

      if (emailSettings?.smtp_api_key) {
        const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#1e40af;padding:28px 40px;">
              <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">ToursRed — Nuevo Ticket de Soporte</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <div style="background-color:#eff6ff;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#3b82f6;text-transform:uppercase;">Folio</p>
                <p style="margin:0;font-size:28px;font-weight:800;color:#1e40af;font-family:monospace;">${folioData}</p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <tr><td style="padding:10px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Datos del Solicitante</td></tr>
                <tr><td style="padding:14px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding-bottom:8px;width:35%;">Nombre:</td>
                      <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${solicitante_nombre}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Email:</td>
                      <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${solicitante_email}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Categoria:</td>
                      <td style="font-size:13px;color:#111827;font-weight:500;padding-bottom:8px;">${subcategory.nombre}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;vertical-align:top;">Descripcion:</td>
                      <td style="font-size:13px;color:#374151;">${descripcion}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6b7280;">Accede al panel de administracion para atender este ticket.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:18px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">ToursRed — Panel de Soporte Interno</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        await fetch("https://api.smtp2go.com/v3/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: emailSettings.smtp_api_key,
            to: ["soporte@toursred.com.mx"],
            sender: "soporte@toursred.com.mx",
            subject: `[Nuevo Ticket] ${folioData} — ${solicitante_nombre}`,
            text_body: `Nuevo ticket de soporte\n\nFolio: ${folioData}\nSolicitante: ${solicitante_nombre} (${solicitante_email})\nCategoria: ${subcategory.nombre}\n\nDescripcion:\n${descripcion}`,
            html_body: htmlBody,
          }),
        });
      }
    } catch {
      // Non-fatal
    }

    return new Response(
      JSON.stringify({ success: true, folio: folioData, ticket_id: ticket.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("support-create-ticket error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
