#!/usr/bin/env node
/**
 * Guardia de contexto de bitacora — Req. 10.2 de PCI DSS v4.
 *
 * QUE VIGILA
 *
 * Que toda Edge Function que escriba en una tabla con trigger de auditoria, o
 * que llame a `insert_audit_log`, construya su cliente con
 * `createClient(url, key, opcionesConContexto(req, ...))` y no con un
 * `createClient` a secas, que no reenvia nada.
 *
 * POR QUE
 *
 * `insert_audit_log` deduce el origen de `current_setting('request.headers')`,
 * que PostgREST deja por peticion. Cuando el navegador escribe directo, esas
 * cabeceras son las del usuario. Cuando escribe una Edge Function, son las de
 * la peticion INTERNA de la funcion: sin reenviar el contexto, la bitacora
 * registra el origen de la funcion en vez del de la persona — un dato que
 * parece bueno y no lo es, que es peor que no tener ninguno.
 *
 * Al 10-sep-2026, de 795 eventos de negocio en `audit_logs`, los que traian IP
 * eran CERO. Esta guardia existe para que no vuelva a pasar en silencio.
 *
 * POR QUE HACIA FALTA DE VERDAD
 *
 * No es hipotetica. Al enganchar las 49 funciones, la lista se transcribio de
 * una salida truncada por `tail -50` y se quedo fuera `stripe-webhook` — una
 * de las que escriben bitacora de cobros. Lo caso este escaner. Una revision a
 * ojo sobre 50 nombres no lo habria cazado.
 *
 * POR QUE QUITA COMENTARIOS ANTES DE BUSCAR
 *
 * Mismo motivo que `check-edge-deps.mjs`. `_shared/falloSilencioso.ts` explica
 * en un comentario que NO usa `createClient` a proposito y menciona
 * `insert_audit_log`; un grep ingenuo lo reporta y manda a "arreglar" un
 * modulo que esta bien. Escribe en `audit_errors`, que no tiene trigger de
 * auditoria, asi que esta fuera de alcance con razon.
 *
 * LAS TABLAS SE LISTAN AQUI, Y ESO ES UN RIESGO CONOCIDO
 *
 * La lista de tablas auditadas esta escrita abajo, no consultada a la base:
 * esta guardia corre en CI sin credenciales. Si alguien le pone un trigger de
 * auditoria a una tabla nueva y no la agrega aqui, la guardia no la vigilara.
 * Por eso la lista lleva al lado la consulta que la regenera.
 *
 * USO
 *
 *   node scripts/check-audit-context.mjs           revisa supabase/functions/
 *   node scripts/check-audit-context.mjs --lista   ademas imprime el alcance
 *
 * Sale con codigo 1 si una funcion en alcance usa `createClient` sin contexto.
 */

import { readFileSync, globSync } from 'node:fs';

// Regenerar con:
//   select distinct c.relname from pg_trigger t
//   join pg_class c on c.oid = t.tgrelid
//   join pg_proc p on p.oid = t.tgfoid
//   where not t.tgisinternal
//     and pg_get_functiondef(p.oid) ~* 'insert_audit_log'
//   order by 1;
const TABLAS_AUDITADAS = [
  'admin_permissions',
  'agencies',
  'agency_payouts',
  'bookings',
  'payment_transactions',
  'platform_settings',
  'tours',
  'users',
];

// Igual que en check-edge-deps.mjs: se reemplaza cada comentario por espacios
// para que los numeros de linea sigan siendo los reales.
function sinComentarios(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === cierre) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

function motivosDeAlcance(limpio) {
  const motivos = [];
  if (/insert_audit_log/.test(limpio)) motivos.push('llama a insert_audit_log');
  for (const tabla of TABLAS_AUDITADAS) {
    const re = new RegExp(
      `\\.from\\(\\s*["'\`]${tabla}["'\`]\\s*\\)[\\s\\S]{0,120}?\\.(insert|update|upsert|delete)\\(`,
    );
    if (re.test(limpio)) motivos.push(`escribe en ${tabla}`);
  }
  return motivos;
}

const argv = process.argv.slice(2);
const quiereLista = argv.includes('--lista');

const archivos = globSync('supabase/functions/*/index.ts').sort();
const enAlcance = [];
const hallazgos = [];

for (const archivo of archivos) {
  const ruta = archivo.replace(/\\/g, '/');
  const fn = ruta.split('/')[2];
  const limpio = sinComentarios(readFileSync(archivo, 'utf8'));

  const motivos = motivosDeAlcance(limpio);
  if (motivos.length === 0) continue;
  enAlcance.push({ fn, motivos });

  // Cada `createClient(...)` tiene que llevar `opcionesConContexto(req` entre
  // sus argumentos. Se balancean parentesis en vez de mirar la linea suelta
  // porque 34 de las llamadas traen un objeto de opciones de varias lineas: un
  // chequeo por linea las daria por malas aunque estuvieran bien.
  const sueltos = [];
  for (const m of limpio.matchAll(/\bcreateClient\s*\(/g)) {
    const apertura = m.index + m[0].length - 1;

    let prof = 0, fin = -1;
    for (let i = apertura; i < limpio.length; i++) {
      if (limpio[i] === '(') prof++;
      else if (limpio[i] === ')') { prof--; if (prof === 0) { fin = i; break; } }
    }
    if (fin === -1) continue;

    if (/opcionesConContexto\s*\(\s*req\b/.test(limpio.slice(apertura, fin))) continue;
    sueltos.push(limpio.slice(0, m.index).split('\n').length);
  }

  if (sueltos.length > 0) hallazgos.push({ fn, ruta, motivos, lineas: sueltos });
}

console.log('Guardia de contexto de bitacora');
console.log(`Funciones revisadas ..... ${archivos.length}`);
console.log(`En alcance .............. ${enAlcance.length}`);
console.log('');

if (quiereLista) {
  console.log('Alcance:');
  for (const { fn, motivos } of enAlcance) {
    console.log(`  ${fn.padEnd(44)} ${motivos.join(', ')}`);
  }
  console.log('');
}

if (hallazgos.length === 0) {
  console.log('Sin hallazgos: toda funcion en alcance reenvia el contexto del cliente.');
  process.exit(0);
}

console.log(`Hallazgos: ${hallazgos.length} funcion(es) escriben bitacora sin reenviar el origen.`);
console.log('');
for (const h of hallazgos) {
  console.log(`  ${h.fn}`);
  console.log(`    en alcance por: ${h.motivos.join(', ')}`);
  console.log(`    createClient suelto en linea(s): ${h.lineas.join(', ')}`);
  console.log(`    ${h.ruta}`);
  console.log('');
}
console.log('Como se arregla: envuelve las opciones con opcionesConContexto(req, ...):');
console.log('  createClient(url, key, opcionesConContexto(req))');
console.log('  createClient(url, key, opcionesConContexto(req, { global: { headers } }))');
console.log('Vive en ../_shared/contextoAuditoria.ts y fusiona por debajo de lo tuyo.');

process.exit(1);
