import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SessionEventBody {
  event_type: "login" | "logout" | "failed_login";
  user_id?: string;
  email?: string;
  session_id?: string;
  user_agent?: string;
  device_fingerprint?: string;
  login_method?: string;
  failure_reason?: string;
  browser?: string;
  browser_version?: string;
  os?: string;
  os_version?: string;
  device_type?: string;
  device_name?: string;
}

interface ParsedUA {
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  os_version: string | null;
  device_type: "mobile" | "tablet" | "desktop" | null;
}

function parseUserAgent(ua: string | undefined | null): ParsedUA {
  if (!ua) return { browser: null, browser_version: null, os: null, os_version: null, device_type: null };

  const s = ua.toLowerCase();

  // device_type
  let device_type: "mobile" | "tablet" | "desktop" = "desktop";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) device_type = "tablet";
  else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile/i.test(ua)) device_type = "mobile";

  // browser — order matters (Edge/Opera before Chrome, Chrome before Safari)
  let browser: string | null = null;
  let browser_version: string | null = null;

  const browserPatterns: [RegExp, string][] = [
    [/edg(?:e|\/)([\d.]+)/i,      "Edge"],
    [/opr\/([\d.]+)/i,            "Opera"],
    [/opera(?:.*version)?\/([\d.]+)/i, "Opera"],
    [/chrome\/([\d.]+)/i,         "Chrome"],
    [/chromium\/([\d.]+)/i,       "Chromium"],
    [/firefox\/([\d.]+)/i,        "Firefox"],
    [/fxios\/([\d.]+)/i,          "Firefox"],
    [/safari\/([\d.]+)/i,         "Safari"],
    [/msie ([\d.]+)/i,            "IE"],
    [/trident.*rv:([\d.]+)/i,     "IE"],
    [/samsungbrowser\/([\d.]+)/i, "Samsung Browser"],
    [/ucbrowser\/([\d.]+)/i,      "UC Browser"],
  ];

  // Special case: version for Safari uses Version/x.x
  if (/safari/i.test(ua) && !/chrome|chromium|edg|opr/i.test(ua)) {
    browser = "Safari";
    const vm = ua.match(/version\/([\d.]+)/i);
    browser_version = vm ? vm[1] : null;
  } else {
    for (const [pattern, name] of browserPatterns) {
      const m = ua.match(pattern);
      if (m) {
        browser = name;
        browser_version = m[1] ?? null;
        break;
      }
    }
  }

  // os
  let os: string | null = null;
  let os_version: string | null = null;

  if (/windows nt/i.test(ua)) {
    os = "Windows";
    const m = ua.match(/windows nt ([\d.]+)/i);
    const versions: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.2": "XP x64", "5.1": "XP" };
    os_version = m ? (versions[m[1]] ?? m[1]) : null;
  } else if (/iphone os/i.test(ua)) {
    os = "iOS";
    const m = ua.match(/iphone os ([\d_]+)/i);
    os_version = m ? m[1].replace(/_/g, ".") : null;
  } else if (/ipad.*os/i.test(ua)) {
    os = "iPadOS";
    const m = ua.match(/os ([\d_]+)/i);
    os_version = m ? m[1].replace(/_/g, ".") : null;
  } else if (/android/i.test(ua)) {
    os = "Android";
    const m = ua.match(/android ([\d.]+)/i);
    os_version = m ? m[1] : null;
  } else if (/mac os x/i.test(ua)) {
    os = "macOS";
    const m = ua.match(/mac os x ([\d_]+)/i);
    os_version = m ? m[1].replace(/_/g, ".") : null;
  } else if (s.includes("linux")) {
    os = "Linux";
  } else if (s.includes("cros")) {
    os = "ChromeOS";
  }

  return { browser, browser_version, os, os_version, device_type };
}

function maskIp(ip: string): string {
  if (!ip) return "";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    parts[parts.length - 1] = "xxx";
    return parts.join(".");
  }
  const parts = ip.split(":");
  if (parts.length >= 4) {
    parts[parts.length - 1] = "xxx";
    parts[parts.length - 2] = "xxx";
  }
  return parts.join(":");
}

