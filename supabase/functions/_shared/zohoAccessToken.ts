import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Use the instantiated SDK client type, not ReturnType on a generic factory.
export type ZohoClient = Pick<SupabaseClient, "from">;

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REGIONS = new Set(["com", "eu", "in", "com.au", "jp", "ca", "com.cn", "sa"]);

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function apiOrigin(value: unknown): string {
  if (!nonempty(value)) throw new Error("Zoho API domain is missing or invalid.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    !/^(www\.zohoapis|api\.zoho)\.(com|eu|in|com\.au|jp|ca|com\.cn|sa)$/.test(url.hostname)) {
    throw new Error("Zoho API domain is not supported.");
  }
  return url.origin;
}

/** Shared by CFDI adapters and accounting; never log OAuth responses or secrets. */
export async function getZohoAccessToken(supabase: ZohoClient): Promise<{ token: string; apiDomain: string }> {
  const { data: row, error: tokenError } = await supabase.from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (tokenError) throw new Error("Unable to read Zoho OAuth token.");
  if (!object(row)) throw new Error("Zoho OAuth token not found. Connect Zoho Books in Admin Settings.");
  const apiDomain = apiOrigin(row.api_domain);
  const expiresAt = typeof row.access_token_expires_at === "string" ? Date.parse(row.access_token_expires_at) : NaN;
  if (nonempty(row.access_token) && Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return { token: row.access_token, apiDomain };
  }
  if (!nonempty(row.refresh_token)) throw new Error("Zoho refresh token is missing.");

  const [{ data: settings, error: settingsError }, { data: secrets, error: secretsError }] = await Promise.all([
    supabase.from("platform_settings").select("zoho_client_id, zoho_region").maybeSingle(),
    supabase.from("platform_secrets").select("zoho_client_secret").maybeSingle(),
  ]);
  if (settingsError || secretsError) throw new Error("Unable to read Zoho client credentials.");
  if (!object(settings) || !object(secrets) || !nonempty(settings.zoho_client_id) || !nonempty(secrets.zoho_client_secret)) {
    throw new Error("Zoho client credentials not configured.");
  }
  const region = settings.zoho_region || "com";
  if (typeof region !== "string" || !REGIONS.has(region)) throw new Error("Zoho region is not supported.");
  let response: Response;
  let data: unknown;
  try {
    response = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        refresh_token: row.refresh_token, client_id: settings.zoho_client_id,
        client_secret: secrets.zoho_client_secret, grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error("OAuth HTTP error");
    data = await response.json();
  } catch {
    throw new Error("Zoho token refresh failed.");
  }
  if (!object(data) || data.error || !nonempty(data.access_token)) throw new Error("Zoho token refresh returned an invalid response.");
  const expiresIn = data.expires_in ?? 3600;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Zoho token refresh returned an invalid expiry.");
  }
  const expiry = Date.now() + expiresIn * 1000;
  if (!Number.isFinite(expiry) || !Number.isFinite(new Date(expiry).getTime())) throw new Error("Zoho token expiry is out of range.");
  const newApiDomain = data.api_domain == null ? apiDomain : apiOrigin(data.api_domain);
  const { error: saveError } = await supabase.from("zoho_oauth_tokens").update({
    access_token: data.access_token, access_token_expires_at: new Date(expiry).toISOString(), api_domain: newApiDomain,
  }).eq("refresh_token", row.refresh_token);
  if (saveError) throw new Error("Unable to save refreshed Zoho token.");
  return { token: data.access_token, apiDomain: newApiDomain };
}
