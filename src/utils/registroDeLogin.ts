/**
 * Cuando se registra un login en `user_sessions`, y con que metodo.
 *
 * POR QUE EXISTE
 *
 * Hasta el 25-sep-2026 los logins con Google no se registraban nunca: al
 * volver del proveedor, `initializeAuth` recoge la sesion de la URL y marca al
 * usuario como ya inicializado, y el `SIGNED_IN` que llega despues sale por la
 * guarda de «mismo usuario» ANTES de llamar a `record-session-event`. Ademas
 * `login_method` iba fijo en 'email_password'.
 *
 * La regla: se registra UNA vez por sesion de GoTrue (el claim `session_id`
 * del JWT), sin importar si el aviso llega por `SIGNED_IN` o por el retorno
 * de OAuth, ni cuantas pestanas haya. Una recarga normal no es un login.
 */

export const CLAVE_ULTIMO_LOGIN_REGISTRADO = 'toursred.login_registrado';

/** `session_id` del JWT de GoTrue, o null. Solo lee; no verifica la firma. */
export function sessionIdDeToken(accessToken: string | null | undefined): string | null {
  try {
    const cuerpo = (accessToken ?? '').split('.')[1];
    if (!cuerpo) return null;
    const json = atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/'));
    const sid = JSON.parse(json)?.session_id;
    return typeof sid === 'string' && sid.length > 0 ? sid : null;
  } catch {
    return null;
  }
}

/**
 * Proveedor OAuth segun la ruta de regreso: cada boton de AuthContext vuelve a
 * su propia ruta (`/auth/google-callback`, `/auth/azure-callback`...). null si
 * la URL no es un retorno de OAuth.
 */
export function proveedorDelRetorno(href: string): string | null {
  const m = /\/auth\/(google|azure|x|facebook|linkedin)-callback\b/.exec(href);
  if (!m) return null;
  return m[1] === 'linkedin' ? 'linkedin_oidc' : m[1];
}

/**
 * Metodo con el que se abrio ESTA sesion.
 *
 * No sale de `user.app_metadata.provider`: ese es el PRIMER proveedor con el
 * que se creo la cuenta, no el de esta sesion. El 25-sep-2026 un login con
 * Google quedo como 'email_password' porque la cuenta nacio con correo (y
 * tiene seis proveedores vinculados).
 *
 * Sale del claim `amr` del token (lo firma GoTrue): 'password' ->
 * 'email_password'; 'oauth' -> el proveedor de la ruta de regreso, o 'oauth'
 * si no se sabe. Se ignoran los factores de MFA (totp), que se agregan
 * encima del primero.
 */
export function metodoDeLogin(accessToken: string | null | undefined, proveedorRetorno: string | null): string {
  let metodo: string | null = null;
  try {
    const cuerpo = (accessToken ?? '').split('.')[1];
    const amr = cuerpo ? JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')))?.amr : null;
    if (Array.isArray(amr)) {
      const primeros = amr
        .filter((a) => a && typeof a.method === 'string' && a.method !== 'totp' && !a.method.startsWith('mfa'))
        .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));
      metodo = primeros[0]?.method ?? null;
    }
  } catch {
    metodo = null;
  }
  if (metodo === 'oauth') return proveedorRetorno ?? 'oauth';
  if (metodo === 'password' || metodo === null) return 'email_password';
  return metodo;
}

/** true si la URL es el retorno de un proveedor OAuth (PKCE `code=` o implicito `access_token=`). */
export function vieneDeOAuth(href: string): boolean {
  return /[?&#]code=|[#&]access_token=/.test(href);
}

/** true si esta sesion aun no se registro. */
export function debeRegistrarLogin(sessionId: string | null, ultimoRegistrado: string | null): boolean {
  return sessionId !== null && sessionId !== ultimoRegistrado;
}
