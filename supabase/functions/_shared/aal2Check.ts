// Verificacion de AAL2 (MFA) para Edge Functions.
//
// `allowed: true`  -> la accion procede: el usuario tiene AAL2, o el MFA no le aplica.
// `allowed: false` -> hay que bloquear la accion.
//
// ============================================================================
// POR QUE ESTE ARCHIVO FALLA CERRADO (M-2 de la auditoria del 05-sep-2026)
// ============================================================================
//
// Hasta el 08-sep-2026 este helper fallaba ABIERTO: si la RPC
// `requires_aal2_check()` devolvia error, o si algo lanzaba, devolvia
// `{ allowed: true }` con el comentario "fail-open for availability".
//
// Eso significaba que cualquiera capaz de provocar un error en esa RPC
// —o una caida transitoria de la base— desactivaba el segundo factor por
// completo en las 12 funciones que usan este helper, entre ellas
// `process-agency-payout`, `admin-credit-wallet-topup`, `admin-cancel-booking`,
// `create-admin-user` y `delete-auth-user`. Es decir: movimiento de dinero y
// alta de cuentas administrativas.
//
// Se comprobo contra la base de produccion antes de cambiarlo, y el hallazgo
// NO era teorico:
//
//   platform_settings.mfa_required_for_admins      = true
//   platform_settings.mfa_required_for_accountant  = true
//
// Los toggles estan ENCENDIDOS. O sea que el camino feliz si exige MFA hoy, y
// la rama de error era un bypass real, no latente.
//
// Tres razones mas por las que cerrar era lo correcto y no una preferencia:
//
//   1. La capa de RLS que protege estas mismas reglas YA falla cerrada. Las
//      politicas de `20260818031526` usan
//      `(NOT public.requires_aal2_check() OR public.has_aal2())`; si esa
//      funcion lanza, la sentencia entera aborta. El helper de Edge era la
//      unica capa que dejaba pasar.
//
//   2. Su helper hermano `stepUpCheck.ts` ya falla cerrado ante el mismo tipo
//      de error (`return { verified: false }`). Eran dos criterios opuestos en
//      el mismo directorio; la divergencia queda resuelta a favor del estricto.
//
//   3. Dentro de este mismo archivo la incoherencia ya existia: el error de
//      `has_aal2()` (segunda RPC) SIEMPRE fallo cerrado, y solo el de
//      `requires_aal2_check()` (primera RPC) fallaba abierto. Se lee mas como
//      un descuido que como una decision.
//
// COSTO DE DISPONIBILIDAD, MEDIDO Y NO SUPUESTO
//
// Cerrar la puerta solo puede molestar a un admin durante un error real de la
// RPC. En produccion hay dos cuentas con rol admin:
//
//   admin@toursred.com      MFA verificado      operando
//   contacto@toursred.com   SIN MFA             sin entrar desde jun-2026
//
// La cuenta sin MFA ya esta bloqueada hoy por el camino normal (toggle on +
// sin AAL2), asi que este cambio no le quita nada. Y si la base esta tan mal
// como para que esta RPC falle, la RPC que de verdad mueve el dinero
// (`process_agency_payout_atomic`, etc.) tampoco va a completarse. Cerrar no
// cuesta una operacion que de otro modo hubiera funcionado.
//
// SI ALGUIEN PIERDE SU FACTOR MFA
//
// La recuperacion no cambia con esto y sigue siendo a nivel de base, saltando
// RLS, como documenta `20260818030957_add_mfa_aal2_helper_functions_and_toggles.sql`:
// apagar `mfa_required_for_admins` / `mfa_required_for_accountant` en
// `platform_settings`, o borrar el factor en `auth.mfa_factors`.

interface SupabaseClient {
  // La RPC se consume con `await`. Tiparla como objeto plano —como estaba—
  // miente sobre el valor real (`PostgrestFilterBuilder`, que es thenable) y
  // deja pasar codigo como `.catch(...)`, que sobre ese objeto revienta.
  rpc(fn: "requires_aal2_check" | "has_aal2"): PromiseLike<{ data: unknown; error: unknown }>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * `MFA_REQUIRED`     el usuario debe activar / completar su segundo factor.
 * `MFA_CHECK_FAILED` no se pudo determinar. No es culpa del usuario y es
 *                    reintentable, por eso va con 503 y no con 403: decirle
 *                    "necesitas MFA" a un admin que SI lo tiene activado manda
 *                    a soporte por el camino equivocado.
 */
export type Aal2Code = "MFA_REQUIRED" | "MFA_CHECK_FAILED";

export interface Aal2Result {
  allowed: boolean;
  reason?: string;
  code?: Aal2Code;
}

export function aal2Response(message: string, code: Aal2Code = "MFA_REQUIRED"): Response {
  return new Response(
    JSON.stringify({ error: message, code }),
    {
      status: code === "MFA_CHECK_FAILED" ? 503 : 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

const NO_VERIFICABLE: Aal2Result = {
  allowed: false,
  reason: "No se pudo verificar el segundo factor. Intenta de nuevo en unos segundos.",
  code: "MFA_CHECK_FAILED",
};

/**
 * IMPORTANTE: `supabase` tiene que ser un cliente con el JWT DEL LLAMADOR, no
 * el de service role. `requires_aal2_check()` y `has_aal2()` leen `auth.uid()`
 * y `auth.jwt()`, que bajo service role son NULL y anulan la comprobacion en
 * silencio. Los 12 llamadores ya construyen ese cliente y verifican la firma
 * del token con `auth.getUser()` antes de llegar aqui.
 */
export async function checkAal2Required(supabase: SupabaseClient): Promise<Aal2Result> {
  try {
    const { data, error } = await supabase.rpc("requires_aal2_check");

    if (error) {
      // Sale en los logs de la funcion. Antes esta rama era muda, que es lo que
      // la hacia util para un atacante: bypass sin dejar rastro.
      console.error("[aal2] requires_aal2_check fallo; se bloquea la accion:", error);
      return NO_VERIFICABLE;
    }

    if (data !== true && data !== false && data !== "true" && data !== "false") {
      console.error("[aal2] requires_aal2_check devolvio un valor invalido");
      return NO_VERIFICABLE;
    }
    const requiresMfa = data === true || data === "true";

    if (!requiresMfa) {
      return { allowed: true };
    }

    // El MFA aplica: ahora si, ¿el token trae AAL2?
    const { data: aal2Data, error: aal2Error } = await supabase.rpc("has_aal2");

    if (aal2Error) {
      console.error("[aal2] has_aal2 fallo; se bloquea la accion:", aal2Error);
      return NO_VERIFICABLE;
    }

    if (aal2Data !== true && aal2Data !== false && aal2Data !== "true" && aal2Data !== "false") {
      console.error("[aal2] has_aal2 devolvio un valor invalido");
      return NO_VERIFICABLE;
    }
    const hasAal2 = aal2Data === true || aal2Data === "true";

    if (!hasAal2) {
      return {
        allowed: false,
        reason: "Se requiere autenticacion de dos factores (AAL2) para esta accion",
        code: "MFA_REQUIRED",
      };
    }

    return { allowed: true };
  } catch (e) {
    console.error("[aal2] excepcion verificando MFA; se bloquea la accion:", e);
    return NO_VERIFICABLE;
  }
}
