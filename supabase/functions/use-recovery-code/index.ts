import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

async function hashCode(code: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(pepper + code);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { code } = body as { code?: string };
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "El codigo de recuperacion no es valido o ya fue utilizado." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Rate limiting: max 5 failed attempts in 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: failedCount } = await adminClient
      .from("auth_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("attempt_type", "recovery_code")
      .eq("success", false)
      .gte("attempted_at", tenMinAgo);

    if ((failedCount ?? 0) >= 5) {
      return new Response(JSON.stringify({ error: "Demasiados intentos fallidos. Intenta de nuevo en 10 minutos." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pepper = Deno.env.get("MFA_RECOVERY_PEPPER") || "toursred-default-pepper-change-me";
    const hash = await hashCode(code.trim().toUpperCase(), pepper);

    // Atomic: update only if unused and matches hash
    const { data: matched, error: matchError } = await adminClient
      .from("mfa_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("code_hash", hash)
      .is("used_at", null)
      .select("id")
      .limit(1);

    if (matchError || !matched || matched.length === 0) {
      // Record failed attempt
      await adminClient.from("auth_attempts").insert({
        user_id: user.id,
        attempt_type: "recovery_code",
        success: false,
      });

      return new Response(JSON.stringify({ error: "El codigo de recuperacion no es valido o ya fue utilizado." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record successful attempt
    await adminClient.from("auth_attempts").insert({
      user_id: user.id,
      attempt_type: "recovery_code",
      success: true,
    });

    // Audit log (correct insert_audit_log signature: p_tenant_type is required)
    try {
      const { data: actorProfile } = await adminClient
        .from("users")
        .select("role, email")
        .eq("id", user.id)
        .maybeSingle();
      await adminClient.rpc("insert_audit_log", {
        p_tenant_type: actorProfile?.role || "system",
        p_actor_id: user.id,
        p_actor_email: actorProfile?.email || user.email || null,
        p_action: "RECOVERY_CODE_USED",
        p_target_id: user.id,
        p_target_table: "mfa_recovery_codes",
        p_severity: "warning",
      });
    } catch { /* audit is best-effort */ }

    return new Response(JSON.stringify({
      success: true,
      message: "Codigo validado. Te recomendamos reconfigurar tu Authenticator lo antes posible desde Seguridad.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: "Error interno del servidor." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