// Extract real client IP from standard headers set by proxies / Supabase edge network
function extractClientIp(req: Request): string | null {
  const candidates = [
    req.headers.get("cf-connecting-ip"),        // Cloudflare
    req.headers.get("x-real-ip"),               // Nginx / generic
    req.headers.get("x-forwarded-for"),         // Standard proxy (may be comma-separated)
    req.headers.get("true-client-ip"),          // Akamai / Cloudflare Enterprise
    req.headers.get("fastly-client-ip"),        // Fastly
  ];

  for (const candidate of candidates) {
    if (candidate) {
      // x-forwarded-for may be "client, proxy1, proxy2" — take first
      const ip = candidate.split(",")[0].trim();
      if (ip) return ip;
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: SessionEventBody = await req.json();
    const {
      event_type,
      user_id,
      email,
      session_id,
      user_agent,
      device_fingerprint,
      login_method = "email_password",
      failure_reason,
      device_name,
    } = body;

    // Parse UA server-side so browser/os/device_type are always populated
    const uaParsed = parseUserAgent(user_agent);
    const browser       = body.browser       ?? uaParsed.browser;
    const browser_version = body.browser_version ?? uaParsed.browser_version;
    const os            = body.os            ?? uaParsed.os;
    const os_version    = body.os_version    ?? uaParsed.os_version;
    const device_type   = body.device_type   ?? uaParsed.device_type;

    if (!event_type) {
      return new Response(
        JSON.stringify({ error: "event_type is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Always extract IP from request headers — client cannot spoof server-side header reads
    const ip_address = extractClientIp(req);
    const ipMasked = ip_address ? maskIp(ip_address) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Async geo lookup — never blocks session recording
    let geoData: Record<string, unknown> = {};
    if (ip_address) {
      try {
        const geoRes = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/geo-lookup`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ ip: ip_address }),
            signal: AbortSignal.timeout(4500),
          }
        );
        if (geoRes.ok) {
          const geo = await geoRes.json();
          geoData = {
            country: geo.country ?? null,
            country_code: geo.country_code ?? null,
            city: geo.city ?? null,
            region: geo.region ?? null,
            postal_code: geo.postal_code ?? null,
            latitude: geo.latitude ?? null,
            longitude: geo.longitude ?? null,
            is_proxy: geo.is_proxy ?? null,
            is_hosting: geo.is_hosting ?? null,
            geo_provider: geo.geo_provider ?? null,
          };
        }
      } catch {
        // geo lookup failed — continue without geo data
      }
    }

    if (event_type === "failed_login") {
      await supabase.from("failed_login_attempts").insert({
        user_id: user_id ?? null,
        email: email ?? null,
        ip_address: ip_address ?? null,
        device_fingerprint: device_fingerprint ?? null,
        failure_reason: failure_reason ?? "unknown",
      });

      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "system",
        p_actor_id: user_id ?? null,
        p_actor_email: email ?? null,
        p_target_table: "auth",
        p_action: "FAILED_LOGIN",
        p_severity: "warning",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? null,
        p_metadata: JSON.stringify({ failure_reason, device_fingerprint }),
        p_country: (geoData.country as string) ?? null,
        p_country_code: (geoData.country_code as string) ?? null,
        p_city: (geoData.city as string) ?? null,
        p_region: (geoData.region as string) ?? null,
      });

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id required for login/logout events" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event_type === "login") {
      await supabase.from("user_sessions").insert({
        user_id,
        session_id: session_id ?? null,
        ip_address: ip_address ?? null,
        ip_masked: ipMasked,
        user_agent: user_agent ?? null,
        device_fingerprint: device_fingerprint ?? null,
        login_method,
        success: true,
        browser: browser ?? null,
        browser_version: browser_version ?? null,
        os: os ?? null,
        os_version: os_version ?? null,
        device_type: device_type ?? null,
        device_name: device_name ?? null,
        ...geoData,
      });

      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "system",
        p_actor_id: user_id,
        p_actor_email: email ?? null,
        p_target_table: "auth",
        p_action: "LOGIN",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? null,
        p_metadata: JSON.stringify({ login_method, device_fingerprint, device_type }),
        p_country: (geoData.country as string) ?? null,
        p_country_code: (geoData.country_code as string) ?? null,
        p_city: (geoData.city as string) ?? null,
        p_region: (geoData.region as string) ?? null,
      });
    } else if (event_type === "logout") {
      const { data: openSession } = await supabase
        .from("user_sessions")
        .select("id")
        .eq("user_id", user_id)
        .is("logout_at", null)
        .order("login_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openSession) {
        await supabase
          .from("user_sessions")
          .update({ logout_at: new Date().toISOString() })
          .eq("id", openSession.id);
      }

      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "system",
        p_actor_id: user_id,
        p_actor_email: email ?? null,
        p_target_table: "auth",
        p_action: "LOGOUT",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? null,
        p_metadata: null,
      });
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
