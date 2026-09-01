#!/usr/bin/env node
/**
 * Resumen por regla del reporte de ESLint (pieza "Decision 1").
 *
 * Lee `eslint-report.json` (formato `-f json`) y escribe:
 *   - la tabla por familia y por regla en $GITHUB_STEP_SUMMARY
 *   - `eslint-report.txt`, version legible para el artefacto
 *
 * Por que JSON y no la salida `stylish`: las reglas del React Compiler
 * (react-hooks/set-state-in-effect, /immutability, /refs, /static-components,
 * /purity, /preserve-manual-memoization) NO imprimen el ruleId en stylish.
 * Contar por "ultimo campo de la linea" atribuye 274 problemas a palabras
 * sueltas del mensaje ("renders", "declared", "render"). El JSON trae ruleId
 * en todos los mensajes.
 *
 * Uso:  node scripts/summarize-lint.mjs [ruta-al-json]
 * Fuera de Actions (sin GITHUB_STEP_SUMMARY) imprime la tabla por stdout.
 */

import fs from 'node:fs';
import path from 'node:path';

// Base por regla del 31-ago-2026 sobre main, con eslint 10 /
// typescript-eslint 8.68.0. Mover junto con las BASELINE_* de lint.yml:
// si una baja, se actualizan las dos.
const BASE = {
  '@typescript-eslint/no-explicit-any': 1668,
  '@typescript-eslint/no-unused-vars': 322,
  'no-useless-escape': 171,
  'react-hooks/set-state-in-effect': 118,
  'react-hooks/immutability': 86,
  'react-hooks/exhaustive-deps': 85,
  'react-hooks/refs': 21,
  'no-useless-assignment': 16,
  'no-empty': 12,
  'react-hooks/preserve-manual-memoization': 4,
  'react-refresh/only-export-components': 4,
  'react-hooks/purity': 1,
  '@typescript-eslint/no-unused-expressions': 2,
  'prefer-const': 2,
  // react-hooks/rules-of-hooks y react-hooks/static-components NO van aqui a
  // proposito: los dos quedaron en 0. Fuera de BASE, si reaparecen se marcan
  // con el aviso de "reglas fuera de la base" ademas del delta, que es la
  // senal que queremos.
};

// Corriendo local sin las env del workflow, se cae a la misma base para que
// los deltas sigan teniendo sentido.
const num = (name, fallback) => Number(process.env[name] ?? fallback);
const BASELINE_ERRORS = num('BASELINE_ERRORS', 2423);
const BASELINE_WARNINGS = num('BASELINE_WARNINGS', 89);
const BASELINE_TOTAL = num('BASELINE_TOTAL', 2512);
const BASELINE_FILES = num('BASELINE_FILES', 324);

const reportPath = process.argv[2] ?? 'eslint-report.json';
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

// `-f json` emite una entrada por archivo lintado, incluidos los limpios. Cero
// entradas no es "el repo esta impecable": es que eslint no linteo nada (un
// `ignores` que se comio todo, un glob roto). Sin este guardia el resumen
// reportaria 0 problemas y un delta de -2512, o sea una mejora inventada.
const lintedFiles = report.length;

let errors = 0;
let warnings = 0;
let files = 0;
const byRule = {};
const lines = [];
const cwd = process.cwd();

for (const file of report) {
  if (!file.messages.length) continue;
  files++;
  const rel = path.relative(cwd, file.filePath).split(path.sep).join('/');
  for (const m of file.messages) {
    if (m.severity === 2) errors++;
    else if (m.severity === 1) warnings++;
    const rule = m.ruleId ?? '(sin ruleId)';
    byRule[rule] ??= { e: 0, w: 0 };
    if (m.severity === 2) byRule[rule].e++;
    else byRule[rule].w++;
    const sev = m.severity === 2 ? 'error' : 'warning';
    lines.push(`${rel}:${m.line}:${m.column}  ${sev}  ${m.message}  ${rule}`);
  }
}

const total = errors + warnings;

// Reporte legible para el artefacto: el JSON crudo no se lee a ojo.
fs.writeFileSync(
  'eslint-report.txt',
  `${lines.join('\n')}\n\n${total} problems (${errors} errors, ${warnings} warnings) en ${files} archivos\n`,
);

// Delta con signo: "=" cuando no se movio, para leer la tabla de un vistazo
// sin restar mentalmente.
const delta = (now, base) => (now === base ? '=' : now > base ? `+${now - base}` : `${now - base}`);

