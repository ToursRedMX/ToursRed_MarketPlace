// Pide un codigo OTP (SMS o WhatsApp) para ENTRAR con el telefono verificado. Llega SIN sesion.
//
// Reusa el motor OTP de request-phone-otp (mismos topes, Turnstile, modo simulacion y canales) con
// tres diferencias, todas de seguridad:
//   1. La cuenta se busca por users.phone_verified_e164 (solo activas, con correo verificado).
//   2. Si el telefono no pertenece a nadie NO se dice: se responde con la misma forma que un envio real
//      (reto falso, nada se envia). Limite honesto: el cooldown de 60 s y los topes solo existen para
//      cuentas reales, asi que insistir revela cuales son reales; el costo es solo ese.
//   3. Los fallos usan su propio bucket (`login:<user>`), de modo que alguien que adivine mal el codigo
//      de una cuenta ajena bloquea su LOGIN POR TELEFONO, pero no su verificacion normal ni su
//      correo+contraseña.
//
// Interruptor: platform_settings.phone_login_enabled (default false).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { extraerIpDelCliente } from '../_shared/contextoAuditoria.ts';
import { normalizarTelefonoSms } from '../_shared/mensajeria/telefono.ts';
import { hmac, nuevoCodigo, datosOtp } from '../_shared/mensajeria/seguridad.ts';
import { plantillaOtp } from '../_shared/mensajeria/plantillas.ts';
import { cargarRuntime, enviarPersistido } from '../_shared/mensajeria/servicio.ts';

const ERRORES_DE_LIMITE = ['OTP_COOLDOWN', 'OTP_RATE_LIMIT', 'OTP_LOCKED', 'SMS_UNAVAILABLE'];

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  try {
    const raw = await req.text(); if (raw.length > 4096) throw Error('peticion_invalida');
    const body = JSON.parse(raw);
    if (typeof body.phone !== 'string' || typeof body.country !== 'string') throw Error('telefono_invalido');
    const channel = body.channel ?? 'sms';
    if (channel !== 'sms' && channel !== 'whatsapp') return Response.json({ code: 'OTP_CHANNEL_INVALID' }, { status: 400, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { data: settings, error: settingsError } = await client.from('platform_settings').select('turnstile_auth_enabled, phone_login_enabled').single();
    if (settingsError) throw Error('configuracion_no_disponible');
    if (!settings.phone_login_enabled) return Response.json({ code: 'PHONE_LOGIN_DISABLED' }, { status: 503, headers: cors });
    const runtime = await cargarRuntime(client);
    if (!(channel === 'sms' ? runtime.settings.sms_habilitado : runtime.settings.whatsapp_habilitado) || !runtime.processor_ready) return Response.json({ code: 'SMS_UNAVAILABLE' }, { status: 503, headers: cors });
    if (settings.turnstile_auth_enabled) {
      const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
      if (!secret || typeof body.turnstile_token !== 'string' || !body.turnstile_token) return Response.json({ code: 'CAPTCHA_REQUIRED' }, { status: 403, headers: cors });
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: body.turnstile_token }), signal: AbortSignal.timeout(8000) });
      if (!r.ok || (await r.json()).success !== true) return Response.json({ code: 'CAPTCHA_INVALID' }, { status: 403, headers: cors });
    }
    const phone = normalizarTelefonoSms(body.phone, body.country, runtime.settings.sms_paises_permitidos);
    const forma = (id: string, extra: Record<string, unknown> = {}) => ({ ok: true, challenge_id: id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), simulated: runtime.settings.sms_modo_prueba, channel, phone_suffix: phone.e164.slice(-4), ...extra });

    const { data: userId, error: findError } = await client.rpc('find_user_for_phone_login', { p_e164: phone.e164 });
    if (findError) throw Error('busqueda_no_disponible');
    if (!userId) {
      // Cuenta inexistente: misma forma de respuesta, pausa parecida a la de un envio real, nada sale.
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      return Response.json(forma(crypto.randomUUID(), { delivery: 'enviado' }), { headers: cors });
    }

    const pepper = Deno.env.get('PHONE_OTP_PEPPER') ?? '', id = crypto.randomUUID(), code = nuevoCodigo();
    // cf-connecting-ip primero: el ultimo salto de x-forwarded-for era un proxy de Supabase (20261014054007).
    const ip = extraerIpDelCliente(req);
    const [codeHash, userHash, phoneHash, ipHash] = await Promise.all([hmac(pepper, datosOtp(userId, id, phone.e164, code)), hmac(pepper, 'login:' + userId), hmac(pepper, 'phone:' + phone.e164), hmac(pepper, 'ip:' + (ip ?? 'unknown'))]);
    const { data, error } = await client.rpc('issue_phone_challenge', { p_user: userId, p_id: id, p_phone: phone.e164, p_hash: codeHash, p_user_hash: userHash, p_phone_hash: phoneHash, p_ip_hash: ipHash, p_simulated: runtime.settings.sms_modo_prueba, p_channel: channel, p_ip: ip });
    if (error) throw Error('emision_no_disponible');
    if (!data?.ok) {
      if (ERRORES_DE_LIMITE.includes(data?.code)) return Response.json({ code: data.code }, { status: data.code === 'SMS_UNAVAILABLE' ? 503 : 429, headers: cors });
      // Cualquier otro rechazo (cuenta que dejo de ser elegible, telefono ya de otra cuenta...) no se explica.
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      return Response.json(forma(crypto.randomUUID(), { delivery: 'enviado' }), { headers: cors });
    }
    const sent = await enviarPersistido(client, runtime, { verificationId: id }, 'otp', phone.e164, plantillaOtp(code), channel, code);
    return Response.json(forma(id, { expires_at: data.expires_at, simulated: data.simulated, delivery: sent.estado }), { status: sent.estado === 'fallido' ? 503 : 200, headers: cors });
  } catch (error) {
    const known = error instanceof Error && ['telefono_invalido', 'pais_invalido', 'pais_no_soportado', 'usa_formato_mexicano_52', 'peticion_invalida'].includes(error.message) ? error.message : null;
    return Response.json({ code: known ?? 'OTP_UNAVAILABLE' }, { status: known ? 400 : 503, headers: cors });
  }
});
