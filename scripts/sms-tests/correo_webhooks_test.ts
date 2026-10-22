import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { filasDeWebhookSendgrid, tipoDeEventoSendgrid, verificarFirmaSendgrid } from '../../supabase/functions/_shared/correo/webhookSendgrid.ts';
import { filasDeWebhookSmtp2go, tipoDeEventoSmtp2go } from '../../supabase/functions/_shared/correo/webhookSmtp2go.ts';
import { autorizadoPorToken } from '../../supabase/functions/_shared/correo/webhookZoho.ts';

const REFERENCIA = '3f2b8c1e-9a4d-4e6b-8c0a-1d2e3f4a5b6c';
const enc = (t: string) => new TextEncoder().encode(t);

// SendGrid entrega la llave publica como el base64 de un SPKI DER; aqui se genera un par real para firmar de verdad.
function parDeLlaves() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'), privateKey };
}
function firmar(privateKey: KeyObject, timestamp: string, cuerpo: string): string {
  const firmador = createSign('SHA256');
  firmador.update(timestamp);
  firmador.update(cuerpo);
  firmador.end();
  return firmador.sign(privateKey, 'base64'); // ECDSA en DER, base64: como lo manda SendGrid
}

Deno.test('SendGrid: la firma verifica solo con la llave, el timestamp y los bytes exactos', () => {
  const { publicKey, privateKey } = parDeLlaves();
  const otra = parDeLlaves();
  const cuerpo = JSON.stringify([{ event: 'delivered', email: 'a@b.com' }]);
  const ts = '1761150000';
  const firma = firmar(privateKey, ts, cuerpo);

  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, firma, publicKey), true);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo + ' '), ts, firma, publicKey), false, 'un byte de mas');
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), '1761150001', firma, publicKey), false, 'otro timestamp');
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, firma, otra.publicKey), false, 'otra llave');
  // Faltantes o basura: nunca autoriza y nunca lanza.
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), null, firma, publicKey), false);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, null, publicKey), false);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, firma, null), false);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, firma, undefined), false);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, 'no-es-base64-%%%', publicKey), false);
  assert.equal(verificarFirmaSendgrid(enc(cuerpo), ts, firma, 'llave-invalida'), false);
});

Deno.test('SendGrid: cada evento se normaliza al vocabulario de la pantalla', () => {
  const tipo = (e: Record<string, unknown>) => tipoDeEventoSendgrid(e);
  assert.equal(tipo({ event: 'delivered' }), 'delivered');
  assert.equal(tipo({ event: 'processed' }), 'processed');
  assert.equal(tipo({ event: 'open' }), 'email_open');
  assert.equal(tipo({ event: 'click' }), 'email_link_click');
  assert.equal(tipo({ event: 'spamreport' }), 'feedback_loop');
  assert.equal(tipo({ event: 'dropped' }), 'dropped');
  assert.equal(tipo({ event: 'deferred' }), 'deferred');
  assert.equal(tipo({ event: 'unsubscribe' }), 'unsubscribe');
  assert.equal(tipo({ event: 'group_unsubscribe' }), 'unsubscribe');
  assert.equal(tipo({ event: 'group_resubscribe' }), 'resubscribe');
  assert.equal(tipo({ event: 'bounce', type: 'bounce' }), 'hardbounce', 'bounce permanente');
  assert.equal(tipo({ event: 'bounce', type: 'blocked' }), 'softbounce', 'blocked = temporal');
  assert.equal(tipo({ event: 'bounce' }), 'hardbounce', 'sin type se asume permanente: lo peor manda');
  assert.equal(tipo({ event: 'algo_nuevo' }), 'desconocido');
});

Deno.test('SendGrid: filas con referencia, id de envio, destinatario y sin datos del destinatario', () => {
  const cuerpo = [
    {
      event: 'open', email: 'Viajero@Correo.COM', timestamp: 1761150000, sg_event_id: 'ev-1',
      sg_message_id: 'AbC123xyz.recvd-5f7d9b8c6-abcde-1-6540A1B2-0', referencia: REFERENCIA,
      ip: '203.0.113.9', useragent: 'Mozilla/5.0', sg_machine_open: false,
    },
    {
      event: 'click', email: 'a@b.com', sg_event_id: 'ev-2', sg_message_id: 'AbC123xyz.recvd-x',
      url: 'https://app.toursred.com/reset?token=SECRETO', url_offset: { index: 0 }, referencia: REFERENCIA,
    },
    { event: 'bounce', type: 'blocked', email: 'c@d.com', sg_event_id: 'ev-3', sg_message_id: 'Zzz.filter0', reason: '550 5.1.1 no existe', status: '5.1.1', bounce_classification: 'Invalid Address', referencia: 'no-es-uuid' },
    'basura', null, 42,
  ];
  const filas = filasDeWebhookSendgrid(cuerpo);
  assert.equal(filas.length, 3, 'lo que no es un evento se ignora');

  const [apertura, clic, rebote] = filas;
  assert.equal(apertura.proveedor, 'sendgrid');
  assert.equal(apertura.tipo, 'email_open');
  assert.equal(apertura.referencia, REFERENCIA);
  assert.equal(apertura.id_proveedor, 'AbC123xyz', 'el id del envio es la parte antes del primer punto');
  assert.equal(apertura.destinatario, 'viajero@correo.com');
  assert.equal(apertura.id_evento, 'ev-1');

  // PRIVACIDAD: ni IP, ni navegador, ni la URL (puede llevar un token) llegan a lo que se guarda.
  for (const fila of filas) {
    const guardado = JSON.stringify(fila);
    assert.ok(!guardado.includes('203.0.113.9'), 'IP');
    assert.ok(!guardado.includes('Mozilla'), 'navegador');
    assert.ok(!guardado.includes('SECRETO'), 'URL del clic');
  }
  assert.equal(clic.tipo, 'email_link_click');

  assert.equal(rebote.tipo, 'softbounce');
  assert.equal(rebote.referencia, null, 'una referencia mal formada no se cruza');
  assert.ok(rebote.detalle?.includes('5.1.1') && rebote.detalle.includes('Invalid Address'));
  assert.ok((rebote.detalle?.length ?? 0) <= 500);
});

