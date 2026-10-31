// Reautenticacion unica para acciones sensibles (cambiar telefono/correo/contraseña,
// cancelar reservas). La regla vive en la base (`public.reauth_satisfied`); aqui solo se
// consulta y se arma la respuesta.
//
//   cuenta CON TOTP verificado -> solo vale un codigo TOTP reciente (verify-sensitive-action)
//   cuenta SIN TOTP            -> solo vale la contraseña actual (verify-reauth)
//
// NO sustituye a `enforceStepUp` (stepUpCheck.ts): ese EXIGE tener MFA y es para mover
// ToursRed Cash. Este deja pasar a quien no tiene MFA siempre que pruebe su contraseña.
//
// Falla CERRADO: si no se puede consultar la base, se rechaza (503), nunca se deja pasar.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export type MetodoReauth = "totp" | "password";

function json(cuerpo: Record<string, unknown>, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/**
 * Devuelve `null` si la reautenticacion vigente cumple la regla para esta cuenta; si no,
 * una Response lista para devolver al cliente:
 *   403 { code: "REAUTH_REQUIRED", method: "totp" | "password" }
 *   503 { code: "REAUTH_UNAVAILABLE" }   (no se pudo comprobar: se rechaza)
 *
 * `admin` DEBE ser un cliente con service role: las funciones SQL solo se conceden a ese rol.
 */
export async function enforceReauth(
  admin: Pick<SupabaseClient, "rpc">,
  userId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!userId) return json({ code: "REAUTH_REQUIRED", method: "password", error: "Debes verificar tu identidad." }, 403, cors);
  const { data: vigente, error } = await admin.rpc("reauth_satisfied", { p_user: userId });
  if (error) {
    console.error("enforceReauth: no se pudo consultar reauth_satisfied", error.code ?? "sin_codigo");
    return json({ code: "REAUTH_UNAVAILABLE", error: "No pudimos verificar tu identidad. Intenta de nuevo." }, 503, cors);
  }
  if (vigente === true) return null;
  const { data: tieneTotp, error: errorTotp } = await admin.rpc("user_has_totp", { p_user: userId });
  if (errorTotp) {
    console.error("enforceReauth: no se pudo consultar user_has_totp", errorTotp.code ?? "sin_codigo");
    return json({ code: "REAUTH_UNAVAILABLE", error: "No pudimos verificar tu identidad. Intenta de nuevo." }, 503, cors);
  }
  const method: MetodoReauth = tieneTotp === true ? "totp" : "password";
  return json({
    code: "REAUTH_REQUIRED",
    method,
    error: method === "totp"
      ? "Para continuar, confirma tu identidad con el código de tu app de autenticación."
      : "Para continuar, confirma tu identidad con tu contraseña actual.",
  }, 403, cors);
}
