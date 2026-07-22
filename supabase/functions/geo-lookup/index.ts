import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GeoResult {
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  is_proxy?: boolean;
  is_hosting?: boolean;
  geo_provider: string;
  ip_masked: string;
  error?: string;
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

// IPinfo Lite API: https://api.ipinfo.io/lite/{ip}
// Authorization: Bearer {token}
// Response fields: ip, country_code, country_name, is_eu, city, postal, latitude, longitude, asn, company, privacy
async function lookupIPInfoLite(ip: string, apiKey: string): Promise<Omit<GeoResult, "ip_masked">> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  if (apiKey && apiKey.length > 0) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const url = `https://api.ipinfo.io/lite/${ip}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(3500),
  });

  if (!res.ok) {
    throw new Error(`IPinfo responded ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  return {
    country: data.country_name ?? data.country ?? undefined,
    country_code: data.country_code ?? data.country ?? undefined,
    city: data.city ?? undefined,
    region: undefined, // not available in Lite tier
    postal_code: data.postal ?? undefined,
    latitude: typeof data.latitude === "number" ? data.latitude : undefined,
    longitude: typeof data.longitude === "number" ? data.longitude : undefined,
    is_proxy: data.privacy?.proxy ?? data.privacy?.vpn ?? false,
    is_hosting: data.privacy?.hosting ?? false,
    geo_provider: "ipinfo_lite",
  };
}

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc/,
  /^fd/,
  /^169\.254\./,
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const respond = (body: GeoResult, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json();
    const ip: string = (body.ip ?? "").trim();

    if (!ip) {
      return respond({ geo_provider: "none", ip_masked: "", error: "ip_required" }, 400);
    }

    if (PRIVATE_RANGES.some((r) => r.test(ip))) {
      return respond({ geo_provider: "none", ip_masked: maskIp(ip), error: "private_ip" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("geo_provider, geo_api_key")
      .limit(1)
      .maybeSingle();

    const provider: string = settings?.geo_provider ?? "ipinfo_lite";
    const apiKey: string = settings?.geo_api_key ?? "";

    let geoResult: Omit<GeoResult, "ip_masked">;

    try {
      if (provider === "ipinfo_lite" || provider === "ipinfo_paid") {
        geoResult = await lookupIPInfoLite(ip, apiKey);
        if (provider === "ipinfo_paid") geoResult.geo_provider = "ipinfo_paid";
      } else {
        geoResult = { geo_provider: provider, error: "unsupported_provider" };
      }
    } catch (lookupErr) {
      geoResult = {
        geo_provider: provider,
        error: lookupErr instanceof Error ? lookupErr.message : "lookup_failed",
      };
    }

    return respond({ ...geoResult, ip_masked: maskIp(ip) });
  } catch {
    return respond({ geo_provider: "none", ip_masked: "", error: "internal_error" });
  }
});
