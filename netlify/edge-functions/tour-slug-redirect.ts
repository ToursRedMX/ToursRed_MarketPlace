import type { Context, Netlify } from "@netlify/edge-functions";

const EDGE_FUNCTION_HEADER = { "X-Edge-Function": "tour-slug-redirect" };

async function nextWithHeader(context: Context): Promise<Response> {
  const response = await context.next();
  response.headers.set("X-Edge-Function", "tour-slug-redirect");
  return response;
}

export default async (request: Request, context: Context): Promise<Response | void> => {
  const url = new URL(request.url);

  // Only handle /tours/{slug} paths
  const match = url.pathname.match(/^\/tours\/([^/]+)$/);
  if (!match) {
    return nextWithHeader(context);
  }

  const slug = decodeURIComponent(match[1]);

  // Skip UUIDs — handled by _redirects
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  if (isUuid) {
    return nextWithHeader(context);
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseAnonKey = Netlify.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("tour-slug-redirect: SUPABASE_URL or SUPABASE_ANON_KEY not set in Netlify env (Functions scope)");
    return nextWithHeader(context);
  }

  try {
    const apiUrl = `${supabaseUrl}/rest/v1/rpc/resolve_tour_slug?p_old_slug=${encodeURIComponent(slug)}`;
    const response = await fetch(apiUrl, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return nextWithHeader(context);
    }

    const data = await response.json();

    if (data && data.length > 0 && data[0].current_slug) {
      const newSlug = data[0].current_slug;
      if (newSlug !== slug) {
        const redirectUrl = `${url.origin}/tours/${newSlug}`;
        return new Response(null, {
          status: 301,
          headers: {
            "Location": redirectUrl,
            "Cache-Control": "public, max-age=86400",
            ...EDGE_FUNCTION_HEADER,
          },
        });
      }
    }
  } catch (err) {
    console.error("tour-slug-redirect error:", err);
  }

  return nextWithHeader(context);
};
