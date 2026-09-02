#!/usr/bin/env node
/**
 * Guardia de consultas fiscales en las Edge Functions.
 *
 * POR QUE EXISTE
 * --------------
 * El 01-sep-2026, generate-booking-cfdi leia booking.tax_treatment para decidir
 * si el tour iba exento, pero su `.select()` sobre `bookings` nunca pedia esa
 * columna. PostgREST devuelve solo lo pedido, asi que el valor llegaba
 * `undefined`, caia en el `?? "taxable_16"` y TODO tour se facturaba al 16%:
 * la ruta de exentos estaba muerta y nada fallaba.
 *
 * Los 44 tests de scripts/test-tax-breakdown.mjs pasaban en verde porque
 * prueban la FUNCION PURA calculateTaxBreakdown() con los argumentos ya
 * armados. Nunca miran de donde salen esos argumentos. Este script cubre
 * exactamente esa brecha: no valida aritmetica, valida que la consulta real
 * traiga las columnas que el codigo va a leer.
 *
 * QUE COMPRUEBA
 * -------------
 * En cada Edge Function que importa _shared/taxBreakdown.ts, por cada lectura
 * de `.tax_treatment` o `.exempt_ratio` resuelve el identificador hasta el
 * `.select()` que lo produjo y exige que ese select pida ambas columnas.
 *
 * Resuelve alias (`const booking = bookingRow as BookingRow`), accesos a
 * miembro (`const booking = plan.bookings`) y variables de bucle
 * (`for (const opt of paidOptionals)`). Si no puede resolver el origen, FALLA
 * en vez de callarse: un origen que el checker no entiende es un origen que
 * nadie esta vigilando.
 *
 * Escapes, cuando de verdad aplique:
 *   - `// fiscal-select-ok: <razon>` en la linea de la lectura, para valores
 *     que no vienen de un select (p. ej. del body de la peticion).
 *
 * Uso:  node scripts/test-fiscal-selects.mjs [ruta/a/supabase/functions]
 *
 * Sin argumento audita el repo. Con argumento audita cualquier arbol con la
 * misma forma — sirve para correrlo contra el codigo DESCARGADO DE PRODUCCION
 * (`supabase functions download ... --workdir <tmp>`) y comprobar que lo que
 * esta vivo cumple, no solo lo que quedo escrito en la rama. No es lo mismo:
 * una funcion puede llevar meses desplegada desde antes de que existiera la
 * comprobacion.
 *
 * Sale con codigo 1 si algo falla.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'supabase', 'functions');

/** Columnas que toda consulta que alimente un desglose fiscal debe traer. */
const REQUIRED_COLUMNS = ['tax_treatment', 'exempt_ratio'];

/** Tablas cuyo snapshot fiscal vive por fila. */
const FISCAL_TABLES = ['bookings', 'booking_supplements', 'booking_optional_services'];

let passed = 0;
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function pass() {
  passed++;
}

/**
 * Extrae el argumento de `.select(` que arranca en `from`, respetando el
 * delimitador (backtick o comilla) y los parentesis anidados de los joins.
 */
