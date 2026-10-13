// Fija o cambia la contraseña de la cuenta DESDE EL SERVIDOR, con reautenticación (13-oct-2026).
//
// POR QUE EXISTE
// Hasta hoy la app llamaba `supabase.auth.updateUser({ password })` desde el navegador. La pantalla de cambio de
// contraseña comprobaba la actual con signInWithPassword, pero eso es solo la interfaz: `updateUser` no la exige,
// así que quien tuviera un token de sesión (sesión robada, o un acceso por celular de una cuenta sin MFA) la
// cambiaba sin conocerla. Aquí la regla única de reautenticación vive en el servidor:
//
//   cuenta CON contraseña            -> TOTP si tiene MFA, si no la contraseña actual (enforceReauth)
//   cuenta SIN contraseña, CON TOTP  -> TOTP
//   cuenta SIN contraseña, SIN TOTP  -> se permite (es el alta con Google/Microsoft/X/Facebook/LinkedIn: no hay
//                                       contraseña actual que pedir). Limite conocido y aceptado.
//
// Esto SOLO cierra la puerta cuando el ajuste «Require current password when changing password» de Supabase Auth
// esta activo: ese ajuste bloquea `updateUser({ password })` directo. La Edge Function usa la API de administracion,
// que no pasa por ese ajuste.
//
// Un cambio real (la cuenta ya tenia contraseña) cierra las demás sesiones y avisa por correo.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceReauth } from '../_shared/reauth.ts';
import { validarContrasena } from '../_shared/politicaContrasena.ts';
import { opcionesConContexto, sinUserAgentDeNavegador } from '../_shared/contextoAuditoria.ts';
import { enviarCorreoSimple, marcoCorreoSeguridad } from '../_shared/correoSimple.ts';

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  const responder = (cuerpo: Record<string, unknown>, status = 200) => Response.json(cuerpo, { status, headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', sinUserAgentDeNavegador(opcionesConContexto(req, { auth: { persistSession: false } })));
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return responder({ code: 'USER_SESSION_REQUIRED' }, 401);

    const raw = await req.text(); if (raw.length > 1024) return responder({ code: 'PASSWORD_POLICY', error: 'La contraseña es demasiado larga.' }, 422);
    const body = JSON.parse(raw);
    const nueva = typeof body.new_password === 'string' ? body.new_password : '';
    const errorDePolitica = validarContrasena(nueva);
    if (errorDePolitica) return responder({ code: 'PASSWORD_POLICY', error: errorDePolitica }, 422);

    const { data: tienePassword, error: errorPassword } = await admin.rpc('user_has_password', { p_user: user.id });
    const { data: tieneTotp, error: errorTotp } = await admin.rpc('user_has_totp', { p_user: user.id });
    if (errorPassword || errorTotp) return responder({ code: 'PASSWORD_UNAVAILABLE', error: 'No pudimos verificar tu cuenta. Intenta de nuevo.' }, 503);

    // Reautenticacion ANTES de cualquier efecto. Falla cerrado.
    if (tienePassword === true || tieneTotp === true) {
      const reauthBloqueo = await enforceReauth(admin, user.id, cors);
      if (reauthBloqueo) return reauthBloqueo;
    }

    const { error: errorCambio } = await admin.auth.admin.updateUserById(user.id, { password: nueva });
    if (errorCambio) {
      const e = errorCambio as { code?: string; reasons?: string[]; message?: string };
      if (e.code === 'weak_password') {
        const filtrada = Array.isArray(e.reasons) ? e.reasons.includes('pwned') : /known to be weak|leaked|pwned|compromised|common password/i.test(e.message ?? '');
        return responder({ code: filtrada ? 'PASSWORD_PWNED' : 'PASSWORD_WEAK', error: 'La contraseña elegida no es lo bastante segura.' }, 422);
      }
      if (e.code === 'same_password') return responder({ code: 'PASSWORD_SAME', error: 'La nueva contraseña debe ser diferente a la actual.' }, 422);
      console.error('set-password: no se pudo actualizar', e.code ?? 'sin_codigo');
      return responder({ code: 'PASSWORD_UNAVAILABLE', error: 'No pudimos cambiar la contraseña. Intenta de nuevo.' }, 503);
    }

    if (tienePassword === true) {
      // Otras sesiones abiertas (por ejemplo la de quien tuviera la contraseña vieja) dejan de servir.
      try { await admin.auth.admin.signOut(token, 'others'); } catch { console.error('set-password: no se pudieron cerrar las otras sesiones'); }
      if (user.email) {
        await enviarCorreoSimple(admin, user.email, 'Cambió la contraseña de tu cuenta de ToursRed', marcoCorreoSeguridad(
          'Cambió tu contraseña',
          `<p style="font-size:16px;">La contraseña de tu cuenta de ToursRed se acaba de cambiar.</p>
           <p style="font-size:14px;color:#666;">Si fuiste tú, no necesitas hacer nada. Si no reconoces este cambio, escríbenos de inmediato a contacto@toursred.com.</p>`,
        ));
      }
    }
    return responder({ ok: true, changed: tienePassword === true });
  } catch {
    return responder({ code: 'PASSWORD_UNAVAILABLE', error: 'No pudimos cambiar la contraseña. Intenta de nuevo.' }, 503);
  }
});
