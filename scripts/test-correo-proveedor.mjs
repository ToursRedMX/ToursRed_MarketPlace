#!/usr/bin/env node
// Proveedor de correo configurable (19-oct-2026): SMTP2GO o SendGrid (Twilio), con respaldo.
//
// EJECUTA los adaptadores y el enrutador de supabase/functions/_shared/correo con `fetch` simulado:
// el formato que recibe cada proveedor, como se clasifica cada respuesta y cuando se usa el respaldo.
// Lo que NO prueba: que SendGrid/SMTP2GO acepten el correo de verdad (eso es un envio real).
//
//   node scripts/test-correo-proveedor.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const env = {};
globalThis.Deno = { env: { get: (k) => env[k] } };

const { separarRemitente, enviarPorSendgrid, enviarPorSmtp2go, enviarPorZoho } = await import('../supabase/functions/_shared/correo/proveedores.ts');
const { enviarCorreo, leerAjustesCorreo, limpiarCacheAjustesCorreo } = await import('../supabase/functions/_shared/correo/enviarCorreo.ts');
const { htmlATexto } = await import('../supabase/functions/_shared/correo/textoPlano.ts');

let casos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};

// fetch simulado: cada llamada consume la siguiente respuesta; guarda lo que se envio.
let llamadas = [];
function simular(...respuestas) {
  llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), init, cuerpo: JSON.parse(init.body) });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status, headers: r.headers });
  };
}
const OK_SMTP2GO = { status: 200, cuerpo: { data: { succeeded: 1, failed: 0 } } };
const OK_SENDGRID = { status: 202 };
const OK_ZOHO = { status: 200, cuerpo: { data: [{ code: 'EM_104' }], message: 'OK' } };

const correo = { para: 'viajero@ejemplo.com', asunto: 'Hola', html: '<p>codigo 123456</p>' };
const ajustes = (extra = {}) => ({
  contact_email: 'contacto@toursred.com', smtp_api_key: 'llave-smtp2go',
  email_provider: 'smtp2go', email_fallback_provider: null, email_fallback_enabled: false, ...extra,
});
const clienteConAjustes = (data, error = null) => ({
  from: () => ({ select: () => ({ maybeSingle: async () => ({ data, error }) }) }),
});

await prueba('separarRemitente entiende "Nombre <correo>" y correo solo', () => {
  assert.deepEqual(separarRemitente('ToursRed <noreply@toursred.com>'), { email: 'noreply@toursred.com', name: 'ToursRed' });
  assert.deepEqual(separarRemitente('"Tours, Red" <a@b.com>'), { email: 'a@b.com', name: 'Tours, Red' });
  assert.deepEqual(separarRemitente('soporte@toursred.com'), { email: 'soporte@toursred.com' });
  assert.deepEqual(separarRemitente('<a@b.com>'), { email: 'a@b.com' });
});

await prueba('SMTP2GO: llave en el header, payload y adjuntos', async () => {
  simular(OK_SMTP2GO);
  const r = await enviarPorSmtp2go('k', { ...correo, para: ['a@x.com', 'b@x.com'], texto: 't', responderA: 'r@x.com',
    adjuntos: [{ nombre: 'f.pdf', contenidoBase64: 'QQ==', mimetype: 'application/pdf' }] }, 'contacto@toursred.com');
  assert.equal(r.ok, true);
  const [l] = llamadas;
  assert.equal(l.url, 'https://api.smtp2go.com/v3/email/send');
  assert.equal(l.init.headers['X-Smtp2go-Api-Key'], 'k');
  assert.deepEqual(l.cuerpo.to, ['a@x.com', 'b@x.com']);
  assert.equal(l.cuerpo.sender, 'contacto@toursred.com');
  assert.equal(l.cuerpo.html_body, correo.html);
  assert.equal(l.cuerpo.text_body, 't');
  assert.deepEqual(l.cuerpo.attachments, [{ filename: 'f.pdf', fileblob: 'QQ==', mimetype: 'application/pdf' }]);
  assert.deepEqual(l.cuerpo.custom_headers, [{ header: 'Reply-To', value: 'r@x.com' }]);
  assert.equal('api_key' in l.cuerpo, false, 'la llave no viaja en el body');
});

