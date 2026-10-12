#!/usr/bin/env node
/**
 * Bandeja de WhatsApp entrante: logica pura de `_shared/mensajeria/whatsappBandeja.ts`
 * y reglas estructurales de las dos Edge Functions.
 *
 * QUE VIGILA
 *
 * 1. Que el SID `MM...` (el que Twilio asigna a los mensajes de WhatsApp, medido
 *    el 09-oct-2026) se acepte, y que uno ajeno no.
 * 2. Que el "1" de los moviles mexicanos (+521...) se quite igual que en SQL.
 * 3. Que un adjunto solo se descargue de la API de Twilio de NUESTRA cuenta.
 * 4. Que un 5xx/timeout de Twilio NO se marque como fallido (pudo haber salido).
 * 5. Que el webhook verifique la firma y la respuesta exija super_admin.
 *
 * LO QUE ESTO NO PUEDE HACER
 *
 * No toca la base ni Twilio. Las reglas de bloqueo, ventana de 24 h y estados
 * que solo avanzan viven en SQL: ver `scripts/test-whatsapp-bandeja.sql`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { sidValido, telefonoCanonico, telefonoDeTwilio, estadoWhatsApp, urlMediaValida, parsearEntrante, clasificarEnvio } = await import(
  pathToFileURL(path.join(AQUI, '..', 'supabase', 'functions', '_shared', 'mensajeria', 'whatsappBandeja.ts')).href
);

const AC = 'AC' + 'a'.repeat(32);
const MM = 'MM11673352c9e4528429caf8313b2a0afb';
const FROM = 'whatsapp:+15554759009';

// 1. SID
assert.equal(sidValido(MM), true, 'MM es valido');
assert.equal(sidValido('SM' + 'b'.repeat(32)), true, 'SM sigue siendo valido');
assert.equal(sidValido('XX' + 'b'.repeat(32)), false);
assert.equal(sidValido('MM123'), false);
assert.equal(sidValido(undefined), false);

// 2. Telefono
assert.equal(telefonoCanonico('whatsapp:+5215513209470'), '+525513209470');
assert.equal(telefonoCanonico('+525513209470'), '+525513209470');
assert.equal(telefonoCanonico('whatsapp:+14155550100'), '+14155550100');
assert.equal(telefonoCanonico('5513209470'), null);
assert.equal(telefonoCanonico(null), null);
assert.equal(telefonoDeTwilio('whatsapp:+5215513209470'), '+5215513209470', 'el numero de respuesta NO se normaliza');

// 3. Estados
assert.equal(estadoWhatsApp('read'), 'leido');
assert.equal(estadoWhatsApp('delivered'), 'entregado');
assert.equal(estadoWhatsApp('undelivered'), 'fallido');
assert.equal(estadoWhatsApp('inventado'), null);

// 4. URL de media
const ok = `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${MM}/Media/ME${'c'.repeat(32)}`;
assert.equal(urlMediaValida(ok, AC), true);
assert.equal(urlMediaValida(ok, 'AC' + 'd'.repeat(32)), false, 'cuenta ajena');
assert.equal(urlMediaValida(ok.replace('api.twilio.com', 'evil.example.com'), AC), false, 'host ajeno');
assert.equal(urlMediaValida(ok.replace('https', 'http'), AC), false, 'sin TLS');
assert.equal(urlMediaValida(ok.replace('https://', 'https://user:pw@'), AC), false, 'credenciales en la URL');
assert.equal(urlMediaValida('https://api.twilio.com.evil.example/2010-04-01/Accounts/' + AC + '/Messages/x/Media/y', AC), false, 'host con sufijo');

// 5. Parseo de entrante
const base = { AccountSid: AC, MessageSid: MM, From: 'whatsapp:+5215513209470', To: FROM, Body: 'Hola', ProfileName: ' Axel ', NumMedia: '0' };
const p = parsearEntrante(base, AC, FROM);
assert.deepEqual({ sid: p.sid, nombre: p.nombre, cuerpo: p.cuerpo, media: p.media.length }, { sid: MM, nombre: 'Axel', cuerpo: 'Hola', media: 0 });
assert.equal(parsearEntrante({ ...base, AccountSid: 'AC' + 'd'.repeat(32) }, AC, FROM), null, 'cuenta ajena');
assert.equal(parsearEntrante({ ...base, To: 'whatsapp:+15550000000' }, AC, FROM), null, 'destino que no es nuestro numero');
assert.equal(parsearEntrante({ ...base, From: '+5215513209470' }, AC, FROM), null, 'SMS no entra a la bandeja de WhatsApp');
assert.equal(parsearEntrante({ ...base, MessageSid: 'SMxyz' }, AC, FROM), null, 'sid invalido');
const conMedia = parsearEntrante({ ...base, Body: '', NumMedia: '2', MediaUrl0: ok, MediaContentType0: 'image/jpeg; charset=x', MediaUrl1: 'https://evil.example/x', MediaContentType1: 'image/png' }, AC, FROM);
assert.equal(conMedia.media.length, 1, 'el adjunto con URL ajena se descarta');
assert.equal(conMedia.media[0].tipo, 'image/jpeg', 'el content-type se limpia de parametros');
assert.equal(conMedia.media[0].sid, 'ME' + 'c'.repeat(32));
assert.equal(parsearEntrante({ ...base, Body: '', Latitude: '19.43', Longitude: '-99.13' }, AC, FROM).cuerpo, 'Ubicación: 19.43, -99.13');
assert.equal(parsearEntrante({ ...base, Body: 'x'.repeat(5000) }, AC, FROM).cuerpo.length, 4096);

// 6. Clasificacion del envio
assert.deepEqual(clasificarEnvio(201, { sid: MM, status: 'queued' }), { estado: 'enviando', sid: MM });
assert.equal(clasificarEnvio(400, { code: 63016 }).codigo, 'twilio_63016');
assert.equal(clasificarEnvio(400, { code: 63016 }).estado, 'fallido');
assert.equal(clasificarEnvio(500, null).estado, 'desconocido', 'un 5xx NO es fallido');
assert.equal(clasificarEnvio(429, { code: 20429 }).estado, 'desconocido', 'rate limit: no se da por perdido');
assert.equal(clasificarEnvio(201, { sid: 'basura' }).estado, 'desconocido', '2xx sin SID valido es ambiguo');
assert.equal(clasificarEnvio(200, 'texto').estado, 'desconocido');

// 7. Estructura de las funciones
const webhook = readFileSync('supabase/functions/whatsapp-webhook-entrante/index.ts', 'utf8');
const respuesta = readFileSync('supabase/functions/whatsapp-enviar-respuesta/index.ts', 'utf8');
const config = readFileSync('supabase/config.toml', 'utf8');
assert.match(webhook, /verifyTwilioSignature\(/, 'el webhook verifica la firma de Twilio');
assert.ok(webhook.indexOf('verifyTwilioSignature(') < webhook.indexOf('whatsapp_registrar_entrante'), 'la firma se verifica ANTES de tocar la base');
assert.match(config, /\[functions\.whatsapp-webhook-entrante\]\s*\nverify_jwt = false/, 'el webhook declara verify_jwt = false (Twilio no manda JWT)');
assert.doesNotMatch(config, /\[functions\.whatsapp-enviar-respuesta\]/, 'la respuesta mantiene verify_jwt por defecto');
assert.match(respuesta, /requireAdmin\(/);
assert.match(respuesta, /is_super_admin/, 'la respuesta exige super_admin, no cualquier admin');

console.log('OK: bandeja de WhatsApp entrante (SID MM, telefono canonico, media, envio ambiguo y estructura).');
