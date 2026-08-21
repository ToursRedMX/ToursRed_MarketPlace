import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

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

    const { booking_id, tour_supplement_id, quantity } = await req.json();
    if (!booking_id || !tour_supplement_id || !quantity || quantity < 1) {
      return new Response(JSON.stringify({ error: "booking_id, tour_supplement_id y quantity son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call the atomic RPC function that takes an advisory lock, validates,
    // and inserts the booking_supplement in a single transaction.
    const { data: rpcResult, error: rpcError } = await userClient
      .rpc("request_supplement_with_lock", {
        p_user_id: user.id,
        p_booking_id: booking_id,
        p_tour_supplement_id: tour_supplement_id,
        p_quantity: quantity,
      });

    if (rpcError) {
      if (sentryDsn) {
        Sentry.captureException(rpcError, {
          tags: {
            execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
            region: Deno.env.get("SB_REGION") || "unknown",
          },
        });
        await Sentry.flush(2000);
      }
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rpcResult || rpcResult.success === false) {
      const status = rpcResult?.existing_id ? 409 : 400;
      return new Response(JSON.stringify({
        error: rpcResult?.error || "Error desconocido",
        ...(rpcResult?.existing_id ? { existing_id: rpcResult.existing_id, existing_status: rpcResult.existing_status } : {}),
      }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Notify agency if requires approval
    if (rpcResult.requires_approval) {
      const { data: tourData } = await supabase
        .from("tours")
        .select("agency_id, agencies!inner(user_id)")
        .eq("id", rpcResult.tour_id)
        .maybeSingle();

      const agencyUserId = (tourData?.agencies as any)?.user_id;
      if (agencyUserId) {
        await supabase.from("notifications").insert({
          user_id: agencyUserId,
          type: "supplement_approval_request",
          title: "Nueva solicitud de suplemento",
          message: `Un viajero ha solicitado ${quantity}x "${rpcResult.supplement_name}". Aprueba o rechaza la solicitud.`,
          data: { booking_supplement_id: rpcResult.booking_supplement_id, booking_id, supplement_name: rpcResult.supplement_name },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      booking_supplement_id: rpcResult.booking_supplement_id,
      status: rpcResult.status,
      message: rpcResult.message,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