await prueba('SMTP2GO: 200 con data.error / failed / succeeded 0 es rechazo; 4xx rechazo; 5xx no disponible; red incierto', async () => {
  for (const cuerpo of [{ data: { error: 'x' } }, { data: { failed: 1, succeeded: 0 } }, { data: { succeeded: 0 } }]) {
    simular({ status: 200, cuerpo });
    assert.deepEqual(await enviarPorSmtp2go('k', correo, 's@x.com'), { ok: false, clase: 'rechazo_confirmado', codigo: 'smtp2go_rechazo', httpStatus: 200 });
  }
  simular({ status: 400, cuerpo: {} });
  assert.equal((await enviarPorSmtp2go('k', correo, 's@x.com')).clase, 'rechazo_confirmado');
  simular({ status: 503, cuerpo: {} });
  assert.equal((await enviarPorSmtp2go('k', correo, 's@x.com')).clase, 'no_disponible');
  simular(new Error('timeout'));
  assert.equal((await enviarPorSmtp2go('k', correo, 's@x.com')).clase, 'incierto');
  assert.equal((await enviarPorSmtp2go(null, correo, 's@x.com')).clase, 'no_configurado');
});

await prueba('SendGrid: Bearer, personalizations, content y adjuntos; 202 es exito', async () => {
  simular(OK_SENDGRID);
  const r = await enviarPorSendgrid('SG.k', { ...correo, para: ['a@x.com', 'b@x.com'], texto: 't', responderA: 'Soporte <r@x.com>',
    adjuntos: [{ nombre: 'f.xml', contenidoBase64: 'QQ==', mimetype: 'application/xml' }] }, 'ToursRed <noreply@toursred.com>');
  assert.equal(r.ok, true);
  const [l] = llamadas;
  assert.equal(l.url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(l.init.headers.Authorization, 'Bearer SG.k');
  assert.deepEqual(l.cuerpo.personalizations, [{ to: [{ email: 'a@x.com' }, { email: 'b@x.com' }] }]);
  simular(OK_SENDGRID);
  await enviarPorSendgrid('SG.k', { ...correo, para: 'Ana Perez <ana@x.com>' }, 's@x.com');
  assert.deepEqual(llamadas[0].cuerpo.personalizations, [{ to: [{ email: 'ana@x.com', name: 'Ana Perez' }] }], 'destinatario con nombre');
  simular(OK_SENDGRID);
  await enviarPorSendgrid('SG.k', { ...correo, adjuntos: [{ nombre: 'qr.png', contenidoBase64: 'QQ==', mimetype: 'image/png', enLinea: true }] }, 's@x.com');
  assert.deepEqual(llamadas[0].cuerpo.attachments, [{ content: 'QQ==', filename: 'qr.png', type: 'image/png', disposition: 'inline', content_id: 'qr.png' }]);
  simular(OK_SMTP2GO);
  await enviarPorSmtp2go('k', { ...correo, adjuntos: [{ nombre: 'qr.png', contenidoBase64: 'QQ==', mimetype: 'image/png', enLinea: true }] }, 's@x.com');
  assert.deepEqual(llamadas[0].cuerpo.inlines, [{ filename: 'qr.png', fileblob: 'QQ==', mimetype: 'image/png' }]);
  assert.equal('attachments' in llamadas[0].cuerpo, false);
  simular(OK_SENDGRID);
  await enviarPorSendgrid('SG.k', { ...correo, para: ['a@x.com', 'b@x.com'], texto: 't', responderA: 'Soporte <r@x.com>', adjuntos: [{ nombre: 'f.xml', contenidoBase64: 'QQ==', mimetype: 'application/xml' }] }, 'ToursRed <noreply@toursred.com>');
  assert.deepEqual(l.cuerpo.from, { email: 'noreply@toursred.com', name: 'ToursRed' });
  assert.deepEqual(l.cuerpo.content, [{ type: 'text/plain', value: 't' }, { type: 'text/html', value: correo.html }]);
  assert.deepEqual(l.cuerpo.reply_to, { email: 'r@x.com', name: 'Soporte' });
  assert.deepEqual(l.cuerpo.attachments, [{ content: 'QQ==', filename: 'f.xml', type: 'application/xml', disposition: 'attachment' }]);
});

await prueba('SendGrid: solo HTML cuando no hay texto; 4xx rechazo, 429/5xx no disponible, red incierto, sin llave', async () => {
  simular(OK_SENDGRID);
  await enviarPorSendgrid('k', correo, 's@x.com');
  assert.deepEqual(llamadas[0].cuerpo.content, [{ type: 'text/html', value: correo.html }]);
  assert.equal('attachments' in llamadas[0].cuerpo, false);
  for (const [status, clase] of [[400, 'rechazo_confirmado'], [401, 'rechazo_confirmado'], [403, 'rechazo_confirmado'], [429, 'no_disponible'], [500, 'no_disponible']]) {
    simular({ status, cuerpo: { errors: [] } });
    const r = await enviarPorSendgrid('k', correo, 's@x.com');
    assert.equal(r.clase, clase, `HTTP ${status}`);
    assert.equal(r.codigo, `sendgrid_http_${status}`);
  }
  // 200 NO es exito en SendGrid: el exito es 202.
  simular({ status: 200 });
  assert.equal((await enviarPorSendgrid('k', correo, 's@x.com')).ok, false);
  simular(new Error('red'));
  assert.equal((await enviarPorSendgrid('k', correo, 's@x.com')).clase, 'incierto');
  assert.equal((await enviarPorSendgrid('', correo, 's@x.com')).clase, 'no_configurado');
});

await prueba('Zoho: Authorization con prefijo, payload, adjuntos e imagen en linea', async () => {
  simular(OK_ZOHO, OK_ZOHO);
  const r = await enviarPorZoho('abc123', { ...correo, para: ['a@x.com', 'Ana Perez <ana@x.com>'], texto: 't', responderA: 'Soporte <r@x.com>',
    adjuntos: [{ nombre: 'f.pdf', contenidoBase64: 'QQ==', mimetype: 'application/pdf' }, { nombre: 'qr.png', contenidoBase64: 'Qg==', mimetype: 'image/png', enLinea: true }] },
  'ToursRed <noreply@toursred.com>');
  assert.equal(r.ok, true);
  const [l] = llamadas;
  assert.equal(l.url, 'https://cpaas.zoho.com/v1.1/email');
  assert.equal(l.init.headers.Authorization, 'Zoho-enczapikey abc123', 'agrega el prefijo si el secreto no lo trae');
  assert.deepEqual(l.cuerpo.from, { address: 'noreply@toursred.com', name: 'ToursRed' });
  assert.deepEqual(l.cuerpo.to, [{ email_address: { address: 'a@x.com' } }, { email_address: { address: 'ana@x.com', name: 'Ana Perez' } }]);
  assert.equal(l.cuerpo.subject, correo.asunto);
  assert.equal(l.cuerpo.htmlbody, correo.html);
  assert.equal(l.cuerpo.textbody, 't');
  assert.deepEqual(l.cuerpo.reply_to, [{ address: 'r@x.com', name: 'Soporte' }]);
  assert.deepEqual(l.cuerpo.attachments, [{ name: 'f.pdf', mime_type: 'application/pdf', content: 'QQ==' }]);
  assert.deepEqual(l.cuerpo.inline_images, [{ name: 'qr.png', mime_type: 'image/png', content: 'Qg==', cid: 'qr.png' }]);
  await enviarPorZoho('Zoho-enczapikey yaprefijo', correo, 's@x.com');
  assert.equal(llamadas[1].init.headers.Authorization, 'Zoho-enczapikey yaprefijo', 'no duplica el prefijo');
  assert.equal('attachments' in llamadas[1].cuerpo || 'inline_images' in llamadas[1].cuerpo || 'reply_to' in llamadas[1].cuerpo, false);
});

await prueba('Zoho: 200 es exito; 4xx rechazo; 429/5xx no disponible; red incierto; sin llave', async () => {
  for (const [status, clase] of [[400, 'rechazo_confirmado'], [401, 'rechazo_confirmado'], [429, 'no_disponible'], [500, 'no_disponible']]) {
    simular({ status, cuerpo: { data: { error_code: 'X' } } });
    const r = await enviarPorZoho('k', correo, 's@x.com');
    assert.equal(r.clase, clase, `HTTP ${status}`);
    assert.equal(r.codigo, `zoho_http_${status}`);
  }
  // cualquier 2xx es exito: con un 201 un correo ya entregado se reenviaba por el respaldo (llegaba doble)
  for (const status of [200, 201, 202, 204]) {
    simular({ status, cuerpo: status === 204 ? undefined : { data: [{ code: 'EM_104' }], message: 'OK' } });
    assert.equal((await enviarPorZoho('k', correo, 's@x.com')).ok, true, `HTTP ${status}`);
  }
  for (const status of [301, 302]) {
    simular({ status });
    assert.equal((await enviarPorZoho('k', correo, 's@x.com')).ok, false, `HTTP ${status} no es exito`);
  }
  simular(new Error('red'));
  assert.equal((await enviarPorZoho('k', correo, 's@x.com')).clase, 'incierto');
  assert.equal((await enviarPorZoho('', correo, 's@x.com')).clase, 'no_configurado');
});

await prueba('enviarCorreo: usa el principal configurado y no toca el otro', async () => {
  env.SENDGRID_API_KEY = 'SG.env';
  simular(OK_SENDGRID);
  const r = await enviarCorreo({}, correo, ajustes({ email_provider: 'sendgrid' }));
  assert.deepEqual(r, { ok: true, proveedor: 'sendgrid', respaldo: false });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer SG.env');
  simular(OK_SMTP2GO);
  assert.deepEqual(await enviarCorreo({}, correo, ajustes()), { ok: true, proveedor: 'smtp2go', respaldo: false });
  assert.match(llamadas[0].url, /smtp2go/);
  env.ZOHO_EMAIL_API_KEY = 'zk';
  simular(OK_ZOHO);
  assert.deepEqual(await enviarCorreo({}, correo, ajustes({ email_provider: 'zoho' })), { ok: true, proveedor: 'zoho', respaldo: false });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].init.headers.Authorization, 'Zoho-enczapikey zk');
  // Zoho como respaldo de SendGrid y SendGrid como respaldo de Zoho
  simular({ status: 403 }, OK_ZOHO);
  assert.deepEqual(await enviarCorreo({}, correo, ajustes({ email_provider: 'sendgrid', email_fallback_provider: 'zoho', email_fallback_enabled: true })),
    { ok: true, proveedor: 'zoho', respaldo: true });
  simular({ status: 400, cuerpo: {} }, OK_SENDGRID);
  assert.deepEqual(await enviarCorreo({}, correo, ajustes({ email_provider: 'zoho', email_fallback_provider: 'sendgrid', email_fallback_enabled: true })),
    { ok: true, proveedor: 'sendgrid', respaldo: true });
  delete env.ZOHO_EMAIL_API_KEY;
  simular(OK_SMTP2GO);
  const sinLlave = await enviarCorreo({}, correo, ajustes({ email_provider: 'zoho', email_fallback_provider: 'smtp2go', email_fallback_enabled: true }));
  assert.deepEqual(sinLlave, { ok: true, proveedor: 'smtp2go', respaldo: true }, 'sin secreto de Zoho pasa al respaldo');
  assert.equal(llamadas.length, 1);
});

