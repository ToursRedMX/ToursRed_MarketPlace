// Paso 2 del cambio de correo: el codigo llego al correo NUEVO, asi que quien lo teclea lo controla.
//
// confirm_email_change (SQL) decide: un solo uso, 5 intentos, 15 minutos. Con codigo bueno se cambia el
// correo en Auth (ya verificado), se sincroniza public.users (el trigger sync_user_email solo corre al
// escribir esa fila, no cuando cambia auth.users), se avisa al correo ANTERIOR y se cierran las demas
// sesiones de la cuenta. La reautenticacion se exigio al pedir el codigo; aqui la prueba es el codigo.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { hmac } from '../_shared/mensajeria/seguridad.ts';
import { enviarCorreoSimple, marcoCorreoSeguridad, enmascararCorreo } from '../_shared/correoSimple.ts';

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

    const raw = await req.text(); if (raw.length > 512) return responder({ code: 'CODE_INVALID' }, 400);
    const body = JSON.parse(raw);
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return responder({ code: 'CODE_INVALID' }, 400);

    const hash = await hmac(Deno.env.get('PHONE_OTP_PEPPER') ?? '', `email_change:${user.id}:${body.code}`);
    const { data, error } = await admin.rpc('confirm_email_change', { p_user: user.id, p_hash: hash });
    if (error) return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);
    if (!data?.ok) return responder({ code: data?.code ?? 'CODE_INVALID' }, data?.code === 'CODE_LOCKED' ? 429 : 400);

    const nuevo = data.new_email as string;
    const anterior = user.email ?? '';
    // Otra cuenta pudo quedarse con el correo mientras el codigo estaba vivo.
    const { data: disponible, error: errorDisponible } = await admin.rpc('check_email_available', { p_email: nuevo });
    if (errorDisponible) return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);
    if (disponible === false) return responder({ code: 'EMAIL_TAKEN' }, 409);

    const { error: authError } = await admin.auth.admin.updateUserById(user.id, { email: nuevo, email_confirm: true });
    if (authError) return responder({ code: authError.code === 'email_exists' ? 'EMAIL_TAKEN' : 'EMAIL_CHANGE_UNAVAILABLE' }, authError.code === 'email_exists' ? 409 : 503);

    // Mismo patron que el resto del proyecto: el trigger copia auth.users.email al escribir la fila.
    const { error: errorFila } = await admin.from('users').update({ email: nuevo }).eq('id', user.id);
    if (errorFila) console.error('confirm-email-change: no se pudo sincronizar public.users', errorFila.code ?? 'sin_codigo');

    if (anterior) {
      await enviarCorreoSimple(admin, anterior, 'El correo de tu cuenta de ToursRed cambió', marcoCorreoSeguridad(
        'El correo de tu cuenta cambió',
        `<p style="font-size:16px;">El correo de tu cuenta de ToursRed ahora es <strong>${enmascararCorreo(nuevo)}</strong>.</p>
         <p style="font-size:14px;color:#666;">Si fuiste tú, no necesitas hacer nada. Si no reconoces este cambio, escríbenos de inmediato a contacto@toursred.com.</p>`,
      ));
    }
    // Otras sesiones abiertas (por ejemplo la de quien tuviera el correo viejo) dejan de servir.
    try { await admin.auth.admin.signOut(token, 'others'); } catch { console.error('confirm-email-change: no se pudieron cerrar las otras sesiones'); }

    return responder({ ok: true, email: nuevo });
  } catch {
    return responder({ code: 'EMAIL_CHANGE_UNAVAILABLE' }, 503);
  }
});
