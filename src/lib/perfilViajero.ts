import { supabase } from './supabase';

type FilaDePerfil = Record<string, unknown> & { id: string };

/**
 * Crea el perfil del viajero o completa el que ya quedó a medias.
 *
 * Con los registros sociales, el perfil se crea ANTES de enviar el formulario, en
 * cuanto la persona pide el código de su correo o de su celular: ni el código de correo
 * ni el OTP por SMS pueden operar sin una fila en `users`. Esa fila queda con
 * `onboarding_completed = false` hasta que se envía el formulario; el enrutamiento
 * (AuthContext y los callbacks de OAuth) la trata como "aún sin registrar".
 *
 * Al enviar el formulario hay que completar esa fila, no insertarla. Lo que NO se
 * escribe en la actualización, a propósito:
 *   - `email` y `email_verified`: el trigger `sync_user_email` fija el correo desde
 *     auth y `proteger_columnas_privilegiadas_de_users` impide al cliente tocar
 *     `email_verified`; solo lo cambia verify-email-code.
 *   - `phone_number`, si el teléfono ya se verificó: cambiarlo (aunque sea el mismo con
 *     otro formato) arriesga borrar la verificación.
 */
export async function guardarPerfilViajero(telefonoVerificado: boolean, fila: FilaDePerfil) {
  const { data: existente, error: errorLectura } = await supabase
    .from('users')
    .select('id')
    .eq('id', fila.id)
    .maybeSingle();
  if (errorLectura) return { error: errorLectura };

  if (!existente) return supabase.from('users').insert(fila);

  const { id, email: _email, role: _role, email_verified: _verificado, phone_number: telefono, ...resto } = fila;
  void _email; void _role; void _verificado;
  return supabase
    .from('users')
    .update(telefonoVerificado ? resto : { ...resto, phone_number: telefono })
    .eq('id', id);
}