await prueba('enviarCorreo: si Zoho acepta con 201 NO se manda otra copia por el respaldo (el doble envio del 19-oct)', async () => {
  const zohoConSendgrid = ajustes({ email_provider: 'zoho', email_fallback_provider: 'sendgrid', email_fallback_enabled: true });
  env.ZOHO_EMAIL_API_KEY = 'zk';
  env.SENDGRID_API_KEY = 'SG.env';
  for (const status of [200, 201, 202]) {
    simular({ status, cuerpo: { data: [{ code: 'EM_104' }], message: 'OK' } }, OK_SENDGRID);
    assert.deepEqual(await enviarCorreo({}, correo, zohoConSendgrid), { ok: true, proveedor: 'zoho', respaldo: false }, `HTTP ${status}`);
    assert.equal(llamadas.length, 1, `HTTP ${status}: un solo envio, sin copia por SendGrid`);
    assert.match(llamadas[0].url, /zoho/);
  }
});

await prueba('enviarCorreo: remitente por defecto, el de la funcion y el de la base', async () => {
  simular(OK_SMTP2GO);
  await enviarCorreo({}, correo, ajustes({ contact_email: null }));
  assert.equal(llamadas[0].cuerpo.sender, 'ToursRed <contacto@toursred.com>');
  simular(OK_SMTP2GO);
  await enviarCorreo({}, { ...correo, remitente: 'soporte@toursred.com.mx' }, ajustes());
  assert.equal(llamadas[0].cuerpo.sender, 'ToursRed <soporte@toursred.com.mx>');
  simular(OK_SMTP2GO);
  await enviarCorreo({}, { ...correo, remitente: 'Soporte ToursRed <soporte@toursred.com>' }, ajustes());
  assert.equal(llamadas[0].cuerpo.sender, 'Soporte ToursRed <soporte@toursred.com>', 'un nombre que la funcion ya puso se respeta');
});

