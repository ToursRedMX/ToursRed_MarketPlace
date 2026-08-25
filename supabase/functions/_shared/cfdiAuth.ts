import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Autorizacion compartida para las funciones que timbran CFDIs.
 *
 * Todas timbran ante el SAT usando el service role internamente. Como
 * verify_jwt acepta la llave publicable del front (es un JWT firmado del
 * proyecto), sin este guard cualquiera que la extraiga del bundle puede
 * timbrar comprobantes ajenos pasando solo un id.
 *
 * Mismo criterio que ya se aplico en generate-booking-cfdi:
 *   - SERVICE ROLE KEY: pasa. Son los llamadores internos (webhooks de
 *     Stripe/Openpay/Conekta/MercadoPago/PayPal, retry-failed-cfdi, etc.).
 *     Todos verificados: usan ese bearer.
 *   - admin: pasa.
 *   - dueno del recurso: pasa solo si la funcion declara `ownerUserId`.
 *     Las funciones que reciben el monto a facturar por parametro NO lo
 *     declaran, para que el dueno no pueda timbrarse importes arbitrarios.
 */

const corsHeadersForResponses = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type AdminClient = ReturnType<typeof createClient>;

export interface CfdiCaller {
  isServiceRole: boolean;
  isAdmin: boolean;
  /** null cuando el llamador es el service role (no hay usuario detras). */
  userId: string | null;
}

export type CfdiAuthOutcome =
  | { allowed: true; caller: CfdiCaller }
  | { allowed: false; response: Response };

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForResponses, "Content-Type": "application/json" },
  });
}

export function cfdiForbiddenResponse(error: string): Response {
  return jsonResponse({ error }, 403);
}

/**
 * @param admin       cliente con SERVICE_ROLE_KEY (para leer users.role sin RLS)
 * @param req         request original, de donde se lee el Authorization
 * @param ownerUserId dueno legitimo del recurso, o null/undefined si la funcion
 *                    solo admite service role y admin
 * @param resource    etiqueta para el log de intentos denegados
 */
export async function authorizeCfdiRequest(
  admin: AdminClient,
  req: Request,
  { ownerUserId, resource }: { ownerUserId?: string | null; resource: string },
): Promise<CfdiAuthOutcome> {
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();

  if (bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return { allowed: true, caller: { isServiceRole: true, isAdmin: true, userId: null } };
  }

  // La llave publicable cae aqui: es un JWT valido del proyecto pero no de un
  // usuario, asi que getUser no devuelve nadie y termina en 401.
  const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(bearer);
  if (callerErr || !caller) {
    return { allowed: false, response: jsonResponse({ error: "No autorizado" }, 401) };
  }

  const { data: callerProfile } = await admin
    .from("users")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  // El super_admin real de este esquema es la columna booleana users.is_super_admin,
  // no este valor de role; aqui no hace falta consultarla porque es una escalacion
  // sobre admin (create-admin-user, delete-auth-user), no una via alterna para serlo.
  const isAdmin = callerProfile?.role === "admin" || callerProfile?.role === "super_admin";
  if (isAdmin) {
    return { allowed: true, caller: { isServiceRole: false, isAdmin: true, userId: caller.id } };
  }

  if (ownerUserId && ownerUserId === caller.id) {
    return { allowed: true, caller: { isServiceRole: false, isAdmin: false, userId: caller.id } };
  }

  console.warn(
    `CFDI denegado: usuario ${caller.id} intento timbrar ${resource}` +
      (ownerUserId ? ` (dueno ${ownerUserId})` : " (requiere admin)")
  );
  return {
    allowed: false,
    response: jsonResponse({ error: "No tienes permiso sobre este recurso" }, 403),
  };
}
