/**
 * Prueba de src/lib/contrasenaFiltrada.ts.
 *
 * El 02-oct-2026 el reset de contrasena de un admin devolvio 500 "Error al
 * actualizar la contrasena" con "Admin123!". La causa: 14 copias de
 * /leaked|pwned|compromised|common password/ sobre el TEXTO del error, y
 * Supabase ya lo redacta "Password is known to be weak and easy to guess" —
 * ninguna palabra casaba.
 *
 * Por eso los casos se construyen con la clase REAL de @supabase/auth-js
 * (AuthWeakPasswordError) y con el mensaje literal que dejo auth_logs ese dia,
 * no con objetos inventados: si la libreria cambia la forma del error, esto se
 * pone rojo antes que la pantalla.
 *
 * Y dos guardias para que no vuelva a pasar:
 *   - nadie en src/ vuelve a decidirlo con su propia regex;
 *   - verify-reset-code (que no puede importar de src/) mira el codigo.
 *
 *   node scripts/test-contrasena-filtrada.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { esContrasenaFiltrada } = await import(
  pathToFileURL(path.join(RAIZ, 'src', 'lib', 'contrasenaFiltrada.ts')).href
);
const { AuthWeakPasswordError, AuthApiError } = await import('@supabase/auth-js');

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

// El mensaje literal de auth_logs, 02-oct-2026 04:18:31 UTC.
const MENSAJE_DE_HOY = 'Password is known to be weak and easy to guess, please choose a different one.';

caso('el error real de hoy (weak_password, pwned) es filtrada', () => {
  assert.equal(esContrasenaFiltrada(new AuthWeakPasswordError(MENSAJE_DE_HOY, 422, ['pwned'])), true);
});

caso('la regex vieja NO casaba con el mensaje de hoy (el bug, reproducido)', () => {
  assert.equal(/leaked|pwned|compromised|common password/i.test(MENSAJE_DE_HOY), false);
});

caso('pwned junto con otras razones sigue siendo filtrada', () => {
  assert.equal(esContrasenaFiltrada(new AuthWeakPasswordError('x', 422, ['length', 'pwned'])), true);
});

caso('debil por longitud o caracteres NO es filtrada (merece otro mensaje)', () => {
  assert.equal(esContrasenaFiltrada(new AuthWeakPasswordError('Password should be at least 8 characters.', 422, ['length'])), false);
  assert.equal(esContrasenaFiltrada(new AuthWeakPasswordError('x', 422, ['characters'])), false);
});

caso('el codigo manda sobre el texto: un mensaje que menciona "leaked" pero con razon length no es filtrada', () => {
  assert.equal(esContrasenaFiltrada(new AuthWeakPasswordError('leaked', 422, ['length'])), false);
});

caso('un error ya envuelto en new Error(mensaje) se reconoce por el texto', () => {
  assert.equal(esContrasenaFiltrada(new Error(MENSAJE_DE_HOY)), true);
});

caso('otros errores de auth no son filtrada', () => {
  assert.equal(esContrasenaFiltrada(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')), false);
  assert.equal(esContrasenaFiltrada(new Error('NO_SE_PUDO_VERIFICAR_CORREO')), false);
});

caso('null, undefined y no-objetos no truenan', () => {
  for (const v of [null, undefined, 'pwned', 42]) assert.equal(esContrasenaFiltrada(v), false);
});

// --- Guardias -----------------------------------------------------------------

const archivos = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});

caso('nadie en src/ decide "contrasena filtrada" con su propia regex', () => {
  const helper = path.join(RAIZ, 'src', 'lib', 'contrasenaFiltrada.ts');
  const copias = archivos(path.join(RAIZ, 'src'))
    .filter((p) => p !== helper)
    .filter((p) => /leaked\|pwned|isLeakedPasswordError/.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(RAIZ, p));
  assert.deepEqual(copias, [], `Usa esContrasenaFiltrada de src/lib/contrasenaFiltrada.ts en: ${copias.join(', ')}`);
});

caso('verify-reset-code reconoce weak_password por el codigo', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'verify-reset-code', 'index.ts'), 'utf8');
  assert.match(fuente, /code === "weak_password"/);
  assert.match(fuente, /reasons\.includes\("pwned"\)/);
});

console.log(`\n${casos} casos OK: contrasena filtrada se reconoce por el codigo del error.`);
