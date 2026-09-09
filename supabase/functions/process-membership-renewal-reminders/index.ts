import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { reportEdgeError } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "This Edge Function is deprecated. The cron job now calls the SQL function process_membership_renewal_reminders() directly, which reads live prices from platform_settings.",
        deprecated: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    await reportEdgeError(error, "deprecated-handler");
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
