/**
 * Guardia: nada de texto doblemente codificado en src/ ni en supabase/functions/.
 *
 * El commit e920572 (09-sep-2026, "Fortalecer contabilidad interna y CFDI con
 * Facturapi") volvio a guardar como UTF-8 archivos que se habian leido como
 * Windows-1252: "turístico" paso a "turÃ­stico", "—" a "â€”". Eran 144 lineas
 * en 19 Edge Functions, 100 de ellas codigo: conceptos de CFDI que se timbraban
 * con basura, correos de cancelacion, el OTP del contrato, las descripciones de
 * puntos y la sincronizacion contable. Nadie lo vio en 3 semanas porque el
 * commit era grande y el texto roto parece "un acento raro".
 *
 * Se encontro el 02-oct-2026 al cambiar la redaccion del concepto exento del
 * CFDI de la reserva. Esta guardia hace que la proxima vez se vea en el PR.
 *
 *   node scripts/test-sin-mojibake.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// La huella: un caracter de arranque de secuencia UTF-8 leido como cp1252
// (Ã, Â, â€, ðŸ) seguido de lo que fue un byte de continuacion.
const HUELLA = /Ã[\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]|Â[\u0080-¿]|â€|ðŸ/;

const archivos = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? archivos(p) : /\.(ts|tsx|js|jsx|html|css)$/.test(e.name) ? [p] : [];
});

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

caso('la huella detecta el caso real del 09-sep (y no el texto bien escrito)', () => {
  assert.ok(HUELLA.test('Anticipo por servicio turÃ­stico'));
  assert.ok(HUELLA.test('PostgREST nunca devuelve â€” exactamente'));
  assert.ok(!HUELLA.test('Servicio de viaje: Tour a Teotihuacán (porción exenta) — según'));
  assert.ok(!HUELLA.test('Código de verificación ✅ 🎉'));
});

caso('ningun archivo de src/ ni de supabase/functions/ trae texto doblemente codificado', () => {
  const hallazgos = [];
  for (const raiz of ['src', path.join('supabase', 'functions')]) {
    for (const f of archivos(path.join(RAIZ, raiz))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (HUELLA.test(l)) hallazgos.push(`${path.relative(RAIZ, f)}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
  }
  assert.deepEqual(hallazgos, [], `Texto doblemente codificado (UTF-8 leido como cp1252):\n${hallazgos.join('\n')}`);
});

caso('el concepto exento del CFDI de la reserva dice "porcion exenta", no "Anticipo"', () => {
  const cfdi = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'generate-booking-cfdi', 'index.ts'), 'utf8');
  assert.match(cfdi, /descripcion: `Servicio de viaje: \$\{tourName\} \(porción exenta\)/);
  assert.doesNotMatch(cfdi, /descripcion: `Anticipo por servicio/);
});

console.log(`\n${casos} casos OK: sin texto doblemente codificado.`);
