import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { enmascararIp, extraerIpDelCliente } from "../_shared/contextoAuditoria.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { llamadaInterna } from "../_shared/auth.ts";

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
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

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

/**
 * `session_id` del JWT de GoTrue. Solo se usa DESPUES de que getUser() valido
 * el token, asi que no hace falta verificar la firma aqui: es leer un claim de
 * un token ya aceptado. null si no hay token o no trae el claim.
 */
function sessionIdDelToken(authHeader: string | null): string | null {
  try {
    const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
    const cuerpo = token.split(".")[1];
    if (!cuerpo) return null;
    const json = atob(cuerpo.replace(/-/g, "+").replace(/_/g, "/"));
    const sid = JSON.parse(json)?.session_id;
    return typeof sid === "string" ? sid : null;
  } catch {
    return null;
  }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: SessionEventBody = await req.json();
    const {
      event_type,
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
    const ip_address = extraerIpDelCliente(req);
    const ipMasked = ip_address ? enmascararIp(ip_address) : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, sinUserAgentDeNavegador(opcionesConContexto(req)));

    // Verify caller identity: login/logout require a valid user JWT; the
    // service_role key is also accepted for internal calls.
    //
    // failed_login NO lleva sesion, por definicion: quien lo manda acaba de
    // fallar el login. Hasta el 25-sep-2026 esta funcion exigia Authorization
    // para todo (y ademas estaba en verify_jwt = true), asi que LoginPage, que
    // llama sin sesion, recibia 401 y `failed_login_attempts` no tuvo una fila
    // desde el 16-jul-2026. `check-login-risk` decide la demora por usuario y
    // el bloqueo por IP leyendo esa tabla: la proteccion contra fuerza bruta
    // del login estuvo ciega mas de dos meses.
    const esIntentoFallido = event_type === "failed_login";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader && !esIntentoFallido) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isServiceRole = llamadaInterna(req);

    // Derive verified identity for login/logout events
    let verifiedUserId: string | null = null;
    let verifiedEmail: string | null = null;

    if (!isServiceRole && !esIntentoFallido && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, opcionesConContexto(req, {
        global: { headers: { Authorization: authHeader } },
      }));

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError) {
        return new Response(
          JSON.stringify({ error: "No autorizado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (user) {
        verifiedUserId = user.id;
        verifiedEmail = user.email ?? null;
      }
    }

    // Async geo lookup — never blocks session recording
    let geoData: Record<string, unknown> = {};
    if (ip_address) {
      try {
        const geoRes = await fetch(
          `${supabaseUrl}/functions/v1/geo-lookup`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
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
      // For failed_login, use the email from the body (the email that failed to log in).
      // user_id may or may not be known — keep it from the body if provided.
      //
      // Sin sesion no hay identidad verificada: el user_id del cuerpo lo pone
      // quien quiera, asi que solo se acepta de una llamada interna. El correo
      // se valida para no llenar la tabla de basura; la IP sale de las
      // cabeceras del servidor, no del cuerpo.
      const failedEmail = typeof body.email === "string" && body.email.length <= 254 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
        ? body.email.trim().toLowerCase()
        : null;
      if (!failedEmail) {
        return new Response(
          JSON.stringify({ error: "email invalido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const failedUserId = isServiceRole ? (body.user_id ?? null) : null;

      const { error: failedInsertError } = await supabase.from("failed_login_attempts").insert({
        user_id: failedUserId,
        email: failedEmail,
        ip_address: ip_address ?? null,
        device_fingerprint: device_fingerprint ?? null,
        failure_reason: failure_reason ?? "unknown",
      });
      if (failedInsertError) {
        // Antes no se revisaba: asi se pudo perder esta tabla dos meses sin
        // que nadie lo viera.
        console.error("record-session-event: no se pudo registrar el intento fallido:", failedInsertError);
        return new Response(
          JSON.stringify({ error: "No se pudo registrar el intento" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "system",
        p_actor_id: failedUserId,
        p_actor_email: failedEmail,
        p_target_table: "auth",
        p_action: "FAILED_LOGIN",
        p_severity: "warning",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? sessionIdDelToken(authHeader),
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

    // For login/logout events, derive user_id and email from the verified session token
    // instead of trusting client-supplied values.
    if (!verifiedUserId && !isServiceRole) {
      return new Response(
        JSON.stringify({ error: "No se pudo verificar la identidad del usuario" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If service_role is calling internally, fall back to body values
    const effectiveUserId = verifiedUserId ?? body.user_id;
    const effectiveEmail = verifiedEmail ?? body.email ?? null;

    if (!effectiveUserId) {
      return new Response(
        JSON.stringify({ error: "user_id required for login/logout events" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event_type === "login") {
      // Idempotente por session_id (indice unico, migracion 20260926060000): el
      // 25-sep-2026 un mismo login con Google dejo dos filas a 38 ms una de
      // otra, probablemente dos pestanas recibiendo el mismo SIGNED_IN. La
      // deduplicacion del front no puede ganarle a esa carrera; la base si.
      const sesionId = session_id ?? sessionIdDelToken(authHeader);
      const { data: sesionNueva, error: sessionInsertError } = await supabase.from("user_sessions").upsert({
        user_id: effectiveUserId,
        // El front nunca lo mandaba (`session.access_token ? undefined : undefined`).
        // El token ya paso por getUser(), asi que su claim es confiable.
        session_id: sesionId,
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
      }, { onConflict: "session_id", ignoreDuplicates: true }).select("id");
      if (sessionInsertError) {
        console.error("record-session-event: no se pudo registrar la sesion:", sessionInsertError);
      }
      // Si la sesion ya estaba registrada, el upsert no devuelve fila: no se
      // escribe un segundo LOGIN en la bitacora.
      if (!sessionInsertError && sesionId && (sesionNueva ?? []).length === 0) {
        return new Response(
          JSON.stringify({ ok: true, duplicado: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "system",
        p_actor_id: effectiveUserId,
        p_actor_email: effectiveEmail,
        p_target_table: "auth",
        p_action: "LOGIN",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? sessionIdDelToken(authHeader),
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
        .eq("user_id", effectiveUserId)
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
        p_actor_id: effectiveUserId,
        p_actor_email: effectiveEmail,
        p_target_table: "auth",
        p_action: "LOGOUT",
        p_ip_address: ip_address ?? null,
        p_ip_masked: ipMasked,
        p_user_agent: user_agent ?? null,
        p_session_id: session_id ?? sessionIdDelToken(authHeader),
        p_metadata: null,
      });
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
