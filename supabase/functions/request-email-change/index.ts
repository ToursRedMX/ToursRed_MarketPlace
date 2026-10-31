// Paso 1 del cambio de correo: reautenticacion + codigo de 6 digitos al correo NUEVO.
//
// El correo vigente NO cambia aqui. Orden: sesion -> reautenticacion (TOTP si hay MFA, si no
// contraseña actual; falla cerrado) -> disponibilidad del correo -> codigo (HMAC, 15 min, 5 intentos,
// 3 solicitudes por hora) -> envio. Si el correo ya es de otra cuenta se responde igual que si se
// hubiera enviado: ni siquiera una sesion legitima puede usar esto para sondear que correos existen.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { corsHeaders } from '../_shared/cors.ts';
import { enforceReauth } from '../_shared/reauth.ts';
import { hmac, nuevoCodigo } from '../_shared/mensajeria/seguridad.ts';
import { enviarCorreoSimple, marcoCorreoSeguridad } from '../_shared/correoSimple.ts';

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  const responder = (cuerpo: Record<string, unknown>, status = 200) => Response.json(cuerpo, { status, headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return responder({ code: 'USER_SESSION_REQUIRED' }, 401);

    const raw = await req.text(); if (raw.length > 2048) return responder({ code: 'EMAIL_INVALID' }, 400);
    const body = JSON.parse(raw);
    const nuevo = typeof body.new_email === 'string' ? body.new_email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo) || nuevo.length > 254) return responder({ code: 'EMAIL_INVALID' }, 400);

    // Reautenticacion ANTES de cualquier efecto.
    const reauthBloqueo = await enforceReauth(admin, user.id, cors);
    if (reauthBloqueo) return reauthBloqueo;

    if (nuevo === (user.email ?? '').toLowerCase()) return responder({ code: 'EMAIL_SAME' }, 400);

    const { data: disponible, error: errorDisponible } = await admin.rpc('check_email_available', { p_email: nuevo });
    if (errorDisponible) return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);

    const pepper = Deno.env.get('PHONE_OTP_PEPPER') ?? '';
    const codigo = nuevoCodigo();
    const hash = await hmac(pepper, `email_change:${user.id}:${codigo}`);
    if (disponible !== false) {
      const { data, error } = await admin.rpc('issue_email_change', { p_user: user.id, p_new_email: nuevo, p_hash: hash });
      if (error) return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);
      if (!data?.ok) return responder({ code: data?.code ?? 'EMAIL_CHANGE_UNAVAILABLE' }, data?.code === 'EMAIL_CHANGE_RATE_LIMIT' ? 429 : 400);
      const enviado = await enviarCorreoSimple(admin, nuevo, 'Confirma tu nuevo correo en ToursRed', marcoCorreoSeguridad(
        'Confirma tu nuevo correo',
        `<p style="font-size:16px;">Pediste usar este correo en tu cuenta de ToursRed. Para confirmarlo escribe este código en la página:</p>
         <p style="font-size:36px;font-weight:bold;color:#667eea;letter-spacing:8px;font-family:'Courier New',monospace;text-align:center;margin:24px 0;">${codigo}</p>
         <p style="font-size:14px;color:#666;">El código vence en 15 minutos. Si tú no lo pediste, ignora este mensaje: tu cuenta no cambia.</p>`,
      ));
      if (!enviado) return responder({ code: 'EMAIL_SEND_FAILED' }, 503);
    }
    return responder({ ok: true, expires_in_seconds: 15 * 60 });
  } catch {
    return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);
  }
});