// NOT-02 (28-oct-2026): los correos salian solo-HTML y con el remitente a secas, y los de cancelacion cayeron en
// cuarentena de Defender. Ahora todo correo lleva texto plano y nombre visible, en los tres proveedores.
await prueba('enviarCorreo: agrega texto plano cuando falta y respeta el que mandan', async () => {
  const conHtml = { ...correo, html: '<style>p{color:red}</style><h1>Reserva &amp; pago</h1><p>Hola <b>Ana</b>,<br>tu codigo es 123456.</p><p><a href="https://toursred.com/x">Ver reserva</a></p>' };
  simular(OK_SMTP2GO);
  await enviarCorreo({}, conHtml, ajustes());
  const t = llamadas[0].cuerpo.text_body;
  assert.match(t, /Reserva & pago/, 'decodifica entidades');
  assert.match(t, /Hola Ana,\ntu codigo es 123456\./, 'conserva los saltos de linea');
  assert.match(t, /Ver reserva \(https:\/\/toursred\.com\/x\)/, 'conserva el destino del enlace');
  assert.doesNotMatch(t, /color:red|<|>/, 'sin CSS ni etiquetas');
  assert.equal(htmlATexto('<p>a&nbsp;&nbsp;b  c aa 00</p><p>d</p>'), 'a b c aa 00\nd', 'junta espacios (incluidos los duros) sin tocar el resto');
  simular(OK_SMTP2GO);
  await enviarCorreo({}, { ...conHtml, texto: 'mi texto' }, ajustes());
  assert.equal(llamadas[0].cuerpo.text_body, 'mi texto', 'el texto de la funcion no se pisa');
  // Los tres proveedores lo reciben
  env.SENDGRID_API_KEY = 'SG.env'; env.ZOHO_EMAIL_API_KEY = 'zk';
  simular(OK_SENDGRID);
  await enviarCorreo({}, conHtml, ajustes({ email_provider: 'sendgrid' }));
  assert.equal(llamadas[0].cuerpo.content[0].type, 'text/plain', 'SendGrid: text/plain primero');
  assert.deepEqual(llamadas[0].cuerpo.from, { email: 'contacto@toursred.com', name: 'ToursRed' });
  simular(OK_ZOHO);
  await enviarCorreo({}, conHtml, ajustes({ email_provider: 'zoho' }));
  assert.match(llamadas[0].cuerpo.textbody, /tu codigo es 123456/, 'Zoho: textbody');
  assert.deepEqual(llamadas[0].cuerpo.from, { address: 'contacto@toursred.com', name: 'ToursRed' });
});

