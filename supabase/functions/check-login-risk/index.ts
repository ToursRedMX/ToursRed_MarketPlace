import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RiskCheckBody {
  email: string;
  device_fingerprint?: string;
}

function extractClientIp(req: Request): string | null {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for"),
    req.headers.get("true-client-ip"),
    req.headers.get("fastly-client-ip"),
  ];
  for (const candidate of candidates) {
    if (candidate) {
      const ip = candidate.split(",")[0].trim();
      if (ip) return ip;
    }
  }
  return null;
}

interface RiskResult {
  // Dimension 1: per-user
  require_captcha: boolean;
  // Dimension 2: per-IP
  ip_blocked: boolean;
  ip_block_until?: string;
  // Dimension 3: per-user+IP+device progressive delay
  delay_ms: number;
  // Overall
  allow: boolean;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: RiskCheckBody = await req.json();
    const { email, device_fingerprint } = body;
    const ip_address = extractClientIp(req);

    if (!email) {
      return new Response(
        JSON.stringify({ error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load thresholds from platform_settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select(
        "login_max_attempts_user, login_max_attempts_ip, login_block_duration_min, login_delay_base_ms, login_delay_max_ms"
      )
      .limit(1)
      .maybeSingle();

    const maxAttemptsUser: number = settings?.login_max_attempts_user ?? 5;
    const maxAttemptsIp: number = settings?.login_max_attempts_ip ?? 20;
    const blockDurationMin: number = settings?.login_block_duration_min ?? 30;
    const delayBaseMs: number = settings?.login_delay_base_ms ?? 1000;
    const delayMaxMs: number = settings?.login_delay_max_ms ?? 30000;

    const windowStart = new Date(Date.now() - blockDurationMin * 60 * 1000).toISOString();

    const result: RiskResult = {
      require_captcha: false,
      ip_blocked: false,
      delay_ms: 0,
      allow: true,
    };

    // -------------------------------------------------------
    // Dimension 1: per-user (email → user_id) — CAPTCHA gate
    // -------------------------------------------------------
    const { data: userRow } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (userRow?.id) {
      const { count: userFailCount } = await supabase
        .from("failed_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userRow.id)
        .gte("attempted_at", windowStart);

      if ((userFailCount ?? 0) >= maxAttemptsUser) {
        result.require_captcha = true;
      }
    } else {
      // Unknown email: count by email field to avoid user enumeration timing
      const { count: emailFailCount } = await supabase
        .from("failed_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .gte("attempted_at", windowStart);

      if ((emailFailCount ?? 0) >= maxAttemptsUser) {
        result.require_captcha = true;
      }
    }

    // -------------------------------------------------------
    // Dimension 2: per-IP — block
    // -------------------------------------------------------
    if (ip_address) {
      const { count: ipFailCount } = await supabase
        .from("failed_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip_address)
        .gte("attempted_at", windowStart);

      if ((ipFailCount ?? 0) >= maxAttemptsIp) {
        // Find the latest attempt to compute block expiry
        const { data: latestAttempt } = await supabase
          .from("failed_login_attempts")
          .select("attempted_at")
          .eq("ip_address", ip_address)
          .order("attempted_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const blockUntil = new Date(
          new Date(latestAttempt?.attempted_at ?? Date.now()).getTime() +
            blockDurationMin * 60 * 1000
        );

        if (blockUntil > new Date()) {
          result.ip_blocked = true;
          result.ip_block_until = blockUntil.toISOString();
          result.allow = false;
          result.reason = "ip_blocked";

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // -------------------------------------------------------
    // Dimension 3: per-user+IP+device — progressive delay
    // -------------------------------------------------------
    if (ip_address && device_fingerprint && userRow?.id) {
      const { count: tripleFailCount } = await supabase
        .from("failed_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userRow.id)
        .eq("ip_address", ip_address)
        .eq("device_fingerprint", device_fingerprint)
        .gte("attempted_at", windowStart);

      const failCount = tripleFailCount ?? 0;
      if (failCount > 0) {
        // Exponential backoff: base * 2^(failCount-1), capped at max
        const computed = delayBaseMs * Math.pow(2, failCount - 1);
        result.delay_ms = Math.min(computed, delayMaxMs);
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // On any error, allow login (never block because of our own failure)
    const fallback: RiskResult = {
      require_captcha: false,
      ip_blocked: false,
      delay_ms: 0,
      allow: true,
      reason: "risk_check_failed",
    };
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
