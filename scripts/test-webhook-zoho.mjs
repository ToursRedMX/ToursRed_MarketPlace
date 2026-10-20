#!/usr/bin/env node
// Bitacora de correo y webhook de Zoho (19-oct-2026).
//
// Con Zoho principal y SendGrid de respaldo los correos llegaron dos veces y no habia forma de saber, desde la
// base, por que proveedor salio cada uno. Esto prueba la mitad que recibe lo que Zoho cuenta DESPUES de aceptar un
// correo (rebotes, aperturas, clics): el analisis del cuerpo, la autorizacion y los contratos de la funcion y de la
// migracion. La mitad que registra cada envio esta en test-correo-proveedor.mjs.
//
// No prueba contra Zoho ni contra la base.
//
//   node scripts/test-webhook-zoho.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../supabase/functions/_shared/correo/webhookZoho.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));

const REF = '3f2b1c0e-9d7a-4c55-8f31-0a1b2c3d4e5f';
const mensaje = (extra = {}, tipo = 'hardbounce', detalles = [{ reason: 'Mailbox does not exist', bounced_recipient: 'x@y.com', diagnostic_message: '550 5.1.1 no such user', time: 't' }]) => ({
  event_name: [tipo],
  event_message: [{
    email_info: {
      to: [{ email_address: { address: 'Ana@Ejemplo.com', name: 'Ana' } }],
      subject: 'secreto-en-el-asunto', client_reference: REF, email_reference: 'ref-zoho-1', object: 'email', ...extra,
    },
    event_data: [{ details: detalles, object: tipo }],
    request_id: 'req-9',
  }],
  mailagent_key: 'k',
  webhook_request_id: 'w-1',
});

prueba('un rebote duro: tipo, referencia, id del proveedor, destinatario y motivo', () => {
  const [f] = m.filasDeWebhookZoho(mensaje());
  assert.equal(f.proveedor, 'zoho');
  assert.equal(f.tipo, 'hardbounce');
  assert.equal(f.referencia, REF);
  assert.equal(f.id_proveedor, 'ref-zoho-1');
  assert.equal(f.destinatario, 'ana@ejemplo.com');
  assert.equal(f.detalle, 'Mailbox does not exist | 550 5.1.1 no such user');
});

prueba('una apertura NO guarda IP, ubicacion ni navegador', () => {
  const detalle = { email_client: { name: 'Outlook' }, ip_location_info: { ip_address: '189.1.2.3', city: 'CDMX', latitude: 1 }, user_agent: 'Mozilla/5.0', time: 't' };
  const [f] = m.filasDeWebhookZoho(mensaje({}, 'email_open', [detalle]));
  assert.equal(f.tipo, 'email_open');
  const texto = JSON.stringify(f);
  assert.doesNotMatch(texto, /189\.1\.2\.3|CDMX|Mozilla|ip_location_info|user_agent/);
  assert.match(texto, /Outlook/, 'lo demas del evento se conserva');
});

prueba('una referencia que no es un uuid se descarta (no rompe el INSERT)', () => {
  assert.equal(m.filasDeWebhookZoho(mensaje({ client_reference: 'no-es-uuid' }))[0].referencia, null);
  assert.equal(m.filasDeWebhookZoho(mensaje({ client_reference: REF.toUpperCase() }))[0].referencia, REF);
  assert.equal(m.filasDeWebhookZoho(mensaje({ client_reference: undefined }))[0].referencia, null);
});

prueba('varios mensajes en un webhook generan varias filas; lo irreconocible se conserva o se ignora sin lanzar', () => {
  const dos = mensaje();
  dos.event_message.push({ email_info: { client_reference: REF }, request_id: 'req-10' });
  assert.equal(m.filasDeWebhookZoho(dos).length, 2);
  assert.equal(m.filasDeWebhookZoho({ event_name: [], event_message: [{ email_info: {} }] })[0].tipo, 'desconocido');
  for (const basura of [null, undefined, 'x', 5, [], {}, { event_message: 'x' }, { event_message: [null, 1, 'a'] }]) {
    assert.deepEqual(m.filasDeWebhookZoho(basura), [], JSON.stringify(basura));
  }
});

prueba('el motivo del rebote se corta a 500 caracteres', () => {
  const [f] = m.filasDeWebhookZoho(mensaje({}, 'softbounce', [{ reason: 'r'.repeat(900) }]));
  assert.equal(f.detalle.length, 500);
});

