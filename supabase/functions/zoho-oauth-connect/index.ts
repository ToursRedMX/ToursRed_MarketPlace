import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Zoho was retired. Keep the route to return an explicit, non-mutating
// response for stale clients instead of exchanging or storing credentials.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  return new Response(JSON.stringify({
    error: "Zoho está deprecado; use el ERP interno y Facturapi.",
  }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