await prueba('enviarCorreo: respaldo solo si el principal NO lo acepto con certeza', async () => {
  const conRespaldo = ajustes({ email_provider: 'sendgrid', email_fallback_provider: 'smtp2go', email_fallback_enabled: true });
  env.SENDGRID_API_KEY = 'SG.env';
  // rechazo 4xx -> respaldo
  simular({ status: 403, cuerpo: {} }, OK_SMTP2GO);
  assert.deepEqual(await enviarCorreo({}, correo, conRespaldo), { ok: true, proveedor: 'smtp2go', respaldo: true });
  assert.equal(llamadas.length, 2);
  // 5xx -> respaldo
  simular({ status: 502 }, OK_SMTP2GO);
  assert.equal((await enviarCorreo({}, correo, conRespaldo)).respaldo, true);
  // sin llave del principal -> respaldo
  delete env.SENDGRID_API_KEY;
  simular(OK_SMTP2GO);
  const r = await enviarCorreo({}, correo, conRespaldo);
  assert.deepEqual(r, { ok: true, proveedor: 'smtp2go', respaldo: true });
  assert.equal(llamadas.length, 1, 'sin llave ni se intenta el principal');
  env.SENDGRID_API_KEY = 'SG.env';
  // timeout/red: pudo salir -> NO se reintenta (duplicaria el correo)
  simular(new Error('timeout'), OK_SMTP2GO);
  const t = await enviarCorreo({}, correo, conRespaldo);
  assert.equal(t.ok, false);
  assert.equal(t.clase, 'incierto');
  assert.equal(llamadas.length, 1);
  // respaldo apagado -> no se usa aunque haya proveedor elegido
  simular({ status: 403 }, OK_SMTP2GO);
  assert.equal((await enviarCorreo({}, correo, { ...conRespaldo, email_fallback_enabled: false })).ok, false);
  assert.equal(llamadas.length, 1);
  // respaldo == principal -> no hay segundo intento
  simular({ status: 403 }, OK_SMTP2GO);
  assert.equal((await enviarCorreo({}, correo, { ...conRespaldo, email_fallback_provider: 'sendgrid' })).ok, false);
  assert.equal(llamadas.length, 1);
  // los dos fallan -> reporta el fallo del respaldo
  simular({ status: 403 }, { status: 400, cuerpo: {} });
  const dos = await enviarCorreo({}, correo, conRespaldo);
  assert.deepEqual(dos, { ok: false, proveedor: 'smtp2go', clase: 'rechazo_confirmado', codigo: 'smtp2go_http_400', respaldo: true });
});

