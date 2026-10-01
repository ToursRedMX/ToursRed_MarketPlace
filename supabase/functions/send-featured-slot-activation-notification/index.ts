import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { requireServiceRole } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Mismo problema que ya mordio a generate-featured-slot-cfdi: agencies tiene 4
// FKs hacia users (user_id, approved_by, rejected_by, reversal_by), asi que el
// embed agencies(...users(...)) sin desambiguar es ambiguo para PostgREST.
// Se especifica agencies_user_id_fkey a proposito.
type SlotNotificable = {
  id: string;
  status: string;
  starts_at: string;
  expires_at: string;
  tours: { name: string } | null;
  featured_plans: { name: string; duration_days: number } | null;
  agencies: {
    name: string;
    contact_email: string | null;
    users: { email: string } | null;
  } | null;
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Solo la disparan los webhooks de pago (Stripe/Openpay/Conekta/MercadoPago/
  // PayPal) via generate-featured-slot-cfdi, con el service role. Nadie debe
  // poder pedir este correo a demanda desde el navegador.
  const guard = requireServiceRole(req, { recurso: "send-featured-slot-activation-notification", cors: corsHeaders });
  if (!guard.ok) return guard.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { slot_id } = await req.json();
    if (!slot_id) {
      return new Response(
        JSON.stringify({ error: "slot_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: slot, error: slotError } = await supabase
      .from("featured_tour_slots")
      .select(`
        id, status, starts_at, expires_at,
        tours (name),
        featured_plans (name, duration_days),
        agencies!featured_tour_slots_agency_id_fkey (
          name, contact_email,
          users!agencies_user_id_fkey (email)
        )
      `)
      .eq("id", slot_id)
      .eq("status", "active")
      .returns<SlotNotificable[]>()
      .maybeSingle();

    if (slotError || !slot) {
      console.error("send-featured-slot-activation-notification: slot not found or not active", slotError);
      return new Response(
        JSON.stringify({ error: "Slot not found or not active" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agency = slot.agencies;
    const recipientEmail = agency?.contact_email || agency?.users?.email || null;

    if (!recipientEmail) {
      console.error(`send-featured-slot-activation-notification: sin correo de contacto para el slot ${slot_id}`);
      return new Response(
        JSON.stringify({ success: false, message: "La agencia no tiene correo de contacto configurado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [emailSettingsResult, platformSettingsResult] = await Promise.all([
      supabase.from("email_settings").select("*").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (emailSettingsResult.error || !emailSettingsResult.data || !emailSettingsResult.data.smtp_api_key) {
      console.error("Email settings not configured:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({ success: false, message: "Configuración de email no disponible" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailSettings = emailSettingsResult.data;
    const appUrl = platformSettingsResult.data?.platform_url || "https://toursredmx.netlify.app";

    const tourName = slot.tours?.name ?? "tu tour";
    const planName = slot.featured_plans?.name ?? "Plan Destacado";
    const agencyName = agency?.name ?? "tu agencia";

    const formatearFecha = (iso: string) =>
      new Date(iso).toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const startsAt = formatearFecha(slot.starts_at);
    const expiresAt = formatearFecha(slot.expires_at);

    const subject = `¡Tu tour "${tourName}" ya está destacado!`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #d1fae5; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .success-icon { font-size: 48px; text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #10b981;">¡Tour Destacado!</h1>
    </div>
    <div class="content">
      <div class="success-icon">⭐</div>
      <div class="title">¡Tu pago fue confirmado!</div>

      <p>Estimado/a equipo de <strong>${agencyName}</strong>,</p>

      <p>Tu tour <strong>${tourName}</strong> ya aparece en la sección de destacados de ToursRed.</p>

      <div class="section">
        <div class="section-title">📋 Detalles del destacado</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${tourName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Plan:</span>
          <span class="info-value">${planName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Vigente desde:</span>
          <span class="info-value">${startsAt}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Vigente hasta:</span>
          <span class="info-value">${expiresAt}</span>
        </div>
      </div>

      <div class="highlight">
        <strong>⏳ Vigencia</strong><br>
        Tu tour permanecerá destacado hasta el <strong>${expiresAt}</strong>. Después de esa fecha dejará de aparecer en destacados salvo que renueves el plan.
      </div>

      <p style="text-align: center; margin-top: 30px;">
        <a href="${appUrl}/agency/tours" class="button">
          Ver mis tours
        </a>
      </p>

      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
        Si tienes alguna pregunta sobre tu plan destacado, contáctanos.
      </p>
    </div>
    <div class="footer">
      <p>Este es un correo automático de ToursRed. Por favor, no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [recipientEmail],
      sender: emailSettings.contact_email,
      subject,
      html_body: html,
    };

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Error sending featured slot activation email:", errorText);
      throw new Error(`Failed to send featured slot activation email: ${errorText}`);
    }

    console.log(`✅ Email de destacado enviado a ${recipientEmail} para el slot ${slot_id}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in send-featured-slot-activation-notification:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