function extractSelectArg(src, fromIndex) {
  const open = src.indexOf('(', fromIndex);
  if (open === -1) return null;
  let i = open + 1;
  while (i < src.length && /\s/.test(src[i])) i++;
  const quote = src[i];
  if (quote !== '`' && quote !== '"' && quote !== "'") return null;
  i++;
  let out = '';
  while (i < src.length) {
    if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
    if (src[i] === quote) break;
    out += src[i];
    i++;
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * Texto de `const IDENT = ...;`, siguiendo un nivel las constantes que
 * referencia. Hace falta porque un select puede pasarse como constante
 * (`.select(BOOKING_SELECT)`) armada a partir de otra (`BOOKING_COLUMNS`):
 * mirar solo el argumento literal no veria ninguna columna.
 */
function resolveConstText(src, ident, depth = 0) {
  if (depth > 2) return '';
  const m = new RegExp(`const\\s+${ident}\\s*=\\s*`).exec(src);
  if (!m) return '';
  let i = m.index + m[0].length;
  let nest = 0;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if ('([{'.includes(ch)) nest++;
    else if (')]}'.includes(ch)) nest--;
    else if (ch === ';' && nest <= 0) break;
    out += ch;
    i++;
  }
  for (const ref of new Set([...out.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((r) => r[1]))) {
    if (ref !== ident) out += '\n' + resolveConstText(src, ref, depth + 1);
  }
  return out;
}

/**
 * Mapa varName -> { table, select, line } para cada
 * `const { data: varName } = await <client>.from("<tabla>").select(...)`.
 *
 * Se registran TODAS las tablas, no solo las fiscales: el snapshot puede
 * llegar por un join anidado desde otra tabla (generate-booking-installment-cfdi
 * lo lee via booking_payment_installments -> booking_payment_plans -> bookings).
 * Quien decide si hay que exigir las columnas es la LECTURA, no la tabla raiz.
 */
function collectSelectVars(src) {
  const vars = new Map();
  const fromRe = /\.from\(\s*["'`](\w+)["'`]\s*\)/g;
  let m;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1];

    const selIdx = src.indexOf('.select', m.index);
    if (selIdx === -1) continue;
    // El .select debe pertenecer a esta consulta, no a otra mas abajo.
    if (src.slice(m.index, selIdx).includes(';')) continue;

    let selectArg = extractSelectArg(src, selIdx + '.select'.length);
    if (selectArg == null) {
      // No es literal: `.select(CONSTANTE)`.
      const identMatch = /^\s*\(\s*(\w+)\s*\)/.exec(src.slice(selIdx + '.select'.length));
      if (!identMatch) continue;
      selectArg = resolveConstText(src, identMatch[1]);
    }

    // El nombre esta antes del .from: `const { data: X, error: Y } = await ...`
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const nameMatch = [...before.matchAll(/data\s*:\s*(\w+)/g)].pop();
    if (!nameMatch) continue;

    vars.set(nameMatch[1], { table, select: selectArg, line: lineOf(src, m.index) });
  }
  return vars;
}

/**
 * Mapa varName -> identificador raiz del que deriva, para alias, accesos a
 * miembro y variables de bucle.
 */
function collectAliases(src) {
  const aliases = new Map();

  // const X = <expr>;  (incluye `as T`, `as unknown as T`, `a.b.c`, `a ?? b`)
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*([^;\n]+)/g)) {
    const [, name, rawExpr] = m;
    if (/\bawait\b|\bfunction\b|=>/.test(rawExpr)) continue;
    const root = rawExpr
      .replace(/\(\s*/g, '')
      .match(/^\s*(\w+)/);
    if (root && root[1] !== name) aliases.set(name, root[1]);
  }

  // for (const X of Y)
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let)\s+(\w+)\s+of\s+([\w.]+)/g)) {
    aliases.set(m[1], m[2].split('.')[0]);
  }

  return aliases;
}

function resolveRoot(name, aliases, selectVars) {
  const seen = new Set();
  let cur = name;
  while (cur && !selectVars.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = aliases.get(cur);
  }
  return selectVars.has(cur) ? cur : null;
}

// ─────────────────────────────────────────────────────────────────────────────

const dirs = fs
  .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .sort();

const fiscalFunctions = [];

for (const dir of dirs) {
  const file = path.join(FUNCTIONS_DIR, dir, 'index.ts');
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (!/_shared\/taxBreakdown\.ts/.test(src)) continue;
  fiscalFunctions.push({ dir, file, src });
}

console.log(`\nGuardia de consultas fiscales — ${fiscalFunctions.length} Edge Functions con desglose fiscal\n`);

if (fiscalFunctions.length === 0) {
  console.error('FALLO: ninguna funcion importa _shared/taxBreakdown.ts. ¿Se movio el archivo?');
  process.exit(1);
}

