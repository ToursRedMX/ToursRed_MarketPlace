import assert from 'node:assert/strict';
import { twilio } from '../../supabase/functions/_shared/mensajeria/proveedores/twilio.ts';
import { enrutar } from '../../supabase/functions/_shared/mensajeria/enrutador.ts';
import { parseTwilioCallback } from '../../supabase/functions/_shared/mensajeria/twilioWebhook.ts';
import type { MensajeSms, RoutingSettings } from '../../supabase/functions/_shared/mensajeria/tipos.ts';

const config = { accountSid: 'AC'+'a'.repeat(32), authToken: 'b'.repeat(32), whatsappFrom: 'whatsapp:+15005550006', whatsappContentSid: 'HX'+'c'.repeat(32) };
const sid = 'SM'+'d'.repeat(32);
const message: MensajeSms = { destino: '+525512345678', texto: 'OTP', codigoOtp: '123456', canal: 'whatsapp', correlacion: 'a'.repeat(20), categoria: 'otp', simulacion: false, urlEstados: 'https://example.invalid/callback' };
const settings: RoutingSettings = { sms_habilitado: false, sms_modo_prueba: false, sms_proveedor_otp: 'labsmobile', sms_proveedor_transaccional: 'labsmobile', sms_proveedor_recordatorios: 'labsmobile', sms_proveedor_respaldo: 'twilio', sms_fallback_habilitado: true, whatsapp_habilitado: true, whatsapp_proveedor_otp: 'twilio' };

Deno.test('WhatsApp uses approved template and transport prefixes, never SMS Body or sender', async () => {
  const adapter = twilio(config, async (_url, init) => {
    const payload = new URLSearchParams(String(init?.body));
    assert.equal(payload.get('To'), 'whatsapp:'+message.destino);
    assert.equal(payload.get('From'), config.whatsappFrom);
    assert.equal(payload.get('ContentSid'), config.whatsappContentSid);
    assert.deepEqual(JSON.parse(payload.get('ContentVariables')!), { '1': '123456' });
    assert.equal(payload.has('Body'), false);
    assert.equal(payload.get('ValidityPeriod'), '600');
    return Response.json({ sid, status: 'queued' }, { status: 201 });
  });
  assert.equal((await adapter.enviar(message)).estado, 'aceptado');
});
Deno.test('WhatsApp simulation and missing template cannot contact live transport', async () => {
  let calls = 0;
  const transport = async () => { calls++; return Response.json({}); };
  assert.equal((await twilio(config, transport).enviar({ ...message, simulacion: true })).estado, 'simulado');
  assert.equal((await twilio({ ...config, whatsappContentSid: undefined }, transport).enviar(message)).estado, 'fallido');
  assert.equal(calls, 0);
});
Deno.test('WhatsApp ignores SMS disable and fallback; LabsMobile cannot route WhatsApp', async () => {
  const calls: string[] = [];
  const send = async (p: string) => { calls.push(p); return { estado: 'fallido' as const, clase: 'rechazo_confirmado' as const, codigo: 'rejected' }; };
  await enrutar(settings, 'otp', send, 'whatsapp');
  assert.deepEqual(calls, ['twilio']);
  calls.length = 0;
  await enrutar({ ...settings, whatsapp_habilitado: false }, 'otp', send, 'whatsapp');
  await enrutar({ ...settings, whatsapp_proveedor_otp: 'labsmobile' }, 'otp', send, 'whatsapp');
  await enrutar(settings, 'reserva_confirmada', send, 'whatsapp');
  assert.equal(calls.length, 0);
});
Deno.test('WhatsApp read callback preserves prefix for database channel binding', () => {
  const params = { AccountSid: config.accountSid, MessageSid: sid, To: 'whatsapp:'+message.destino, MessageStatus: 'read' };
  assert.equal(parseTwilioCallback(params, config.accountSid), null);
  assert.deepEqual(parseTwilioCallback(params, config.accountSid, true), { sid, destination: params.To, state: 'entregado', code: null });
});
Deno.test('WhatsApp readiness requires authentication approval and an online owned sender', async () => {
  let online = true;
  const adapter = twilio(config, async url => {
    const path = String(url);
    if (path.includes('ApprovalRequests')) return Response.json({ account_sid: config.accountSid, whatsapp: { status: 'approved', category: 'AUTHENTICATION' } });
    if (path.includes('content.twilio.com')) return Response.json({ account_sid: config.accountSid, types: { 'whatsapp/authentication': {} } });
    if (path.includes('Channels/Senders')) return Response.json({ senders: [{ sender_id: config.whatsappFrom, status: online ? 'ONLINE' : 'OFFLINE' }] });
    return Response.json({ sid: config.accountSid, status: 'active' });
  });
  assert.equal(await adapter.comprobarWhatsApp(), true);
  online = false;
  assert.equal(await adapter.comprobarWhatsApp(), false);
});
Deno.test('WhatsApp diagnostics name invalid variables without transport or secret values', async () => {
  let calls = 0;
  const report = await twilio({ ...config, whatsappFrom: '+15005550006' }, async () => { calls++; throw Error('unused'); }).diagnosticarWhatsApp();
  assert.deepEqual(report.failed_checks, ['whatsapp_from_format']);
  assert.equal(calls, 0);
  const serialized = JSON.stringify(report);
  for (const secret of [config.accountSid, config.authToken, config.whatsappContentSid, '+15005550006']) assert.equal(serialized.includes(secret), false);
});
Deno.test('WhatsApp diagnostics retain HTTP stage and numeric error but discard payload', async () => {
  const report = await twilio(config, async () => Response.json({ code: 20404, message: config.authToken, account_sid: config.accountSid, body: 'private' }, { status: 404 })).diagnosticarWhatsApp();
  assert.deepEqual(report.requests.map(r => [r.stage, r.http_status, r.twilio_code]), [['template_approval',404,20404],['template_content',404,20404],['account',404,20404],['senders',404,20404]]);
  assert.equal(report.checks.approval_response, false);
  const serialized = JSON.stringify(report);
  for (const secret of [config.accountSid, config.authToken, config.whatsappContentSid, 'private']) assert.equal(serialized.includes(secret), false);
});