prueba('autorizacion: solo Bearer con el token exacto; sin secreto configurado nunca autoriza', () => {
  assert.equal(m.autorizadoPorToken('Bearer abc123', 'abc123'), true);
  assert.equal(m.autorizadoPorToken('bearer abc123', 'abc123'), true);
  assert.equal(m.autorizadoPorToken('Bearer abc124', 'abc123'), false);
  assert.equal(m.autorizadoPorToken('Bearer abc12', 'abc123'), false);
  assert.equal(m.autorizadoPorToken('abc123', 'abc123'), false, 'sin el prefijo Bearer');
  assert.equal(m.autorizadoPorToken(null, 'abc123'), false);
  assert.equal(m.autorizadoPorToken('Bearer ', 'abc123'), false);
  assert.equal(m.autorizadoPorToken('Bearer abc123', ''), false, 'secreto vacio');
  assert.equal(m.autorizadoPorToken('Bearer ', ''), false);
  assert.equal(m.autorizadoPorToken('Bearer abc123', undefined), false);
  assert.equal(m.autorizadoPorToken('Bearer abc123', null), false);
});

prueba('la funcion: 200 sin cabecera (el ping de Zoho), 503 sin secreto, 401 con cabecera incorrecta, 200 al reconocer o no, 500 si no guarda; no registra el cuerpo', () => {
  const f = fuente('supabase/functions/zoho-email-webhook/index.ts');
  const iSinCabecera = f.indexOf('if (!req.headers.get("Authorization"))');
  const iSecreto = f.indexOf('Deno.env.get("ZOHO_WEBHOOK_TOKEN")');
  const iAuth = f.indexOf('autorizadoPorToken(req.headers.get("Authorization"), esperado)');
  const iLee = f.indexOf('req.json()');
  assert.ok(iSinCabecera > 0 && iSecreto > iSinCabecera && iAuth > iSecreto && iLee > iAuth,
    'primero el ping sin cabecera, luego el secreto, luego la autorizacion, y solo despues se lee el cuerpo');
  // el ping de Zoho (sin cabecera) responde 200 SIN leer el cuerpo ni tocar la base
  assert.match(f, /if \(!req\.headers\.get\("Authorization"\)\) \{\s*return json\(\{ recibido: 0, autorizado: false \}, 200\);\s*\}/);
  assert.match(f, /if \(!esperado\) \{[\s\S]*?503/);
  assert.match(f, /if \(!autorizadoPorToken[\s\S]*?401/);
  assert.match(f, /filas\.length === 0[\s\S]*?json\(\{ recibido: 0 \}, 200\)/);
  assert.match(f, /from\("bitacora_evento_correo"\)\.insert\(filas\)/);
  assert.match(f, /json\(\{ error: "No se pudieron guardar los eventos" \}, 500\)/);
  assert.match(f, /createClient\([\s\S]*?sinUserAgentDeNavegador\(opcionesConContexto\(req\)\)/);
  assert.doesNotMatch(f, /console\.\w+\([^)]*(cuerpo|filas|payload)/, 'el cuerpo lleva destinatarios: no se registra');
});

prueba('config.toml: la funcion es publica (Zoho no manda JWT) y su control es el token', () => {
  const c = readFileSync('supabase/config.toml', 'utf8');
  assert.match(c, /\[functions\."zoho-email-webhook"\]\r?\nverify_jwt = false/);
});

prueba('migracion: bitacoras solo legibles por admin, sin cuerpo, con retencion de 90 dias', () => {
  const sql = readFileSync('supabase/migrations/20261020065131_bitacora_de_correo.sql', 'utf8');
  assert.match(sql, /ALTER TABLE public\.bitacora_envio_correo ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.bitacora_evento_correo ENABLE ROW LEVEL SECURITY/);
  assert.equal((sql.match(/USING \(public\.is_admin_user\(\)\)/g) ?? []).length, 2);
  assert.match(sql, /REVOKE ALL ON public\.bitacora_envio_correo FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO (anon|authenticated)/i);
  assert.doesNotMatch(sql, /\b(cuerpo|html|body|htmlbody)\b\s+(text|jsonb)/i, 'no hay columna para el cuerpo del correo');
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /cron\.schedule\(\s*'purgar-bitacora-de-correo'/);
  assert.match(sql, /proveedor IN \('smtp2go', 'sendgrid', 'zoho'\)/);
});

console.log(`OK: ${casos} casos del webhook de Zoho y la bitacora de correo.`);
