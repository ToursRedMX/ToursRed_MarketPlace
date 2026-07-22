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

    // Verificar JWT del caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Token invalido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { agency_id, invited_email, title, permissions } = await req.json();

    if (!agency_id || !invited_email || !title) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos: agency_id, invited_email, title" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar que el caller sea el propietario de la agencia
    const { data: agency, error: agencyError } = await supabase
      .from("agencies")
      .select("id, name, user_id")
      .eq("id", agency_id)
      .single();

    if (agencyError || !agency) {
      return new Response(
        JSON.stringify({ error: "Agencia no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agency.user_id !== caller.id) {
      return new Response(
        JSON.stringify({ error: "Solo el propietario de la agencia puede enviar invitaciones" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = invited_email.trim().toLowerCase();

    // Verificar si ya existe una invitacion pendiente activa para este email en esta agencia
    const { data: existingInvitation } = await supabase
      .from("agency_staff_invitations")
      .select("id, expires_at")
      .eq("agency_id", agency_id)
      .eq("invited_email", normalizedEmail)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    let invitationId: string;
    let invitationToken: string;

    if (existingInvitation) {
      // Reenviar: obtener el token existente
      const { data: fullInvitation } = await supabase
        .from("agency_staff_invitations")
        .select("id, token")
        .eq("id", existingInvitation.id)
        .single();

      invitationId = fullInvitation!.id;
      invitationToken = fullInvitation!.token;
    } else {
      // Construir objeto de permisos con defaults seguros
      const dbPermissions = {
        can_scan_checkin: permissions?.can_scan_checkin ?? false,
        can_view_bookings: permissions?.can_view_bookings ?? false,
        can_view_tours: permissions?.can_view_tours ?? false,
        can_edit_tours: permissions?.can_edit_tours ?? false,
        can_manage_tours: permissions?.can_manage_tours ?? false,
        can_view_financials: permissions?.can_view_financials ?? false,
        can_view_reports: permissions?.can_view_reports ?? false,
        can_manage_discount_codes: permissions?.can_manage_discount_codes ?? false,
        can_view_messages: permissions?.can_view_messages ?? false,
        can_manage_destinations: permissions?.can_manage_destinations ?? false,
      };

      // Obtener info del invitador
      const { data: inviterUser } = await supabase
        .from("users")
        .select("id")
        .eq("id", caller.id)
        .single();

      const { data: newInvitation, error: insertError } = await supabase
        .from("agency_staff_invitations")
        .insert({
          agency_id,
          invited_by: inviterUser!.id,
          invited_email: normalizedEmail,
          title,
          permissions: dbPermissions,
          status: "pending",
        })
        .select("id, token")
        .single();

      if (insertError || !newInvitation) {
        console.error("Error creando invitacion:", insertError);
        return new Response(
          JSON.stringify({ error: "Error al crear la invitacion" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      invitationId = newInvitation.id;
      invitationToken = newInvitation.token;
    }

    // Obtener API key de email desde email_settings
    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ error: "API key de email no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener URL de la plataforma desde platform_settings
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("platform_url")
      .maybeSingle();

    const platformUrl = platformSettings?.platform_url || "https://toursred.com.mx";
    const registrationLink = `${platformUrl}/signup?invitation_token=${invitationToken}&email=${encodeURIComponent(normalizedEmail)}`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e40af; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .logo { max-width: 160px; height: auto; margin-bottom: 12px; }
    .content { background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    .invite-box { background-color: #dbeafe; padding: 20px; border-left: 4px solid #1e40af; border-radius: 4px; margin: 20px 0; }
    .cta-button { display: inline-block; background-color: #1e40af; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 20px 0; }
    .info-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px; margin: 16px 0; }
    .warning-box { background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 12px; margin: 16px 0; font-size: 13px; color: #92400e; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed" class="logo" />
      <h1 style="margin: 0; font-size: 22px;">Invitacion a unirte como Coordinador</h1>
    </div>
    <div class="content">
      <div class="invite-box">
        <h2 style="margin-top: 0; color: #1e40af;">Hola!</h2>
        <p>La agencia <strong>${agency.name}</strong> te ha invitado a unirte a su equipo en ToursRed como <strong>${title}</strong>.</p>
      </div>

      <p>Para aceptar esta invitacion, solo necesitas crear tu cuenta gratuita en ToursRed. Una vez que completes tu registro, quedaras automaticamente vinculado como coordinador de <strong>${agency.name}</strong>.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${registrationLink}" class="cta-button">Crear mi cuenta y aceptar</a>
      </div>

      <div class="info-box">
        <p style="margin: 0; font-size: 14px;"><strong>Como coordinador podras:</strong></p>
        <ul style="margin: 8px 0 0 0; font-size: 14px;">
          <li>Acceder al panel de la agencia con los permisos asignados</li>
          <li>Gestionar tours, reservas y mas (segun permisos)</li>
          <li>Colaborar con el equipo de ${agency.name}</li>
        </ul>
      </div>

      <div class="warning-box">
        <strong>Esta invitacion expira en 7 dias.</strong> Si no puedes registrarte ahora, guarda este correo para hacerlo despues. Si no solicitaste esta invitacion, puedes ignorar este mensaje.
      </div>

      <p style="font-size: 13px; color: #6b7280;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${registrationLink}" style="color: #1e40af; word-break: break-all;">${registrationLink}</a>
      </p>
    </div>
    <div class="footer">
      <p>Equipo ToursRed &mdash; Este es un correo automatico, por favor no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `Invitacion a unirte como Coordinador en ToursRed

La agencia ${agency.name} te ha invitado a unirte a su equipo como ${title}.

Para aceptar esta invitacion, crea tu cuenta en ToursRed usando el siguiente enlace:
${registrationLink}

Esta invitacion expira en 7 dias.

Si no solicitaste esta invitacion, puedes ignorar este mensaje.

Equipo ToursRed`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [normalizedEmail],
      sender: "no-reply@toursred.com",
      subject: `${agency.name} te invita a ser Coordinador en ToursRed`,
      text_body: textContent,
      html_body: htmlContent,
    };

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok || emailResult.data?.error) {
      console.error("SMTP2GO error:", emailResult);
      return new Response(
        JSON.stringify({ error: "Error al enviar el email de invitacion" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, invitation_id: invitationId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error en send-staff-invitation:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