const ANY = '@typescript-eslint/no-explicit-any';
const UNUSED = '@typescript-eslint/no-unused-vars';
const count = (rule) => (byRule[rule] ? byRule[rule].e + byRule[rule].w : 0);
const sumHooks = (obj, get) =>
  Object.keys(obj)
    .filter((r) => r.startsWith('react-hooks/'))
    .reduce((s, r) => s + get(r), 0);

const hooks = sumHooks(byRule, count);
const hooksBase = sumHooks(BASE, (r) => BASE[r]);
const rest = total - count(ANY) - count(UNUSED) - hooks;
const restBase = BASELINE_TOTAL - BASE[ANY] - BASE[UNUSED] - hooksBase;

const pct = (x) => (total ? ` (${Math.round((x / total) * 100)}%)` : '');

const out = [];
out.push('## Lint (informativo, no bloquea)');
out.push('');
out.push('`npm run lint` — `eslint .`');
out.push('');
if (lintedFiles === 0) {
  out.push('> :rotating_light: ESLint no linteo ningun archivo. El conteo de abajo');
  out.push('> **no es comparable con la base**: revisar `ignores` en `eslint.config.js`.');
  out.push('');
}
out.push('| | Ahora | Base 31-ago | Δ |');
out.push('|---|---|---|---|');
out.push(`| **Problemas** | **${total}** en ${files} archivos | ${BASELINE_TOTAL} en ${BASELINE_FILES} | ${delta(total, BASELINE_TOTAL)} |`);
out.push(`| Errores | ${errors} | ${BASELINE_ERRORS} | ${delta(errors, BASELINE_ERRORS)} |`);
out.push(`| Warnings | ${warnings} | ${BASELINE_WARNINGS} | ${delta(warnings, BASELINE_WARNINGS)} |`);
out.push('');
out.push('### Por familia');
out.push('');
out.push('| Familia | Ahora | Base | Δ |');
out.push('|---|---|---|---|');
out.push(`| \`no-explicit-any\` | ${count(ANY)}${pct(count(ANY))} | ${BASE[ANY]} | ${delta(count(ANY), BASE[ANY])} |`);
out.push(`| \`no-unused-vars\` | ${count(UNUSED)}${pct(count(UNUSED))} | ${BASE[UNUSED]} | ${delta(count(UNUSED), BASE[UNUSED])} |`);
out.push(`| \`react-hooks/*\` | ${hooks}${pct(hooks)} | ${hooksBase} | ${delta(hooks, hooksBase)} |`);
out.push(`| Resto | ${rest}${pct(rest)} | ${restBase} | ${delta(rest, restBase)} |`);
out.push('');
out.push('### Por regla');
out.push('');
out.push('| Regla | Errores | Warnings | Total | Base | Δ |');
out.push('|---|---|---|---|---|---|');

// Union de reglas vistas y reglas de la base: una regla que estaba en la base
// y hoy no aparece se queda con 0 para que la mejora se vea, no para que
// desaparezca de la tabla sin dejar rastro.
const allRules = new Set([...Object.keys(byRule), ...Object.keys(BASE)]);
[...allRules]
  .map((r) => ({ rule: r, e: byRule[r]?.e ?? 0, w: byRule[r]?.w ?? 0, base: BASE[r] ?? 0 }))
  .sort((a, b) => b.e + b.w - (a.e + a.w) || a.rule.localeCompare(b.rule))
  .forEach(({ rule, e, w, base }) => {
    out.push(`| \`${rule}\` | ${e} | ${w} | ${e + w} | ${base} | ${delta(e + w, base)} |`);
  });
out.push('');

if (total > BASELINE_TOTAL) {
  out.push(`> :warning: Subio ${total} vs base ${BASELINE_TOTAL}.`);
  out.push('');
}

// Una regla que no estaba en la base sale de un plugin nuevo o de un cambio de
// config, no de codigo nuevo. Conviene notarlo aparte del total.
const nuevas = Object.keys(byRule).filter((r) => !(r in BASE));
if (nuevas.length) {
  out.push(`> :new: Reglas fuera de la base: ${nuevas.map((r) => `\`${r}\``).join(', ')}.`);
  out.push('');
}

const summary = `${out.join('\n')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
} else {
  process.stdout.write(summary);
}

console.log(`${total} problems (${errors} errors, ${warnings} warnings) en ${files} archivos`);
console.log(
  `base: ${BASELINE_TOTAL} (${BASELINE_ERRORS} errors, ${BASELINE_WARNINGS} warnings) — delta ${delta(total, BASELINE_TOTAL)}`,
);
