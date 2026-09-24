import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { opcionesConContexto } from "../_shared/contextoAuditoria.ts";

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
      return new Response(JSON.stringify({ error: "Codigo requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, opcionesConContexto(req, {
      global: { headers: { Authorization: authHeader } },
    }));

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // opcionesConContexto reenvia el user-agent REAL del navegador del
    // viajero (para que insert_audit_log/los triggers de auditoria le
    // acierten el origen). Con la service_role key eso se vuelve el problema:
    // el gateway de Supabase decide "esta llave secreta viene de un
    // navegador" con ese mismo header y la rechaza con "Forbidden use of
    // secret API key in browser" — 200 desde este archivo (auth.mfa.verify ya
    // paso), pero los dos INSERT de mas abajo nunca se guardaban.
    //
    // Confirmado el 24-sep-2026 leyendo function_logs, no adivinado: el
    // mensaje exacto salio ahi. sensitive_verifications se quedaba vacio de
    // hoy pese a que verify-sensitive-action respondia verified:true, y el
    // reintento de confirm-booking-wallet-payment volvia a chocar con 403
    // STEP_UP_REQUIRED un instante despues. Bloqueaba TODO pago 100%
    // wallet/puntos con MFA activo.
    //
    // Se quita el user-agent SOLO de este cliente admin — el userClient de
    // arriba lo conserva, porque ahi la llave es anon y el gateway no la
    // trata como secreta. El resto del contexto (IP, correlacion) se
    // mantiene: no hacia falta perderlo para arreglar esto.
    //
    // OJO: opcionesConContexto es el patron recomendado en 49 funciones para
    // el Req. 10.2 de PCI DSS. Cualquier otra que arme un cliente de
    // service_role asi puede tener el mismo problema en silencio — no se
    // audito aqui por tiempo, queda pendiente revisar las demas.
    const adminOptions = opcionesConContexto(req);
    if (adminOptions.global?.headers) {
      delete (adminOptions.global.headers as Record<string, string>)["user-agent"];
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey, adminOptions);

    // Rate limiting: max 5 failed TOTP attempts in 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: failedCount } = await adminClient
      .from("auth_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("attempt_type", "totp_verify")
      .eq("success", false)
      .gte("attempted_at", tenMinAgo);

    if ((failedCount ?? 0) >= 5) {
      return new Response(JSON.stringify({ error: "Demasiados intentos fallidos. Intenta de nuevo en 10 minutos." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find verified TOTP factor
    const { data: factorsData } = await userClient.auth.mfa.listFactors();
    const verifiedFactor = (factorsData?.totp ?? []).find(f => f.status === "verified");
    if (!verifiedFactor) {
      return new Response(JSON.stringify({
        error: "No tienes MFA configurado. Activa la autenticacion en dos pasos desde Seguridad para continuar.",
        code: "MFA_NOT_CONFIGURED",
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Challenge + verify
    const { data: challengeData, error: challengeError } = await userClient.auth.mfa.challenge({
      factorId: verifiedFactor.id,
    });
    if (challengeError) {
      await adminClient.from("auth_attempts").insert({
        user_id: user.id, attempt_type: "totp_verify", success: false,
      });
      return new Response(JSON.stringify({ error: "No se pudo iniciar la verificacion. Intenta de nuevo." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: verifyError } = await userClient.auth.mfa.verify({
      factorId: verifiedFactor.id,
      challengeId: challengeData.id,
      code,
    });
    if (verifyError) {
      await adminClient.from("auth_attempts").insert({
        user_id: user.id, attempt_type: "totp_verify", success: false,
      });
      return new Response(JSON.stringify({ error: "El codigo ingresado no es valido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record successful attempt. Best-effort a proposito: solo alimenta el
    // rate-limit de arriba, un fallo aqui no debe tumbar una verificacion que
    // por lo demas fue correcta.
    const { error: attemptError } = await adminClient.from("auth_attempts").insert({
      user_id: user.id, attempt_type: "totp_verify", success: true,
    });
    if (attemptError) {
      console.error("verify-sensitive-action: no se pudo registrar el intento exitoso:", attemptError);
    }

    // Insert sensitive verification with 15-minute window. Esta fila es la
    // UNICA que checkStepUp() (stepUpCheck.ts) va a buscar en el reintento
    // inmediato que hace el cliente. Antes este insert no revisaba `error`:
    // si fallaba, la funcion igual respondia `verified: true`, el modal se
    // cerraba como si nada, y el reintento volvia a chocar con 403
    // STEP_UP_REQUIRED un instante despues porque la fila nunca existio —
    // sin que el codigo enterado ni siquiera se reportado en ningun lado.
    // Confirmado el 24-sep-2026 cruzando los logs de Edge Functions (dos
    // verify-sensitive-action en 200, cero filas nuevas en
    // sensitive_verifications) contra el confirm-booking-wallet-payment que
    // le seguia, tambien en 403. Aqui SI se revisa: si no queda guardada, no
    // se le dice al cliente que quedo verificado.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const { error: verificationError } = await adminClient.from("sensitive_verifications").insert({
      user_id: user.id,
      method: "totp",
      verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    if (verificationError) {
      console.error("verify-sensitive-action: no se pudo guardar la verificacion:", verificationError);
      if (sentryDsn) {
        Sentry.captureException(verificationError, {
          tags: {
            execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
            region: Deno.env.get("SB_REGION") || "unknown",
          },
          extra: { context: "insert-sensitive-verifications", user_id: user.id },
        });
        await Sentry.flush(2000);
      }
      return new Response(JSON.stringify({
        error: "Tu codigo era correcto, pero no pudimos guardar la verificacion. Intenta de nuevo.",
      }), {
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
        p_action: "STEP_UP_VERIFIED",
        p_target_id: user.id,
        p_target_table: "sensitive_verifications",
        p_severity: "info",
      });
    } catch { /* audit is best-effort */ }

    return new Response(JSON.stringify({
      verified: true,
      expires_at: expiresAt.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    return new Response(JSON.stringify({ error: "Error interno del servidor." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
