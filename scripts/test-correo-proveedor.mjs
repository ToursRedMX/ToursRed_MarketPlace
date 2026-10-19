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

const { separarRemitente, enviarPorSendgrid, enviarPorSmtp2go } = await import('../supabase/functions/_shared/correo/proveedores.ts');
const { enviarCorreo, leerAjustesCorreo, limpiarCacheAjustesCorreo } = await import('../supabase/functions/_shared/correo/enviarCorreo.ts');

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
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status });
  };
}
const OK_SMTP2GO = { status: 200, cuerpo: { data: { succeeded: 1, failed: 0 } } };
const OK_SENDGRID = { status: 202 };

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
    assert.deepEqual(await enviarPorSmtp2go('k', correo, 's@x.com'), { ok: false, clase: 'rechazo_confirmado', codigo: 'smtp2go_rechazo' });
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
});

await prueba('enviarCorreo: remitente por defecto, el de la funcion y el de la base', async () => {
  simular(OK_SMTP2GO);
  await enviarCorreo({}, correo, ajustes({ contact_email: null }));
  assert.equal(llamadas[0].cuerpo.sender, 'contacto@toursred.com');
  simular(OK_SMTP2GO);
  await enviarCorreo({}, { ...correo, remitente: 'soporte@toursred.com.mx' }, ajustes());
  assert.equal(llamadas[0].cuerpo.sender, 'soporte@toursred.com.mx');
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

await prueba('contrato del codigo fuente: la migracion y el modulo comparten proveedores y la llave de SendGrid es un secreto', () => {
  const tipos = readFileSync('supabase/functions/_shared/correo/tipos.ts', 'utf8');
  const sql = readFileSync('supabase/migrations/20261019214718_email_settings_proveedor_configurable.sql', 'utf8');
  assert.match(tipos, /"smtp2go" \| "sendgrid"/);
  assert.match(sql, /IN \('smtp2go', 'sendgrid'\)/);
  assert.match(sql, /DEFAULT 'smtp2go'/);
  assert.match(sql, /email_fallback_enabled boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /sendgrid_api_key/, 'la llave de SendGrid no se guarda en la base');
  const ui = readFileSync('src/pages/admin/AdminSettings.tsx', 'utf8');
  assert.match(ui, /email_provider: settings\.email_provider/);
  assert.match(ui, /PROVEEDORES_CORREO/);
});

console.log(`OK: ${casos} casos del proveedor de correo.`);
