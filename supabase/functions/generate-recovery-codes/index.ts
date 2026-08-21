import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

function generateCode(): string {
  const segments: string[] = [];
  for (let s = 0; s < 3; s++) {
    let seg = "";
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 4; i++) {
      seg += CHARSET[buf[i] % CHARSET.length];
    }
    segments.push(seg);
  }
  return `TR-${segments.join("-")}`;
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

    // Verify user has at least one verified TOTP factor
    const { data: factorsData } = await userClient.auth.mfa.listFactors();
    const verifiedTotp = (factorsData?.totp ?? []).filter(f => f.status === "verified");
    if (verifiedTotp.length === 0) {
      return new Response(JSON.stringify({ error: "Debes tener MFA configurado antes de generar codigos de recuperacion." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pepper = Deno.env.get("MFA_RECOVERY_PEPPER") || "toursred-default-pepper-change-me";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Delete existing unused codes for this user (regeneration invalidates old ones)
    await adminClient
      .from("mfa_recovery_codes")
      .delete()
      .eq("user_id", user.id)
      .is("used_at", null);

    // Generate 10 new codes
    const codes: string[] = [];
    const hashes: { user_id: string; code_hash: string }[] = [];

    for (let i = 0; i < 10; i++) {
      const code = generateCode();
      const hash = await hashCode(code, pepper);
      codes.push(code);
      hashes.push({ user_id: user.id, code_hash: hash });
    }

    const { error: insertError } = await adminClient
      .from("mfa_recovery_codes")
      .insert(hashes);

    if (insertError) {
      return new Response(JSON.stringify({ error: "No se pudieron generar los codigos." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        p_action: "MFA_RECOVERY_CODES_GENERATED",
        p_target_id: user.id,
        p_target_table: "mfa_recovery_codes",
        p_severity: "info",
      });
    } catch { /* audit is best-effort */ }

    return new Response(JSON.stringify({ codes }), {
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
