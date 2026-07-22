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

    const { action, code, grant_token } = await req.json();

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("zoho_client_id, zoho_client_secret, zoho_org_id, zoho_region")
      .maybeSingle();

    if (!settings?.zoho_client_id || !settings?.zoho_client_secret) {
      return new Response(
        JSON.stringify({ error: "Zoho Client ID and Client Secret must be configured in Admin Settings before connecting." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const region = settings.zoho_region || "com";
    const tokenUrl = `https://accounts.zoho.${region}/oauth/v2/token`;

    if (action === "exchange_code") {
      // Exchange authorization code (from OAuth redirect) for tokens
      if (!code) {
        return new Response(JSON.stringify({ error: "code is required for exchange_code action" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = new URLSearchParams({
        code,
        client_id: settings.zoho_client_id,
        client_secret: settings.zoho_client_secret,
        grant_type: "authorization_code",
      });

      const res = await fetch(tokenUrl, { method: "POST", body });
      const data = await res.json();

      if (!data.access_token || !data.refresh_token) {
        return new Response(
          JSON.stringify({ error: "Token exchange failed", detail: data }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

      await supabase.from("zoho_oauth_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      await supabase.from("zoho_oauth_tokens").insert({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        access_token_expires_at: expiresAt,
        scope: data.scope,
        api_domain: data.api_domain ?? `https://www.zohoapis.${region}`,
      });

      return new Response(
        JSON.stringify({ success: true, expires_at: expiresAt, scope: data.scope }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "exchange_grant_token") {
      // Exchange Self Client grant token (offline_access, no redirect URI needed)
      if (!grant_token) {
        return new Response(JSON.stringify({ error: "grant_token is required for exchange_grant_token action" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = new URLSearchParams({
        code: grant_token,
        client_id: settings.zoho_client_id,
        client_secret: settings.zoho_client_secret,
        grant_type: "authorization_code",
      });

      const res = await fetch(tokenUrl, { method: "POST", body });
      const data = await res.json();

      if (!data.access_token || !data.refresh_token) {
        return new Response(
          JSON.stringify({ error: "Grant token exchange failed", detail: data }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

      await supabase.from("zoho_oauth_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      await supabase.from("zoho_oauth_tokens").insert({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        access_token_expires_at: expiresAt,
        scope: data.scope,
        api_domain: data.api_domain ?? `https://www.zohoapis.${region}`,
      });

      return new Response(
        JSON.stringify({ success: true, expires_at: expiresAt, scope: data.scope }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "check_status") {
      const { data: tokenRow } = await supabase
        .from("zoho_oauth_tokens")
        .select("access_token_expires_at, scope, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tokenRow) {
        return new Response(
          JSON.stringify({ connected: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const expiresAt = new Date(tokenRow.access_token_expires_at).getTime();
      const isExpired = expiresAt < Date.now();

      return new Response(
        JSON.stringify({
          connected: true,
          token_expires_at: tokenRow.access_token_expires_at,
          is_expired: isExpired,
          scope: tokenRow.scope,
          last_updated: tokenRow.updated_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "disconnect") {
      await supabase.from("zoho_oauth_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      return new Response(
        JSON.stringify({ success: true, message: "Zoho connection removed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Supported: exchange_code, exchange_grant_token, check_status, disconnect` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("zoho-oauth-connect error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
