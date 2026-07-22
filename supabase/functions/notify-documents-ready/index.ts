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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller identity
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch agency info
    const { data: agency, error: agencyErr } = await adminClient
      .from("agencies")
      .select("id, name, contact_email, contact_phone, persona_type, documents_submitted_at, user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (agencyErr || !agency) {
      return new Response(JSON.stringify({ error: "Agencia no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch contact name from users table
    const { data: userRow } = await adminClient
      .from("users")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();
    const contactName = userRow ? `${userRow.first_name ?? ""} ${userRow.last_name ?? ""}`.trim() : null;

    // Idempotency guard: already submitted
    if (agency.documents_submitted_at) {
      return new Response(
        JSON.stringify({ success: true, already_sent: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch email settings and platform URL
    const [{ data: emailSettings }, { data: platformSettings }] = await Promise.all([
      adminClient.from("email_settings").select("*").maybeSingle(),
      adminClient.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      return new Response(JSON.stringify({ error: "Configuración de email no disponible" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const platformUrl = platformSettings?.platform_url || "https://toursredmx.netlify.app";
    const personaLabel = agency.persona_type === "persona_moral" ? "Persona Moral" : "Persona Física";

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e40af; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .logo { max-width: 180px; height: auto; margin-bottom: 10px; }
    .content { background-color: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
    .alert-box { background-color: #dcfce7; padding: 14px; border-left: 4px solid #16a34a; margin: 0 0 20px 0; border-radius: 0 6px 6px 0; }
    .field { margin-bottom: 12px; }
    .label { font-weight: bold; color: #1e40af; font-size: 13px; }
    .value { color: #374151; margin-top: 2px; }
    .button { display: inline-block; padding: 12px 28px; background-color: #1e40af; color: white !important; text-decoration: none; border-radius: 6px; margin-top: 20px; font-weight: bold; font-size: 14px; }
    .footer { text-align: center; padding: 16px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed" class="logo" />
      <h1 style="margin: 0; font-size: 20px;">Documentos listos para revisión</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <strong>✅ Acción requerida:</strong> Una agencia ha cargado todos sus documentos y solicita revisión.
      </div>

      <h2 style="color: #1e40af; margin-top: 0;">Datos de la agencia</h2>

      <div class="field">
        <div class="label">Nombre de la agencia</div>
        <div class="value">${agency.name}</div>
      </div>
      <div class="field">
        <div class="label">Contacto</div>
        <div class="value">${contactName ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Correo</div>
        <div class="value"><a href="mailto:${agency.contact_email}">${agency.contact_email}</a></div>
      </div>
      ${agency.contact_phone ? `<div class="field"><div class="label">Teléfono</div><div class="value">${agency.contact_phone}</div></div>` : ""}
      <div class="field">
        <div class="label">Tipo de persona</div>
        <div class="value">${personaLabel}</div>
      </div>

      <p style="color: #374151; margin-top: 20px;">
        Ingresa al panel de administración para revisar y aprobar los documentos.
        Una vez que apruebes todos los requeridos, la agencia avanzará automáticamente a la siguiente etapa.
      </p>

      <a href="${platformUrl}/admin/agencias" class="button">Revisar documentos</a>
    </div>
    <div class="footer">
      <p>ToursRed — Sistema de Gestión de Agencias</p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `Documentos listos para revisión\n\nAgencia: ${agency.name}\nContacto: ${contactName ?? "—"}\nEmail: ${agency.contact_email}\n${agency.contact_phone ? `Teléfono: ${agency.contact_phone}\n` : ""}Tipo: ${personaLabel}\n\nRevisa los documentos en: ${platformUrl}/admin/agencias`;

    const emailRes = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:   emailSettings.smtp_api_key,
        to:        ["agencias@toursred.com.mx"],
        sender:    "no-reply@toursred.com",
        subject:   `Documentos listos para revisión: ${agency.name}`,
        text_body: textContent,
        html_body: htmlContent,
      }),
    });

    const emailResult = await emailRes.json();
    if (!emailRes.ok || emailResult.data?.error) {
      console.error("SMTP2GO error:", emailResult);
      throw new Error(emailResult.data?.error || "Error al enviar el correo");
    }

    // Mark agency as submitted
    await adminClient
      .from("agencies")
      .update({ documents_submitted_at: new Date().toISOString() })
      .eq("id", agency.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("notify-documents-ready error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
