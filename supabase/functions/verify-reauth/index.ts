// Verifica la CONTRASEÑA ACTUAL de una cuenta SIN MFA y deja una prueba de reautenticacion
// de 5 minutos (public.reauth_proofs). Es la pareja de verify-sensitive-action, que hace lo
// mismo con el codigo TOTP para las cuentas CON MFA.
//
// La regla (la decide la base, public.reauth_satisfied): con TOTP solo vale el TOTP, sin
// TOTP solo vale la contraseña. Si la cuenta tiene TOTP, aqui se responde 409 USE_TOTP y
// NO se acepta la contraseña: una contraseña no sustituye al segundo factor.
//
// Como verifica la contraseña: signInWithPassword con un cliente desechable (sin sesion
// persistente) y se cierra de inmediato la sesion que ese inicio crea. Si el proyecto tiene
// CAPTCHA en Auth, el cliente debe mandar `captchaToken` (Turnstile), igual que
// ChangePasswordSection.
//
// Limite de intentos: 5 fallidos en 10 minutos por cuenta (auth_attempts, como
// verify-sensitive-action). Falla cerrado ante cualquier error.
import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders } from "../_shared/cors.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";

const VENTANA_PRUEBA_MS = 5 * 60 * 1000;
const MAX_FALLOS = 5;
const TIPO_INTENTO = "reauth_password";

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const responder = (cuerpo: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return responder({ error: "No autorizado" }, 401);

    let body: { password?: unknown; captchaToken?: unknown };
    try { body = await req.json(); } catch { return responder({ error: "Solicitud inválida" }, 400); }
    const password = typeof body.password === "string" ? body.password : "";
    const captchaToken = typeof body.captchaToken === "string" && body.captchaToken ? body.captchaToken : undefined;
    if (!password || password.length > 256) return responder({ error: "Contraseña requerida" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, opcionesConContexto(req, {
      global: { headers: { Authorization: authHeader } },
    }));
    const { data: { user }, error: errorUsuario } = await userClient.auth.getUser();
    if (errorUsuario || !user || !user.email) return responder({ error: "No autorizado" }, 401);

    // sinUserAgentDeNavegador: el gateway rechaza la llave de servicio si ve un User-Agent de
    // navegador (mismo motivo que en verify-sensitive-action).
    const admin = createClient(supabaseUrl, serviceRoleKey, sinUserAgentDeNavegador(opcionesConContexto(req)));

    // 1. Con TOTP la contraseña NO vale: que use su codigo.
    const { data: tieneTotp, error: errorTotp } = await admin.rpc("user_has_totp", { p_user: user.id });
    if (errorTotp) {
      console.error("verify-reauth: user_has_totp", errorTotp.code ?? "sin_codigo");
      return responder({ error: "No pudimos verificar tu identidad. Intenta de nuevo." }, 503);
    }
    if (tieneTotp === true) {
      return responder({ code: "USE_TOTP", error: "Tu cuenta tiene verificación en dos pasos: confirma con el código de tu app." }, 409);
    }

    // 2. Limite de intentos fallidos.
    const hace10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: fallos, error: errorConteo } = await admin
      .from("auth_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("attempt_type", TIPO_INTENTO)
      .eq("success", false)
      .gte("attempted_at", hace10min);
    if (errorConteo) {
      console.error("verify-reauth: no se pudo contar intentos", errorConteo.code ?? "sin_codigo");
      return responder({ error: "No pudimos verificar tu identidad. Intenta de nuevo." }, 503);
    }
    if ((fallos ?? 0) >= MAX_FALLOS) {
      return responder({ code: "TOO_MANY_ATTEMPTS", error: "Demasiados intentos fallidos. Intenta de nuevo en 10 minutos." }, 429);
    }

    // 3. Contraseña: cliente desechable, sin sesion persistente.
    const verificador = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: inicio, error: errorClave } = await verificador.auth.signInWithPassword({
      email: user.email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (errorClave || !inicio?.session || inicio.user?.id !== user.id) {
      await admin.from("auth_attempts").insert({ user_id: user.id, attempt_type: TIPO_INTENTO, success: false });
      return responder({ code: "INVALID_PASSWORD", error: "La contraseña actual es incorrecta." }, 400);
    }
    // La sesion que acaba de crear la verificacion no debe quedar viva. Mejor esfuerzo.
    const { error: errorCierre } = await admin.auth.admin.signOut(inicio.session.access_token, "local");
    if (errorCierre) console.error("verify-reauth: no se pudo cerrar la sesion de verificacion", errorCierre.message);

    // 4. Guardar la prueba. Si no queda guardada NO se dice que quedo verificado.
    const ahora = new Date();
    const { error: errorPrueba } = await admin.from("reauth_proofs").insert({
      user_id: user.id,
      method: "password",
      verified_at: ahora.toISOString(),
      expires_at: new Date(ahora.getTime() + VENTANA_PRUEBA_MS).toISOString(),
    });
    if (errorPrueba) {
      console.error("verify-reauth: no se pudo guardar la prueba", errorPrueba.code ?? "sin_codigo");
      return responder({ error: "Tu contraseña era correcta, pero no pudimos guardar la verificación. Intenta de nuevo." }, 500);
    }
    const { error: errorExito } = await admin.from("auth_attempts").insert({ user_id: user.id, attempt_type: TIPO_INTENTO, success: true });
    if (errorExito) console.error("verify-reauth: no se pudo registrar el intento exitoso", errorExito.code ?? "sin_codigo");

    return responder({ verified: true, method: "password", expires_in: VENTANA_PRUEBA_MS / 1000 }, 200);
  } catch (e) {
    console.error("verify-reauth:", e instanceof Error ? e.name : "error");
    return responder({ error: "No pudimos verificar tu identidad. Intenta de nuevo." }, 503);
  }
});
