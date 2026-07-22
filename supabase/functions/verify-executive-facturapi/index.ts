import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { executive_id, api_key } = await req.json();
    if (!executive_id || !api_key) {
      return new Response(JSON.stringify({ error: "executive_id and api_key are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: exec } = await supabase
      .from("account_executives")
      .select("id, user_id")
      .eq("id", executive_id)
      .maybeSingle();

    if (!exec) {
      return new Response(JSON.stringify({ error: "Executive not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = userData?.role === "admin";
    const isOwner = exec.user_id === user.id;

    if (!isAdmin && !isOwner) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate the API key by listing invoices — endpoint guaranteed to exist
    const facturapiRes = await fetch("https://www.facturapi.io/v2/invoices?limit=1", {
      headers: { Authorization: `Bearer ${api_key}` },
    });

    if (!facturapiRes.ok) {
      const errText = await facturapiRes.text();
      return new Response(
        JSON.stringify({ error: `FacturAPI rechazó la clave: ${facturapiRes.status}`, detail: errText }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileData = await facturapiRes.json();

    await supabase
      .from("account_executives")
      .update({
        facturapi_api_key_encrypted: api_key,
        facturapi_organization_id: null,
        facturapi_configured_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", executive_id);

    return new Response(
      JSON.stringify({
        success: true,
        livemode: profileData.livemode ?? null,
        message: "FacturAPI configurado correctamente",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
