// Canjea el codigo OTP de LOGIN por una sesion. Llega SIN sesion.
//
// verify_phone_challenge (la misma funcion SQL del motor OTP) decide si el codigo es bueno: 5 intentos
// por reto, tope diario de fallos en el bucket `login:<user>`, un solo uso, vigencia de 10 minutos.
// Solo con `ok` esta funcion abre la sesion: auth.admin.generateLink({type:'magiclink'}) devuelve un
// token_hash de UN solo uso que el navegador canjea con supabase.auth.verifyOtp. La sesion nace aal1;
// si la cuenta tiene TOTP, la pantalla de login pide el codigo antes de dejar pasar (y MfaGate sigue
// mandando en admin/contador/ejecutivo).
//
// Interruptor: platform_settings.phone_login_enabled (default false).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { corsHeaders } from '../_shared/cors.ts';
import { hmac, datosOtp } from '../_shared/mensajeria/seguridad.ts';

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  try {
    const raw = await req.text(); if (raw.length > 1024) throw Error('invalid');
    const body = JSON.parse(raw);
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code) || typeof body.challenge_id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.challenge_id)) return Response.json({ code: 'OTP_INVALID' }, { status: 400, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { data: settings, error: settingsError } = await client.from('platform_settings').select('phone_login_enabled').single();
    if (settingsError) throw Error('configuracion_no_disponible');
    if (!settings.phone_login_enabled) return Response.json({ code: 'PHONE_LOGIN_DISABLED' }, { status: 503, headers: cors });

    const { data: challenge, error } = await client.rpc('get_login_challenge', { p_id: body.challenge_id });
    // Reto inexistente, vencido o falso (el de una cuenta que no existe): misma respuesta que un codigo malo.
    if (error) throw Error('reto_no_disponible');
    if (!challenge || challenge.pepper_version !== 1) return Response.json({ code: 'OTP_INVALID' }, { status: 400, headers: cors });
    const userId = challenge.user_id as string;

    const pepper = Deno.env.get('PHONE_OTP_PEPPER') ?? '';
    const [hash, userHash] = await Promise.all([hmac(pepper, datosOtp(userId, body.challenge_id, challenge.phone, body.code)), hmac(pepper, 'login:' + userId)]);
    const { data, error: verifyError } = await client.rpc('verify_phone_challenge', { p_user: userId, p_id: body.challenge_id, p_hash: hash, p_user_hash: userHash });
    if (verifyError) throw Error('verify');
    if (!data?.ok) return Response.json({ code: data?.code ?? 'OTP_INVALID' }, { status: 400, headers: cors });

    // Codigo bueno. Se abre la sesion; si algo falla aqui NO se entra (el reto ya se gasto: hay que pedir otro).
    const { data: found, error: userError } = await client.auth.admin.getUserById(userId);
    if (userError || !found?.user?.email) throw Error('usuario_no_disponible');
    const { data: link, error: linkError } = await client.auth.admin.generateLink({ type: 'magiclink', email: found.user.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) throw Error('sesion_no_disponible');
    return Response.json({ ok: true, token_hash: tokenHash, verification_type: 'magiclink' }, { headers: cors });
  } catch (e) {
    console.error('verify-login-otp', e instanceof Error ? e.message : 'error');
    return Response.json({ code: 'OTP_UNAVAILABLE' }, { status: 503, headers: cors });
  }
});
