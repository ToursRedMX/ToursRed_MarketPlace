#!/usr/bin/env node
/**
 * Aviso por correo de un mensaje entrante de WhatsApp: el correo y su integracion.
 *
 * QUE VIGILA
 *
 * 1. Que lo que escribe el cliente (nombre del perfil y texto) NO pueda inyectar HTML en
 *    el correo ni cabeceras en el asunto.
 * 2. Que el limite de las 24 h se calcule y se muestre en hora de CDMX (la funcion corre en UTC).
 * 3. Que el webhook solo CONFIRME el aviso despues de que SMTP2GO lo acepte: si el correo
 *    falla, el aviso queda pendiente y se reintenta, no se pierde en silencio.
 * 4. Que el aviso solo salga cuando la base lo decide (`avisar === true`).
 *
 * LO QUE ESTO NO PUEDE HACER
 *
 * No manda ningun correo ni toca la base. CUANDO se avisa (una vez por conversacion) lo
 * decide SQL: ver `scripts/test-whatsapp-aviso.sql`.
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

const { escapeHtml, lineaSegura, textoSeguro, limiteVentana, formatoLimite, armarAviso, urlPlataformaValida, DESTINATARIO_AVISO } = await import(
  pathToFileURL(path.join(AQUI, '..', 'supabase', 'functions', '_shared', 'mensajeria', 'avisoWhatsapp.ts')).href
);

const base = { nombre: 'Ana', telefono: '+525513209470', esUsuario: true, preview: 'Hola, quiero info', numAdjuntos: 0, recibidoEn: new Date('2026-10-13T00:00:00Z'), urlPlataforma: 'https://toursred.com' };

// 1. Escapado e inyeccion ------------------------------------------------------------
assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
assert.equal(lineaSegura('Evil\r\nBcc: robo@x.com', 60), 'Evil Bcc: robo@x.com', 'los saltos de linea del nombre se aplanan');
assert.doesNotMatch(lineaSegura('a\u0000b\u0007c\u2028d', 20), /[\u0000-\u001f\u2028]/, 'sin caracteres de control');
assert.equal(lineaSegura('x'.repeat(500), 60).length, 60, 'se recorta');
assert.equal(lineaSegura(undefined, 60), '');
assert.equal(textoSeguro('uno\r\ndos\n\n\n\ntres\u0000', 50), 'uno\ndos\n\ntres', 'la vista previa conserva saltos pero no controles');

const hostil = armarAviso({ ...base, nombre: '<img src=x onerror=alert(1)>\r\nBcc: robo@x.com', preview: '<script>alert(1)</script> hola' });
assert.doesNotMatch(hostil.asunto, /[\r\n]/, 'el asunto no puede traer saltos de linea');
assert.doesNotMatch(hostil.html, /<script|<img src=x/i, 'ni el nombre ni el texto inyectan HTML');
assert.doesNotMatch(hostil.texto, /^Bcc:/m, 'un salto de linea en el nombre no puede abrir una linea nueva en el cuerpo de texto');
assert.equal(hostil.texto.split('\n').filter(l => l.startsWith('Cliente:')).length, 1, 'una sola linea Cliente');
assert.match(hostil.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'el texto llega, escapado');
assert.match(hostil.html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'el nombre llega, escapado');
assert.ok(hostil.asunto.length <= 150, 'asunto acotado');

// 2. Limite de 24 h en hora de CDMX --------------------------------------------------------------
assert.equal(limiteVentana(new Date('2026-10-13T00:00:00Z')).toISOString(), '2026-10-14T00:00:00.000Z', '24 h exactas');
assert.equal(formatoLimite(new Date('2026-10-14T00:00:00Z')), '13 oct 18:00 (hora CDMX)', 'UTC-6, sin horario de verano');
assert.equal(formatoLimite(new Date('2026-10-13T06:00:00Z')), '13 oct 00:00 (hora CDMX)', 'medianoche no sale como 24:00');
assert.match(armarAviso(base).asunto, /responde antes del 13 oct 18:00 \(hora CDMX\)/, 'el asunto trae el limite');

// 3. Contenido ---------------------------------------------------------------------------------------------
const a = armarAviso(base);
assert.match(a.asunto, /^\[WhatsApp\] Mensaje nuevo de Ana/);
assert.match(a.html, /Usuario registrado.*S[ií]/s);
assert.match(a.texto, /Bandeja: https:\/\/toursred\.com\/admin\/whatsapp-entrantes/);
assert.match(armarAviso({ ...base, nombre: null }).asunto, /de \+525513209470/, 'sin nombre se usa el telefono');
assert.match(armarAviso({ ...base, preview: '', numAdjuntos: 1 }).texto, /Mensaje: \(1 adjunto\)/);
assert.match(armarAviso({ ...base, preview: '', numAdjuntos: 3 }).texto, /\(3 adjuntos\)/);
assert.match(armarAviso({ ...base, preview: '', numAdjuntos: 0 }).texto, /\(mensaje vacío\)/);
assert.match(armarAviso({ ...base, urlPlataforma: 'https://x.test///' }).texto, /https:\/\/x\.test\/admin\/whatsapp-entrantes/, 'sin barras dobles');
assert.equal(DESTINATARIO_AVISO, 'contacto@toursred.com');
assert.equal(urlPlataformaValida('https://toursred.com'), true);
for (const mala of ['javascript:alert(1)', 'http://toursred.com', 'https://a b.com', 'https://x.com"><script>', '', null, undefined]) {
  assert.equal(urlPlataformaValida(mala), false, `URL no valida: ${String(mala)}`);
}

// 4. Integracion en el webhook ---------------------------------------------------------------------------------
const webhook = readFileSync('supabase/functions/whatsapp-webhook-entrante/index.ts', 'utf8');
const smtp = webhook.indexOf('api.smtp2go.com');
assert.ok(smtp > 0, 'el webhook manda el correo por SMTP2GO, como el resto del repo');
assert.ok(webhook.indexOf("rpc('whatsapp_confirmar_aviso'") > smtp, 'confirma DESPUES de mandar el correo');
const entreMedio = webhook.slice(smtp, webhook.indexOf("rpc('whatsapp_confirmar_aviso'"));
assert.match(entreMedio, /!res\.ok[^\n]*return/, 'si SMTP2GO rechaza, NO confirma (el aviso queda pendiente y se reintenta)');
assert.match(webhook, /data\.avisar === true && data\.aviso/, 'solo avisa cuando la base lo decide');
assert.doesNotMatch(webhook, /console\.\w+\([^)]*smtp_api_key/, 'la llave de SMTP2GO no se registra');
assert.doesNotMatch(webhook, /console\.\w+\([^)]*DESTINATARIO_AVISO/, 'ni el destinatario');
const sql = readFileSync('supabase/migrations/20261012223925_whatsapp_aviso_por_correo.sql', 'utf8');
assert.match(sql, /select \* into v_contacto from public\.whatsapp_contactos where telefono = v_canon for update/, 'la decision se toma con la fila bloqueada: dos webhooks simultaneos no duplican el correo');
assert.match(sql, /c_silencio constant interval := interval '4 hours'/, 'la conversacion se separa por 4 h de inactividad');

console.log('OK: aviso por correo de WhatsApp (escapado, limite de 24 h en CDMX, confirmar solo tras enviar).');
