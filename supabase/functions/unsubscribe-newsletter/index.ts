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

    // Extract token from query param or JSON body
    let token: string | null = null;

    const url = new URL(req.url);
    token = url.searchParams.get("token");

    if (!token && req.method === "POST") {
      try {
        const body = await req.json();
        token = body?.token ?? null;
      } catch {
        // body not JSON, ignore
      }
    }

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: subscription, error: subError } = await supabase
      .from("newsletter_subscriptions")
      .select("id, email, active")
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (subError || !subscription) {
      return new Response(
        JSON.stringify({ error: "Token invalido o no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subscription.active) {
      return new Response(
        JSON.stringify({ success: true, message: "Ya estabas dado de baja", already_unsubscribed: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabase
      .from("newsletter_subscriptions")
      .update({ active: false, unsubscribed_at: new Date().toISOString() })
      .eq("id", subscription.id);

    if (updateError) {
      console.error("Error unsubscribing:", updateError);
      return new Response(
        JSON.stringify({ error: "Error al procesar la baja" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Te has dado de baja correctamente" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in unsubscribe-newsletter:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