await prueba('leerAjustesCorreo: valor desconocido cae a smtp2go; error o sin fila dan null', async () => {
  limpiarCacheAjustesCorreo();
  const fila = { smtp_api_key: 'k', contact_email: 'c@x.com', email_provider: 'mailgun', email_fallback_provider: 'otro', email_fallback_enabled: true };
  const conZoho = await leerAjustesCorreo(clienteConAjustes({ ...fila, email_provider: 'zoho', email_fallback_provider: 'sendgrid' }));
  assert.equal(conZoho.email_provider, 'zoho');
  assert.equal(conZoho.email_fallback_provider, 'sendgrid');
  limpiarCacheAjustesCorreo();
  assert.deepEqual(await leerAjustesCorreo(clienteConAjustes(fila)), {
    contact_email: 'c@x.com', smtp_api_key: 'k', email_provider: 'smtp2go', email_fallback_provider: null, email_fallback_enabled: true,
  });
  limpiarCacheAjustesCorreo();
  const antes = console.error; console.error = () => {};
  try { assert.equal(await leerAjustesCorreo(clienteConAjustes(null, { code: '42703' })), null); } finally { console.error = antes; }
  assert.equal(await leerAjustesCorreo(clienteConAjustes(null)), null);
  limpiarCacheAjustesCorreo();
  const sinFila = await enviarCorreo(clienteConAjustes(null), correo);
  assert.equal(sinFila.ok, false);
  assert.equal(sinFila.clase, 'no_configurado');
});

