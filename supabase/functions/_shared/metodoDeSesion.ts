/**
 * Con que metodo se abrio una sesion, decidido con el `amr` del token.
 * Lo usa record-session-event; vive aqui para poder probarlo
 * (scripts/test-registro-de-login.mjs).
 */

export const PROVEEDORES_OAUTH = new Set(["google", "azure", "x", "facebook", "linkedin_oidc"]);

/** Metodos del claim `amr` de un token ya verificado, del mas reciente al mas viejo. */
export function metodosDelToken(authHeader: string | null): string[] {
  try {
    const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
    const cuerpo = token.split(".")[1];
    if (!cuerpo) return [];
    const amr = JSON.parse(atob(cuerpo.replace(/-/g, "+").replace(/_/g, "/")))?.amr;
    if (!Array.isArray(amr)) return [];
    return amr
      .filter((a: { method?: unknown }) => typeof a?.method === "string")
      .sort((a: { timestamp?: number }, b: { timestamp?: number }) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))
      .map((a: { method: string }) => a.method);
  } catch {
    return [];
  }
}

/**
 * Metodo con el que se abrio la sesion. Lo decide el SERVIDOR con el `amr` del
 * token ya verificado (lo firma GoTrue); del cliente solo se toma el nombre del
 * proveedor OAuth, que el token no trae, y solo si es uno conocido.
 *
 * El 25-sep-2026 el front calculaba esto por su cuenta y cuatro logins con
 * Google llegaron como 'email_password' pese a que `mfa_amr_claims` decia
 * 'oauth'. No se pudo ver por que desde el servidor; por eso la decision se
 * movio aqui y el desacuerdo queda en el log.
 */
export function metodoDeLaSesion(authHeader: string | null, proveedorDelCliente: unknown, metodoDelCliente: unknown): string {
  const primero = metodosDelToken(authHeader).find((m) => m !== "totp" && !m.startsWith("mfa"));
  if (primero === "oauth") {
    return typeof proveedorDelCliente === "string" && PROVEEDORES_OAUTH.has(proveedorDelCliente)
      ? proveedorDelCliente
      : "oauth";
  }
  if (primero === "password") return "email_password";
  if (primero) return primero;
  return typeof metodoDelCliente === "string" && metodoDelCliente.length <= 40 ? metodoDelCliente : "email_password";
}
