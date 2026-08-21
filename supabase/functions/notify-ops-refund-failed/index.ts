import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (authHeader !== `Bearer ${serviceKey}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: service role key required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey
    );

    const { payment_refund_id } = await req.json();

    if (!payment_refund_id) {
      return new Response(JSON.stringify({ error: "payment_refund_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: refund } = await supabase
      .from("payment_refunds")
      .select(`
        id, booking_id, payment_processor, requested_amount, status, failure_reason,
        processor_refund_id, processor_original_reference, created_at
      `)
      .eq("id", payment_refund_id)
      .maybeSingle();

    if (!refund) {
      return new Response(JSON.stringify({ error: "Reembolso no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("booking_code, user_id, tours:tour_id(name)")
      .eq("id", refund.booking_id)
      .maybeSingle();

    const { data: user } = booking?.user_id
      ? await supabase.from("users").select("email, first_name").eq("id", booking.user_id).maybeSingle()
      : { data: null };

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email, platform_url")
      .maybeSingle();

    const platformUrl = emailSettings?.platform_url || Deno.env.get("SUPABASE_URL") || "";
    const fromEmail = emailSettings?.contact_email || "no-reply@toursred.com";

    const bookingCode = booking?.booking_code || refund.booking_id;
    const tourName = (booking?.tours as any)?.name || "N/A";
    const travelerEmail = user?.email || "N/A";
    const travelerName = user?.first_name || "N/A";

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">Reembolso Fallido - Requiere Atencion</h2>
        <p>Un reembolso a metodo de pago original ha fallado y requiere revision manual.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Booking Code</td><td style="padding: 8px; border: 1px solid #ddd;">${bookingCode}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Tour</td><td style="padding: 8px; border: 1px solid #ddd;">${tourName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Procesador</td><td style="padding: 8px; border: 1px solid #ddd;">${refund.payment_processor}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Monto Solicitado</td><td style="padding: 8px; border: 1px solid #ddd;">$${refund.requested_amount} MXN</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Referencia Original</td><td style="padding: 8px; border: 1px solid #ddd;">${refund.processor_original_reference || "N/A"}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">ID Reembolso</td><td style="padding: 8px; border: 1px solid #ddd;">${refund.id}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Viajero</td><td style="padding: 8px; border: 1px solid #ddd;">${travelerName} (${travelerEmail})</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #dc2626;">Razon del Fallo</td><td style="padding: 8px; border: 1px solid #ddd; color: #dc2626;">${refund.failure_reason || "N/A"}</td></tr>
        </table>
        <p><a href="${platformUrl}/admin/bookings" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px;">Ir a Reservas</a></p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">Este es un mensaje automatico del sistema de reembolsos de ToursRed.</p>
      </div>
    `;

    const emailPayload = {
      api_key: emailSettings?.smtp_api_key,
      to: ["contacto@toursred.com"],
      sender: fromEmail,
      subject: `[ALERTA] Reembolso Fallido - ${bookingCode} - ${refund.payment_processor}`,
      html_body: emailHtml,
    };

    if (emailSettings?.smtp_api_key) {
      const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!emailResponse.ok) {
        const errText = await emailResponse.text();
        console.error("Failed to send refund-failed email via smtp2go:", errText);
      } else {
        console.log("Refund-failed email sent to ops");
      }
    } else {
      console.warn("SMTP not configured, logging refund failure to console only");
      console.error("REFUND FAILED - Requires manual attention:", JSON.stringify(refund));
    }

    return new Response(
      JSON.stringify({ success: true, message: "Notification processed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in notify-ops-refund-failed:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
