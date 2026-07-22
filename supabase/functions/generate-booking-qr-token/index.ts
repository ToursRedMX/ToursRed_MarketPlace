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
    const siteUrl = Deno.env.get("SITE_URL") || "https://toursred.com";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "booking_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existing } = await supabase
      .from("booking_checkin_tokens")
      .select("token")
      .eq("booking_id", booking_id)
      .maybeSingle();

    if (existing) {
      const qrUrl = `${siteUrl}/booking-checkin?token=${existing.token}`;
      return new Response(
        JSON.stringify({ success: true, token: existing.token, qr_url: qrUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, tour:tours(start_date)")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tourStartDate = new Date(booking.tour.start_date);
    const expiresAt = new Date(tourStartDate.getTime() + 24 * 60 * 60 * 1000);

    const { data: tokenRecord, error: insertError } = await supabase
      .from("booking_checkin_tokens")
      .insert({
        booking_id,
        expires_at: expiresAt.toISOString(),
      })
      .select("token")
      .maybeSingle();

    if (insertError || !tokenRecord) {
      console.error("Error creando token:", insertError);
      return new Response(
        JSON.stringify({ error: "Error al generar el token de check-in" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const qrUrl = `${siteUrl}/booking-checkin?token=${tokenRecord.token}`;

    return new Response(
      JSON.stringify({ success: true, token: tokenRecord.token, qr_url: qrUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en generate-booking-qr-token:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