Deno.test('SendGrid: un objeto suelto o un cuerpo raro no truena', () => {
  assert.equal(filasDeWebhookSendgrid({ event: 'delivered', email: 'a@b.com' }).length, 1);
  assert.deepEqual(filasDeWebhookSendgrid(null), []);
  assert.deepEqual(filasDeWebhookSendgrid('x'), []);
  assert.deepEqual(filasDeWebhookSendgrid([]), []);
});

Deno.test('SMTP2GO: cada evento se normaliza y el rebote distingue duro de suave', () => {
  const tipo = (e: Record<string, unknown>) => tipoDeEventoSmtp2go(e);
  assert.equal(tipo({ event: 'delivered' }), 'delivered');
  assert.equal(tipo({ event: 'processed' }), 'processed');
  assert.equal(tipo({ event: 'open' }), 'email_open');
  assert.equal(tipo({ event: 'click' }), 'email_link_click');
  assert.equal(tipo({ event: 'spam' }), 'feedback_loop');
  assert.equal(tipo({ event: 'reject' }), 'dropped');
  assert.equal(tipo({ event: 'unsubscribe' }), 'unsubscribe');
  assert.equal(tipo({ event: 'resubscribe' }), 'resubscribe');
  assert.equal(tipo({ event: 'bounce', bounce: 'hard' }), 'hardbounce');
  assert.equal(tipo({ event: 'bounce', bounce: 'soft' }), 'softbounce');
  assert.equal(tipo({ event: 'BOUNCE', bounce: 'SOFT' }), 'softbounce', 'sin importar mayusculas');
  assert.equal(tipo({ event: 'bounce' }), 'hardbounce', 'sin dato se asume permanente');
  assert.equal(tipo({ event: 'algo_nuevo' }), 'desconocido');
});

Deno.test('SMTP2GO: filas con email_id, destinatario y sin datos del destinatario; los eventos de SMS se ignoran', () => {
  const cuerpo = {
    event: 'open', email_id: '1aBcD2-eFgHiJ-3k', rcpt: 'Viajero@Correo.com', time: '2026-10-22T16:00:00Z', sendtime: '2026-10-22T15:59:00Z',
    'user-agent': 'Mozilla/5.0', 'geoip-city': 'CDMX', client: 'Gmail', 'client-os': 'Android', srchost: '198.51.100.7', id: 'wh-1',
  };
  const [fila] = filasDeWebhookSmtp2go(cuerpo);
  assert.equal(fila.proveedor, 'smtp2go');
  assert.equal(fila.tipo, 'email_open');
  assert.equal(fila.id_proveedor, '1aBcD2-eFgHiJ-3k');
  assert.equal(fila.destinatario, 'viajero@correo.com');
  assert.equal(fila.referencia, null, 'SMTP2GO no devuelve referencia: la resuelve el receptor por email_id');
  assert.equal(fila.id_evento, 'open:1aBcD2-eFgHiJ-3k:viajero@correo.com:2026-10-22T16:00:00Z');
  const guardado = JSON.stringify(fila);
  for (const dato of ['Mozilla', 'CDMX', 'Gmail', 'Android', '198.51.100.7']) assert.ok(!guardado.includes(dato), dato);

  // `id` ("unique ID for the webhook") NO se usa para deduplicar: dos aperturas a horas distintas son dos eventos.
  const dos = filasDeWebhookSmtp2go([
    { event: 'open', email_id: 'E1', rcpt: 'a@b.com', time: 't1', id: 'wh-1' },
    { event: 'open', email_id: 'E1', rcpt: 'a@b.com', time: 't2', id: 'wh-1' },
  ]);
  assert.notEqual(dos[0].id_evento, dos[1].id_evento);

  const rebote = filasDeWebhookSmtp2go({ event: 'bounce', bounce: 'soft', email_id: 'E2', rcpt: 'c@d.com', message: '452 buzon lleno', context: 'host mx.d.com', time: 't' })[0];
  assert.equal(rebote.tipo, 'softbounce');
  assert.ok(rebote.detalle?.includes('buzon lleno'));

  // SMS u otros: sin `event` o no objeto -> ignorado.
  assert.deepEqual(filasDeWebhookSmtp2go({ sms_event: 'sms_delivered', message_id: 'x' }), []);
  assert.deepEqual(filasDeWebhookSmtp2go(null), []);
  assert.equal(filasDeWebhookSmtp2go([{ event: 'delivered', email_id: 'E3' }, 'x']).length, 1);
});

Deno.test('SMTP2GO: el Bearer se compara contra el secreto y sin secreto nunca autoriza', () => {
  assert.equal(autorizadoPorToken('Bearer abc123', 'abc123'), true);
  assert.equal(autorizadoPorToken('Bearer otro', 'abc123'), false);
  assert.equal(autorizadoPorToken('abc123', 'abc123'), false, 'sin el esquema Bearer');
  assert.equal(autorizadoPorToken(null, 'abc123'), false);
  assert.equal(autorizadoPorToken('Bearer abc123', undefined), false);
  assert.equal(autorizadoPorToken('Bearer abc123', ''), false);
});
