#!/usr/bin/env node
/**
 * Pruebas del desglose fiscal de IVA (tratamiento mixto).
 *
 * Sin dependencias a proposito: el repo no tiene runner de tests y meter uno
 * no es parte de este requerimiento. Mismo patron que scripts/smoke-preview.mjs.
 *
 * Uso:  node scripts/test-tax-breakdown.mjs
 * Sale con codigo 1 si algo falla.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Re-lanzarse con la bandera de type-stripping si no viene puesta, para que el
// invocador solo tenga que escribir `node scripts/test-tax-breakdown.mjs`.
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

// Se importa el .ts CANONICO directamente: Node 22.17+ quita los tipos con
// --experimental-strip-types (el runner lo re-lanza solo con la bandera puesta).
// Asi el test corre contra el mismo archivo que usa el frontend, no contra una
// transpilacion aparte que podria divergir.
function loadCanonical() {
  return import(pathToFileURL(path.join(ROOT, 'src/utils/taxBreakdown.ts')).href);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.000001;
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${name}: esperado ${expected}, obtenido ${actual}`);
  }
}

function assert(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`${name}${detail ? ': ' + detail : ''}`);
  }
}

function section(n, title) {
  console.log(`\n── ${n}. ${title}`);
}

const M = await loadCanonical();
const { calculateTaxBreakdown, deriveExemptRatio, treatmentForRatio, VAT_RATE } = M;

// Anticipo del tour: conserva proporcionalmente la composicion fiscal.
const deposit = (price, pct, treatment, ratio) =>
  calculateTaxBreakdown({
    grossAmount: Math.round(price * (pct / 100) * 100) / 100,
    taxTreatment: treatment,
    exemptRatio: ratio,
  });

// ── 1 ────────────────────────────────────────────────────────────────────────
section(1, 'Tour 100% gravado $1,000, anticipo 40% — comportamiento actual');
{
  const r = deposit(1000, 40, 'taxable_16', 0);
  check('1 exento', r.exemptAmount, 0);
  check('1 base', r.taxableBase, 344.83);
  check('1 iva', r.vatAmount, 55.17);
  check('1 total', r.total, 400);
  console.log(`   exento ${r.exemptAmount} · base ${r.taxableBase} · iva ${r.vatAmount} · total ${r.total}`);
}

// ── 2 ────────────────────────────────────────────────────────────────────────
section(2, 'Tour 100% exento $1,000, anticipo 40%');
{
  const r = deposit(1000, 40, 'exempt', 1);
  check('2 exento', r.exemptAmount, 400);
  check('2 base', r.taxableBase, 0);
  check('2 iva', r.vatAmount, 0);
  check('2 total', r.total, 400);
  check('2 tasa', r.taxRate, 0);
  console.log(`   exento ${r.exemptAmount} · base ${r.taxableBase} · iva ${r.vatAmount} · total ${r.total}`);
}

// ── 3 ────────────────────────────────────────────────────────────────────────
section(3, 'Tour mixto $1,499 (exento 999 / gravado 500), anticipo 40%');
{
  const ratio = deriveExemptRatio(999, 500, 1499);
  const r = deposit(1499, 40, 'mixed', ratio);
  check('3 exento', r.exemptAmount, 399.6);
  check('3 base', r.taxableBase, 172.41);
  check('3 iva', r.vatAmount, 27.59);
  check('3 total', r.total, 599.6);
  console.log(`   ratio ${ratio} · exento ${r.exemptAmount} · base ${r.taxableBase} · iva ${r.vatAmount} · total ${r.total}`);
}

// ── 4 ────────────────────────────────────────────────────────────────────────
section(4, 'Mismo tour, anticipo 30%');
{
  const ratio = deriveExemptRatio(999, 500, 1499);
  const r = deposit(1499, 30, 'mixed', ratio);
  check('4 exento', r.exemptAmount, 299.7);
  check('4 base', r.taxableBase, 129.31);
  check('4 iva', r.vatAmount, 20.69);
  check('4 total', r.total, 449.7);
  console.log(`   exento ${r.exemptAmount} · base ${r.taxableBase} · iva ${r.vatAmount} · total ${r.total}`);
}

// ── 5 ────────────────────────────────────────────────────────────────────────
section(5, 'Barrido de redondeo: exento + base + iva == total, siempre');
{
  let worst = 0;
  let n = 0;
  for (let price = 100.01; price <= 3000; price += 7.13) {
    for (const pct of [10, 15, 25, 30, 33, 40, 50, 66, 75, 100]) {
      for (const ratio of [0, 0.0001, 0.1234, 0.3333, 0.5, 0.6667, 0.9999, 1]) {
        const treatment = treatmentForRatio(ratio);
        const gross = Math.round(price * (pct / 100) * 100) / 100;
        const r = calculateTaxBreakdown({ grossAmount: gross, taxTreatment: treatment, exemptRatio: ratio });
        const sum = r.exemptAmount + r.taxableBase + r.vatAmount;
        worst = Math.max(worst, Math.abs(sum - gross));
        n++;
      }
    }
  }
  assert('5 cuadre exacto en todos los casos', worst < 0.000001, `desviacion maxima ${worst}`);
  console.log(`   ${n} combinaciones · desviacion maxima ${worst}`);
}

// ── 5b ───────────────────────────────────────────────────────────────────────
section('5b', 'Misma garantia a 6 decimales (valor_unitario de FacturAPI)');
{
  let worst = 0;
  for (let price = 100.01; price <= 2000; price += 13.77) {
    for (const ratio of [0, 0.2, 0.5, 0.6667, 1]) {
      const treatment = treatmentForRatio(ratio);
      const r = calculateTaxBreakdown({
        grossAmount: price, taxTreatment: treatment, exemptRatio: ratio, decimals: 6,
      });
      worst = Math.max(worst, Math.abs(r.exemptAmount + r.taxableBase + r.vatAmount - price));
    }
  }
  assert('5b cuadre a 6 decimales', worst < 0.0000001, `desviacion maxima ${worst}`);
  console.log(`   desviacion maxima ${worst}`);
}

// ── 7 y 8 ────────────────────────────────────────────────────────────────────
section('7-8', 'Comision de ToursRed: 16% sobre tour exento y sobre mixto');
{
  // La comision se calcula SIN pasar el tratamiento del tour: siempre gravada.
  const commissionOn = (amount) =>
    calculateTaxBreakdown({ grossAmount: amount, taxTreatment: 'taxable_16', exemptRatio: 0 });

  const exentoComision = commissionOn(116);
  check('7 base comision (tour exento)', exentoComision.taxableBase, 100);
  check('7 iva comision (tour exento)', exentoComision.vatAmount, 16);
  check('7 tasa', exentoComision.taxRate, VAT_RATE);

  const mixtoComision = commissionOn(116);
  check('8 iva comision (tour mixto)', mixtoComision.vatAmount, 16);
  check('8 tasa', mixtoComision.taxRate, VAT_RATE);
  console.log(`   comision $116 → base ${exentoComision.taxableBase} · iva ${exentoComision.vatAmount} (tasa ${exentoComision.taxRate})`);
}

// ── 9 ────────────────────────────────────────────────────────────────────────
section(9, 'Captura inconsistente debe rechazarse');
{
  let threw = false;
  try { deriveExemptRatio(1499, 500, 1499); } catch { threw = true; }
  assert('9 exento+gravado > precio se rechaza', threw);

  threw = false;
  try { deriveExemptRatio(200, 200, 1000); } catch { threw = true; }
  assert('9 suma menor al precio se rechaza', threw);

  threw = false;
  try { calculateTaxBreakdown({ grossAmount: 100, taxTreatment: 'mixed', exemptRatio: 0 }); } catch { threw = true; }
  assert("9 'mixed' con ratio 0 se rechaza", threw);

  threw = false;
  try { calculateTaxBreakdown({ grossAmount: 100, taxTreatment: 'mixed', exemptRatio: 1 }); } catch { threw = true; }
  assert("9 'mixed' con ratio 1 se rechaza", threw);

  // Dentro de la tolerancia de un centavo si pasa.
  threw = false;
  try { deriveExemptRatio(999.005, 500, 1499); } catch { threw = true; }
  assert('9 tolerancia de $0.01 se respeta', !threw);
  console.log('   rechazos correctos, tolerancia $0.01 respetada');
}

// ── 11 ───────────────────────────────────────────────────────────────────────
section(11, 'exempt_ratio del tour escala a las 5 tarifas');
{
  const ratio = deriveExemptRatio(999, 500, 1499); // capturado sobre precio_adulto
  const tarifas = {
    precio_adulto: 1499, precio_adulto_mayor: 1299,
    precio_nino: 899, precio_infante: 0, precio_mascota: 350,
  };
  let allOk = true;
  for (const [nombre, precio] of Object.entries(tarifas)) {
    const r = calculateTaxBreakdown({ grossAmount: precio, taxTreatment: 'mixed', exemptRatio: ratio });
    const proporcionReal = precio > 0 ? r.exemptAmount / precio : 0;
    const ok = precio === 0
      ? r.total === 0
      : Math.abs(proporcionReal - ratio) < 0.0001 && Math.abs(r.total - precio) < 0.000001;
    if (!ok) allOk = false;
    console.log(`   ${nombre.padEnd(20)} ${String(precio).padStart(6)} → exento ${r.exemptAmount} · base ${r.taxableBase} · iva ${r.vatAmount}`);
  }
  assert('11 las 5 tarifas escalan con el mismo ratio', allOk);
}

// ── 12 ───────────────────────────────────────────────────────────────────────
section(12, 'Tour gravado + opcional exento (Six Flags) — sin contaminarse');
{
  const tour = calculateTaxBreakdown({ grossAmount: 2000, taxTreatment: 'taxable_16', exemptRatio: 0 });
  const sixFlags = calculateTaxBreakdown({ grossAmount: 850, taxTreatment: 'exempt', exemptRatio: 1 });

  check('12 tour iva', tour.vatAmount, 275.86);
  check('12 tour exento', tour.exemptAmount, 0);
  check('12 opcional iva', sixFlags.vatAmount, 0);
  check('12 opcional exento', sixFlags.exemptAmount, 850);
  check('12 iva total del CFDI', tour.vatAmount + sixFlags.vatAmount, 275.86);
  check('12 total del CFDI', tour.total + sixFlags.total, 2850);
  console.log(`   tour: iva ${tour.vatAmount} · opcional: exento ${sixFlags.exemptAmount}, iva ${sixFlags.vatAmount}`);
}

// ── 13 ───────────────────────────────────────────────────────────────────────
section(13, 'Tour mixto 30% + suplemento mixto 70% — proporciones aisladas');
{
  const tour = calculateTaxBreakdown({ grossAmount: 1000, taxTreatment: 'mixed', exemptRatio: 0.3 });
  const sup = calculateTaxBreakdown({ grossAmount: 1000, taxTreatment: 'mixed', exemptRatio: 0.7 });

  check('13 tour exento', tour.exemptAmount, 300);
  check('13 suplemento exento', sup.exemptAmount, 700);
  // El promedio (0.5) daria 500 en ambos: confirma que NO se promedian.
  assert('13 no se promedian', tour.exemptAmount !== 500 && sup.exemptAmount !== 500);
  assert('13 cada uno con su ratio', tour.exemptRatio === 0.3 && sup.exemptRatio === 0.7);
  check('13 cuadre tour', tour.total, 1000);
  check('13 cuadre suplemento', sup.total, 1000);
  console.log(`   tour exento ${tour.exemptAmount} (ratio ${tour.exemptRatio}) · suplemento exento ${sup.exemptAmount} (ratio ${sup.exemptRatio})`);
}

// ── 15 (regresion) ────────────────────────────────────────────────────────────
section(15, 'Concepto por UNIDAD: cantidad no debe multiplicar dos veces');
{
  // Regresion del bug preexistente en generate-supplement-cfdi y
  // generate-optional-service-cfdi: el desglose del concepto se calculaba
  // sobre unit_price * quantity mientras el concepto llevaba cantidad=quantity,
  // asi que FacturAPI volvia a multiplicar. Con quantity=2 el CFDI amparaba
  // 400.00 habiendose cobrado 200.00.
  const unitPrice = 100, quantity = 2;
  const totalCobrado = unitPrice * quantity;

  for (const [nombre, ratio] of [['gravado', 0], ['exento', 1], ['mixto', 0.4]]) {
    const treatment = treatmentForRatio(ratio);
    const porUnidad = calculateTaxBreakdown({
      grossAmount: unitPrice, taxTreatment: treatment, exemptRatio: ratio, decimals: 6,
    });
    // Lo que FacturAPI reconstruye: (base + exento) * cantidad + IVA * cantidad
    const amparado = (porUnidad.exemptAmount + porUnidad.taxableBase + porUnidad.vatAmount) * quantity;
    check(`15 ${nombre}: el CFDI ampara lo cobrado`, Math.round(amparado * 100) / 100, totalCobrado);
  }
  console.log(`   unit ${unitPrice} x ${quantity} → el CFDI ampara ${totalCobrado} en los tres tratamientos`);
}

// ── PARIDAD SQL ───────────────────────────────────────────────────────────────
section('SQL', 'Los esperados del harness SQL coinciden con la canonica');
{
  // scripts/test-tax-snapshot-sql.sql lleva sus valores esperados HARDCODEADOS
  // para no recalcularlos con la misma formula que pretende verificar. El
  // riesgo de eso es que se desincronicen de la canonica sin que nadie lo note.
  // Aqui se parsean y se comprueban, asi que el harness SQL no puede mentir.
  const sqlPath = path.join(ROOT, 'scripts/test-tax-snapshot-sql.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  // Se lee el bloque compacto del resumen (el segundo VALUES del archivo).
  const rowRe = /\((\d+),([\d.]+),'(taxable_16|exempt|mixed)'(?:::tax_treatment_enum)?,([\d.]+)(?:::numeric)?,([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/g;
  const rows = [...sql.matchAll(rowRe)];
  assert('SQL: se parsearon los casos del harness', rows.length >= 18, `solo ${rows.length}`);

  let mismatches = 0;
  const seen = new Set();
  for (const m of rows) {
    const [, n, gross, treatment, ratio, ee, eb, ei, et] = m;
    if (seen.has(n)) continue;
    seen.add(n);
    const r = calculateTaxBreakdown({
      grossAmount: Number(gross), taxTreatment: treatment, exemptRatio: Number(ratio),
    });
    if (r.exemptAmount !== Number(ee) || r.taxableBase !== Number(eb)
        || r.vatAmount !== Number(ei) || r.taxRate !== Number(et)) {
      mismatches++;
      failures.push(`SQL caso ${n}: canonica da ${r.exemptAmount}/${r.taxableBase}/${r.vatAmount}/${r.taxRate}, el .sql espera ${ee}/${eb}/${ei}/${et}`);
    }
  }
  if (mismatches === 0) passed++; else failed += mismatches;
  console.log(`   ${seen.size} casos del .sql verificados contra la canonica · ${mismatches} discrepancias`);
}

// ── PARIDAD ──────────────────────────────────────────────────────────────────
section('P', 'Paridad entre la fuente canonica y la copia Deno');
{
  const canonSrc = fs.readFileSync(path.join(ROOT, 'src/utils/taxBreakdown.ts'), 'utf8');
  const denoSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/taxBreakdown.ts'), 'utf8');
  const START = '// ═══════════════ INICIO BLOQUE CANONICO';
  const END = '// ════════════════ FIN BLOQUE CANONICO';
  const block = (s) => {
    const a = s.indexOf(START);
    const b = s.indexOf(END);
    if (a < 0 || b < 0) return null;
    return s.slice(a, s.indexOf('\n', b) + 1);
  };
  const a = block(canonSrc);
  const b = block(denoSrc);
  assert('P bloque canonico presente en ambos', a !== null && b !== null);
  assert('P los bloques son identicos', a === b,
    'la copia Deno divergio de la fuente canonica — vuelve a copiar el bloque');
  console.log(`   bloque de ${a ? a.length : 0} bytes, identico en ambos archivos`);
}

// ── Resultado ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (failed === 0) {
  console.log(`✅ ${passed} aserciones pasaron, 0 fallaron`);
  process.exit(0);
} else {
  console.log(`❌ ${passed} pasaron, ${failed} FALLARON:`);
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
