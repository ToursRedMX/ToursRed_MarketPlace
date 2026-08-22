import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceStepUp } from "../_shared/stepUpCheck.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { p_booking_id, p_points_to_use, p_cash_to_use, p_idempotency_key } = await req.json();

    if (!p_booking_id) {
      return new Response(JSON.stringify({ error: "p_booking_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership check: esta funcion ahora es la UNICA linea de defensa para esto,
    // ya que confirm_booking_paid_with_wallet solo la puede llamar service_role
    // (su chequeo interno de auth.uid() ya no aplica en ese contexto).
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, status")
      .eq("id", p_booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Solo exigir step-up si de verdad se esta gastando wallet o puntos
    if ((p_points_to_use && p_points_to_use > 0) || (p_cash_to_use && p_cash_to_use > 0)) {
      const stepUpBlock = await enforceStepUp(userClient, supabaseServiceKey, supabaseUrl, user.id);
      if (stepUpBlock) return stepUpBlock;
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "confirm_booking_paid_with_wallet",
      { p_booking_id, p_points_to_use: p_points_to_use || 0, p_cash_to_use: p_cash_to_use || 0, p_idempotency_key }
    );

    if (rpcError) {
      return new Response(JSON.stringify({ success: false, error: rpcError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(rpcResult), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