await prueba('leerAjustesCorreo: cachea la lectura 30 s y no cachea los fallos', async () => {
  limpiarCacheAjustesCorreo();
  let consultas = 0;
  const cliente = (data, error = null) => ({ from: () => ({ select: () => ({ maybeSingle: async () => { consultas++; return { data, error }; } }) }) });
  const fila = { smtp_api_key: 'k', contact_email: 'c@x.com', email_provider: 'sendgrid', email_fallback_provider: null, email_fallback_enabled: false };
  const antes = console.error; console.error = () => {};
  try {
    assert.equal(await leerAjustesCorreo(cliente(null, { code: 'X' })), null);
    assert.equal(await leerAjustesCorreo(cliente(null)), null);
    assert.equal(consultas, 2, 'un error o una fila ausente no se cachean');
  } finally { console.error = antes; }
  assert.equal((await leerAjustesCorreo(cliente(fila))).email_provider, 'sendgrid');
  assert.equal((await leerAjustesCorreo(cliente({ ...fila, email_provider: 'smtp2go' }))).email_provider, 'sendgrid', 'segunda lectura sale del cache');
  assert.equal(consultas, 3);
  limpiarCacheAjustesCorreo();
  assert.equal((await leerAjustesCorreo(cliente({ ...fila, email_provider: 'smtp2go' }))).email_provider, 'smtp2go');
});

await prueba('enviarCorreo no registra el cuerpo del correo ni las llaves', async () => {
  const logs = [];
  const antes = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    env.SENDGRID_API_KEY = 'SG.secreto';
    simular({ status: 403, cuerpo: {} }, { status: 400, cuerpo: {} });
    await enviarCorreo({}, correo, ajustes({ email_provider: 'sendgrid', email_fallback_provider: 'smtp2go', email_fallback_enabled: true, smtp_api_key: 'llave-secreta' }));
  } finally { console.error = antes; }
  assert.ok(logs.length > 0);
  for (const l of logs) assert.doesNotMatch(l, /123456|SG\.secreto|llave-secreta|viajero@ejemplo/, `registro con datos sensibles: ${l}`);
});

const clienteBitacora = (opciones = {}) => {
  const filas = [];
  return {
    filas,
    from: (tabla) => ({
      insert: async (fila) => {
        if (opciones.lanza) throw new Error('base caida');
        if (opciones.error) return { error: { code: 'XX000' } };
        filas.push({ tabla, ...fila });
        return { error: null };
      },
    }),
  };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

await prueba('bitacora: cada intento deja una fila con su referencia, el estado y los destinatarios, sin el cuerpo', async () => {
  const admin = clienteBitacora();
  env.ZOHO_EMAIL_API_KEY = 'zk';
  simular({ status: 201, cuerpo: { data: [{ code: 'EM_104' }], message: 'OK', request_id: 'req-1' } });
  const r = await enviarCorreo(admin, { para: ['Ana Perez <a@x.com>', 'b@x.com'], asunto: 'x'.repeat(300), html: '<p>codigo 123456</p>', texto: 'tambien 123456' },
    ajustes({ email_provider: 'zoho' }));
  assert.equal(r.ok, true);
  assert.equal(admin.filas.length, 1);
  const f = admin.filas[0];
  assert.equal(f.tabla, 'bitacora_envio_correo');
  assert.match(f.id, UUID);
  assert.match(f.envio_id, UUID);
  assert.equal(f.proveedor, 'zoho');
  assert.equal(f.es_respaldo, false);
  assert.equal(f.aceptado, true);
  assert.equal(f.clase, null);
  assert.equal(f.codigo, null);
  assert.equal(f.http_status, 201);
  assert.equal(f.id_proveedor, 'req-1');
  assert.deepEqual(f.destinatarios, ['a@x.com', 'b@x.com'], 'solo la direccion, sin el nombre');
  assert.equal(f.asunto.length, 200, 'el asunto se corta a 200');
  assert.doesNotMatch(JSON.stringify(f), /123456|<p>/, 'el cuerpo no se guarda');
  // la referencia que se guarda es la que viajo al proveedor: asi se cruza con sus eventos
  assert.equal(llamadas[0].cuerpo.client_reference, f.id);
});

await prueba('bitacora: el respaldo deja SU fila, del mismo envio, y la referencia llega a SendGrid', async () => {
  const admin = clienteBitacora();
  env.ZOHO_EMAIL_API_KEY = 'zk';
  env.SENDGRID_API_KEY = 'SG.env';
  simular({ status: 400, cuerpo: { data: { error_code: 'X' } } }, { status: 202, headers: { 'x-message-id': 'sg-msg-9' } });
  const r = await enviarCorreo(admin, correo, ajustes({ email_provider: 'zoho', email_fallback_provider: 'sendgrid', email_fallback_enabled: true }));
  assert.deepEqual(r, { ok: true, proveedor: 'sendgrid', respaldo: true });
  assert.equal(admin.filas.length, 2);
  const [p, b] = admin.filas;
  assert.equal(p.envio_id, b.envio_id, 'principal y respaldo comparten envio_id');
  assert.notEqual(p.id, b.id);
  assert.deepEqual([p.proveedor, p.es_respaldo, p.aceptado, p.clase, p.codigo, p.http_status], ['zoho', false, false, 'rechazo_confirmado', 'zoho_http_400', 400]);
  assert.deepEqual([b.proveedor, b.es_respaldo, b.aceptado, b.http_status, b.id_proveedor], ['sendgrid', true, true, 202, 'sg-msg-9']);
  assert.equal(llamadas[1].cuerpo.custom_args.referencia, b.id);
});

await prueba('bitacora: SMTP2GO guarda su email_id; un proveedor sin llave tambien deja su fila', async () => {
  const admin = clienteBitacora();
  simular({ status: 200, cuerpo: { data: { succeeded: 1, failed: 0, email_id: 'sm-77' } } });
  await enviarCorreo(admin, correo, ajustes());
  assert.equal(admin.filas[0].id_proveedor, 'sm-77');
  delete env.SENDGRID_API_KEY;
  const admin2 = clienteBitacora();
  simular();
  const r = await enviarCorreo(admin2, correo, ajustes({ email_provider: 'sendgrid' }));
  assert.equal(r.ok, false);
  assert.deepEqual([admin2.filas[0].aceptado, admin2.filas[0].clase, admin2.filas[0].codigo, admin2.filas[0].http_status], [false, 'no_configurado', 'sendgrid_sin_llave', null]);
  assert.equal(llamadas.length, 0);
});

await prueba('bitacora: si la bitacora falla, el correo sale igual y el registro no lleva datos personales', async () => {
  const logs = [];
  const antes = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    for (const opciones of [{ lanza: true }, { error: true }]) {
      simular(OK_SMTP2GO);
      const r = await enviarCorreo(clienteBitacora(opciones), { ...correo, para: 'secreto@ejemplo.com', asunto: 'asunto-privado' }, ajustes());
      assert.equal(r.ok, true, JSON.stringify(opciones));
      assert.equal(llamadas.length, 1);
    }
  } finally { console.error = antes; }
  assert.equal(logs.length, 2);
  for (const l of logs) assert.doesNotMatch(l, /secreto@ejemplo|asunto-privado|123456/, l);
});

