// Fijar o cambiar la contraseña pasa SIEMPRE por la Edge Function `set-password` (reautenticacion en el servidor).
// Nada en el front llama ya a `supabase.auth.updateUser({ password })`: ese camino no pide la contraseña actual y
// quien tuviera un token de sesion cambiaba la contraseña sin conocerla.
//
// Devuelve `{ error }` con la misma forma que `updateUser`, de modo que las pantallas siguen usando
// `esContrasenaFiltrada(error)`: una contraseña de filtraciones conocidas vuelve como
// `{ code: 'weak_password', reasons: ['pwned'] }`.
import { supabase } from './supabase';

export type InvocarFuncion = (
  nombre: string,
  body: unknown,
) => Promise<{ data: { code?: unknown; error?: unknown } | null; error: Error | null }>;

const MENSAJES: Record<string, string> = {
  PASSWORD_POLICY: 'La contraseña no cumple los requisitos: mínimo 8 caracteres, con mayúsculas, minúsculas y números.',
  PASSWORD_PWNED: 'Esta contraseña ha sido expuesta en brechas de datos conocidas y no puede usarse. Por favor elige una contraseña diferente y más segura.',
  PASSWORD_WEAK: 'La contraseña elegida no es lo bastante segura. Elige otra.',
  PASSWORD_SAME: 'La nueva contraseña debe ser diferente a la actual.',
  PASSWORD_UNAVAILABLE: 'No pudimos cambiar la contraseña. Intenta de nuevo.',
  REAUTH_REQUIRED: 'Necesitamos confirmar tu identidad para cambiar la contraseña.',
  USER_SESSION_REQUIRED: 'Tu sesión venció. Vuelve a iniciar sesión.',
};

/** Invocacion simple (sin modal de reautenticacion): para el alta con Google/Microsoft/X/Facebook/LinkedIn, donde la cuenta aun no tiene contraseña. */
const invocarSimple: InvocarFuncion = async (nombre, body) => {
  const { data, error } = await supabase.functions.invoke(nombre, { body: body as Record<string, unknown> });
  if (!error) return { data, error: null };
  let cuerpo: { code?: unknown; error?: unknown } | null = null;
  if (error.context instanceof Response) {
    try { cuerpo = await error.context.json(); } catch { /* mensaje generico */ }
  }
  return { data: cuerpo, error: error instanceof Error ? error : new Error('No se pudo completar la solicitud.') };
};

/**
 * @param invocar `invokeWithStepUp` de useStepUp() cuando la persona YA tiene contraseña o MFA (abre el modal de
 *                reautenticacion y reintenta); sin él, una llamada simple.
 */
export async function establecerContrasena(
  password: string,
  invocar: InvocarFuncion = invocarSimple,
): Promise<{ error: Error | null }> {
  const { data, error } = await invocar('set-password', { new_password: password });
  if (!error) return { error: null };
  const codigo = typeof data?.code === 'string' ? data.code : '';
  if (codigo === 'PASSWORD_PWNED') {
    return { error: Object.assign(new Error(MENSAJES.PASSWORD_PWNED), { code: 'weak_password', reasons: ['pwned'] }) };
  }
  const mensajeDelServidor = typeof data?.error === 'string' ? data.error : '';
  return { error: new Error(MENSAJES[codigo] ?? (mensajeDelServidor || error.message)) };
}
