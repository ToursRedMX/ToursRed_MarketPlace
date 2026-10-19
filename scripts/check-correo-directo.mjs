#!/usr/bin/env node
/**
 * Que ninguna Edge Function mande correo por su cuenta.
 *
 * POR QUE EXISTE (19-oct-2026): ~69 archivos llamaban directo a `api.smtp2go.com`, cada uno con su
 * payload, su llave y su lectura de `email_settings`. Para elegir proveedor (SMTP2GO o SendGrid, con
 * respaldo) desde Configuracion hubo que centralizarlo en `_shared/correo/`. Una funcion nueva que
 * vuelva a hacer `fetch` a un proveedor se salta esa eleccion en silencio: el admin cambia a
 * SendGrid y ese correo sigue saliendo por SMTP2GO.
 *
 * QUE VIGILA: que `api.smtp2go.com` y `api.sendgrid.com` solo aparezcan dentro de
 * supabase/functions/_shared/correo/. Lo demas debe llamar a `enviarCorreo` (o, si ya arma el payload
 * con formato SMTP2GO, a `enviarPayloadSmtp2go`).
 *
 * LO QUE NO PUEDE HACER: no ve un proveedor nuevo con otra URL, ni correo mandado por una libreria
 * SMTP. Es un piso, no un techo.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RAIZ = 'supabase/functions';
const PERMITIDO = path.join(RAIZ, '_shared', 'correo') + path.sep;
const PROHIBIDO = /api\.(smtp2go|sendgrid)\.(com|net)/;

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules') return [];
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const todos = archivos(RAIZ);
const infractores = todos.filter((f) => !f.startsWith(PERMITIDO) && PROHIBIDO.test(readFileSync(f, 'utf8')));
assert.deepEqual(
  infractores, [],
  `Estas funciones llaman directo a un proveedor de correo; usen enviarCorreo de _shared/correo/:\n  ${infractores.join('\n  ')}`,
);
const dentro = todos.filter((f) => f.startsWith(PERMITIDO) && PROHIBIDO.test(readFileSync(f, 'utf8')));
assert.ok(dentro.length >= 1, 'el modulo compartido ya no menciona a los proveedores: ¿el patron dejo de coincidir?');

console.log(`OK: ${todos.length} archivos revisados; ningun envio de correo fuera de _shared/correo/.`);