for (const { dir, src } of fiscalFunctions) {
  const selectVars = collectSelectVars(src);
  const aliases = collectAliases(src);
  const lines = src.split('\n');

  // Valores que llegan en el body: son un snapshot que manda quien invoca, no
  // salen de un select de esta funcion.
  const bodyProvided = new Set();
  for (const m of src.matchAll(/=\s*await\s+req\.json\(\)/g)) {
    const before = src.slice(Math.max(0, m.index - 1500), m.index);
    const destructuring = before.lastIndexOf('{');
    if (destructuring === -1) continue;
    const block = before.slice(destructuring);
    for (const col of REQUIRED_COLUMNS) {
      if (new RegExp(`\\b${col}\\b`).test(block)) bodyProvided.add(col);
    }
  }

  const reads = [];
  for (const col of REQUIRED_COLUMNS) {
    const re = new RegExp(`(\\w+)\\s*(?:as\\s*\\{[^}]*\\}\\s*\\)?)?\\s*\\.${col}\\b`, 'g');
    for (const m of src.matchAll(re)) {
      const line = lineOf(src, m.index);
      // `(x as { tax_treatment?: T }).tax_treatment` mete el nombre del tipo en
      // el match; el identificador real es el primero de la expresion.
      const ident = m[1];
      reads.push({ ident, col, line, text: lines[line - 1].trim() });
    }
  }

  if (reads.length === 0) {
    // Importa taxBreakdown pero no lee snapshot de fila: nada que vigilar.
    console.log(`  ${dir}: sin lecturas de snapshot fiscal (ok)`);
    pass();
    continue;
  }

  const problems = [];
  const okReads = [];

  for (const r of reads) {
    if (/fiscal-select-ok:/.test(r.text)) { okReads.push(`${r.col} (escape declarado)`); continue; }
    if (bodyProvided.has(r.col) && !selectVars.has(r.ident) && !aliases.has(r.ident)) {
      okReads.push(`${r.col} (viene del body)`);
      continue;
    }

    const rootVar = resolveRoot(r.ident, aliases, selectVars);
    if (!rootVar) {
      problems.push(
        `linea ${r.line}: se lee \`${r.ident}.${r.col}\` pero no se pudo resolver de que .select() sale ` +
        `\`${r.ident}\`. Hazlo explicito o anota // fiscal-select-ok: <razon>.`,
      );
      continue;
    }

    const { table, select, line } = selectVars.get(rootVar);
    const missing = REQUIRED_COLUMNS.filter((c) => !new RegExp(`\\b${c}\\b`).test(select));
    if (missing.length > 0) {
      problems.push(
        `linea ${r.line}: se lee \`${r.ident}.${r.col}\`, que viene del .select() sobre ` +
        `"${table}" de la linea ${line}, y ese select NO pide: ${missing.join(', ')}. ` +
        `PostgREST devuelve solo lo pedido: el valor llegaria undefined y el CFDI saldria gravado al 16%.`,
      );
    } else {
      okReads.push(`${r.ident}.${r.col} <- select "${table}" (linea ${line})`);
    }
  }

  if (problems.length > 0) {
    console.log(`  ${dir}: FALLA`);
    for (const p of problems) {
      console.log(`      ${p}`);
      fail(`${dir} — ${p}`);
    }
  } else {
    console.log(`  ${dir}: ${okReads.length} lectura(s) con origen verificado`);
    for (const o of new Set(okReads)) console.log(`      ${o}`);
    pass();
  }
}

console.log('\n' + '─'.repeat(70));
if (failures.length === 0) {
  console.log(`OK — ${passed} funcion(es) con sus consultas fiscales completas.\n`);
  process.exit(0);
} else {
  console.log(`FALLO — ${failures.length} problema(s):\n`);
  for (const f of failures) console.log(`  • ${f}`);
  console.log('');
  process.exit(1);
}
