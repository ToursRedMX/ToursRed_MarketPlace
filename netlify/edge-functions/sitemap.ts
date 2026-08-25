import type { Context, Netlify } from "@netlify/edge-functions";

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatLastmod(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

async function fetchSupabase(
  baseUrl: string,
  anonKey: string,
  table: string,
  select: string,
  filters: string,
): Promise<Record<string, unknown>[]> {
  try {
    const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}`;
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (!res.ok) {
      console.error(`sitemap: fetch ${table} → ${res.status} ${res.statusText}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error(`sitemap: fetch ${table} error:`, err);
    return [];
  }
}

function buildStaticUrls(origin: string): SitemapEntry[] {
  const staticPaths = [
    "/",
    "/tours",
    "/tours/international/mega-travel",
    "/tours/international/nefertari-travel",
    "/tours/international/exoticca",
    "/about",
    "/contact",
    "/gift-cards",
    "/soporte",
    "/soporte/general",
    "/aviso-privacidad",
    "/terminos-servicio",
    "/politica-cookies",
  ];
  return staticPaths.map((path) => ({ loc: `${origin}${path}` }));
}

export default async (request: Request, _context: Context): Promise<Response> => {
  const url = new URL(request.url);
  const origin = url.origin;

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseAnonKey = Netlify.env.get("SUPABASE_ANON_KEY");

  const entries: SitemapEntry[] = [];
  const seenUrls = new Set<string>();

  function addEntry(loc: string, lastmod?: string | null) {
    if (seenUrls.has(loc)) return;
    seenUrls.add(loc);
    entries.push({ loc, lastmod: lastmod || undefined });
  }

  for (const entry of buildStaticUrls(origin)) {
    addEntry(entry.loc);
  }

  if (supabaseUrl && supabaseAnonKey) {
    const baseUrl = supabaseUrl.replace(/\/$/, "");

    const [tours, agencies, destinations] = await Promise.all([
      fetchSupabase(baseUrl, supabaseAnonKey, "tours",
        "slug,updated_at", "&is_published=eq.true"),
      fetchSupabase(baseUrl, supabaseAnonKey, "agencies",
        "custom_slug,id,updated_at", "&is_active=eq.true&is_approved=eq.true"),
      fetchSupabase(baseUrl, supabaseAnonKey, "destinations",
        "name,updated_at", "&is_active=eq.true"),
    ]);

    for (const tour of tours) {
      const slug = tour.slug as string | null;
      if (slug) {
        addEntry(
          `${origin}/tours/${encodeURIComponent(slug)}`,
          formatLastmod(tour.updated_at as string),
        );
      }
    }

    for (const agency of agencies) {
      const path = (agency.custom_slug as string) || (agency.id as string);
      if (path) {
        addEntry(
          `${origin}/agencies/${encodeURIComponent(path)}`,
          formatLastmod(agency.updated_at as string),
        );
      }
    }

    for (const dest of destinations) {
      const name = dest.name as string | null;
      if (name) {
        addEntry(
          `${origin}/tours?destination=${encodeURIComponent(name)}`,
          formatLastmod(dest.updated_at as string),
        );
      }
    }
  } else {
    console.error(
      "sitemap: SUPABASE_URL or SUPABASE_ANON_KEY not set in Netlify env (Functions scope)",
    );
  }

  const xmlBody = entries
    .map((entry) => {
      let node = `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>`;
      if (entry.lastmod) {
        node += `\n    <lastmod>${entry.lastmod}</lastmod>`;
      }
      node += `\n  </url>`;
      return node;
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${xmlBody}\n` +
    `</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Edge-Function": "sitemap",
    },
  });
};