await prueba('contrato del codigo fuente: la migracion y el modulo comparten proveedores y la llave de SendGrid es un secreto', () => {
  const tipos = readFileSync('supabase/functions/_shared/correo/tipos.ts', 'utf8');
  const sql = readFileSync('supabase/migrations/20261019214718_email_settings_proveedor_configurable.sql', 'utf8');
  assert.match(tipos, /"smtp2go" \| "sendgrid" \| "zoho"/);
  const sqlZoho = readFileSync('supabase/migrations/20261020053214_email_settings_agregar_zoho.sql', 'utf8');
  assert.match(sqlZoho, /email_provider IN \('smtp2go', 'sendgrid', 'zoho'\)/);
  assert.match(sqlZoho, /email_fallback_provider IN \('smtp2go', 'sendgrid', 'zoho'\)/);
  assert.doesNotMatch(sqlZoho, /zoho_api_key|ZOHO_EMAIL_API_KEY\s*=/i, 'la llave de Zoho no se guarda en la base');
  assert.match(sql, /IN \('smtp2go', 'sendgrid'\)/);
  assert.match(sql, /DEFAULT 'smtp2go'/);
  assert.match(sql, /email_fallback_enabled boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /sendgrid_api_key/, 'la llave de SendGrid no se guarda en la base');
  const ui = readFileSync('src/pages/admin/AdminSettings.tsx', 'utf8');
  assert.match(ui, /email_provider: settings\.email_provider/);
  assert.match(ui, /PROVEEDORES_CORREO/);
  assert.match(ui, /valor: 'zoho'/);
});

console.log(`OK: ${casos} casos del proveedor de correo.`);
