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

/** 'email_password' para correo, y el proveedor tal cual para OAuth (p. ej. 'google'). */
export function metodoDeLogin(user: { app_metadata?: { provider?: string } } | null | undefined): string {
  const proveedor = user?.app_metadata?.provider;
  if (!proveedor || proveedor === 'email') return 'email_password';
  return proveedor;
}

/** true si la URL es el retorno de un proveedor OAuth (PKCE `code=` o implicito `access_token=`). */
export function vieneDeOAuth(href: string): boolean {
  return /[?&#]code=|[#&]access_token=/.test(href);
}

/** true si esta sesion aun no se registro. */
export function debeRegistrarLogin(sessionId: string | null, ultimoRegistrado: string | null): boolean {
  return sessionId !== null && sessionId !== ultimoRegistrado;
}
