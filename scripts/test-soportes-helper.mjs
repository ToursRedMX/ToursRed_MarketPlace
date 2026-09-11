#!/usr/bin/env node
/**
 * Pruebas del constructor de rutas de los soportes.
 *
 * ============================================================================
 * POR QUE ESTO SE PRUEBA Y NO SE MIRA A OJO
 * ============================================================================
 *
 * El nombre del archivo viene del disco de quien sube. Puede traer `../`,
 * acentos, espacios, emojis, comillas o 300 caracteres. Con ese nombre se arma
 * la LLAVE del objeto en Storage, y ahi:
 *
 *   * un `..` es una travesia de directorios: el archivo termina fuera de la
 *     carpeta del gasto, o pisando el de otro;
 *   * un caracter raro lo rechaza Storage —o peor, lo acepta y despues no se
 *     puede volver a referenciar—;
 *   * un nombre vacio produce una llave que termina en `/`, que no es un
 *     objeto.
 *
 * Se prueba tambien que la EXTENSION sobreviva: es lo unico que el navegador
 * mira para decidir si abre el PDF o lo descarga como binario anonimo.
 *
 *   node scripts/test-soportes-helper.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { nombreSeguro, rutaDeSoporte, porQueNoSePuedeSubir, BYTES_MAXIMOS } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'soportesDeGasto.ts')).href
);

const GASTO = '23267168-c698-4e64-a095-8c1fcc4edf53';
let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

caso('1. un nombre normal se conserva reconocible, con su extension', () => {
  assert.equal(nombreSeguro('factura.pdf'), 'factura.pdf');
  assert.equal(nombreSeguro('CFDI_518070.xml'), 'CFDI_518070.xml');
  assert.equal(nombreSeguro('recibo-de-pago.PDF'), 'recibo-de-pago.PDF');
});

caso('2. NINGUNA travesia de directorios sobrevive', () => {
  // La afirmacion que de verdad importa: ni `..` ni `/` pueden quedar.
  for (const feo of [
    '../../../etc/passwd',
    '..%2f..%2fsecreto.pdf',
    'a/../../b.pdf',
    '....//factura.pdf',
    '/absoluta/factura.pdf',
  ]) {
    const r = nombreSeguro(feo);
    assert.ok(!r.includes('..'), `«${feo}» dejo un «..»: ${r}`);
    assert.ok(!r.includes('/'), `«${feo}» dejo una barra: ${r}`);
    assert.ok(!r.startsWith('.'), `«${feo}» empieza con punto: ${r}`);
  }
});

caso('3. acentos, espacios y emojis quedan en algo imprimible', () => {
  assert.equal(nombreSeguro('Factura México.pdf'), 'Factura-Mexico.pdf');
  assert.equal(nombreSeguro('mi factura (1).pdf'), 'mi-factura-1-.pdf');
  const conEmoji = nombreSeguro('recibo 🧾.pdf');
  assert.ok(/^[A-Za-z0-9._-]+$/.test(conEmoji), `quedaron caracteres raros: ${conEmoji}`);
  assert.ok(conEmoji.endsWith('.pdf'), 'se perdio la extension');
});

caso('4. un nombre imposible no produce una llave rota', () => {
  // Sin esto la llave terminaria en `/`, que no es un objeto.
  assert.equal(nombreSeguro(''), 'archivo');
  assert.equal(nombreSeguro('   '), 'archivo');
  assert.equal(nombreSeguro('...'), 'archivo');
  assert.equal(nombreSeguro('///'), 'archivo');
  assert.equal(nombreSeguro(null), 'archivo');
});

caso('5. un nombre larguisimo se corta', () => {
  const largo = 'a'.repeat(300) + '.pdf';
  const r = nombreSeguro(largo);
  assert.ok(r.length <= 80, `quedo en ${r.length} caracteres`);
});

caso('6. la ruta agrupa por gasto y no choca consigo misma', () => {
  const r1 = rutaDeSoporte(GASTO, 'factura.pdf', 1000);
  const r2 = rutaDeSoporte(GASTO, 'factura.pdf', 2000);

  assert.ok(r1.startsWith(`${GASTO}/`), 'la ruta no agrupa por gasto');
  assert.notEqual(r1, r2, 'subir el mismo archivo dos veces chocaria contra el UNIQUE');
  assert.equal(r1, `${GASTO}/1000-factura.pdf`);

  // Y exactamente UNA barra: la que separa el gasto del archivo.
  assert.equal(r1.split('/').length, 2, `la ruta tiene niveles de mas: ${r1}`);
});

caso('7. una ruta con nombre hostil sigue teniendo una sola barra', () => {
  const r = rutaDeSoporte(GASTO, '../../../etc/passwd', 1000);
  assert.equal(r.split('/').length, 2, `se escapo de la carpeta del gasto: ${r}`);
  assert.ok(r.startsWith(`${GASTO}/`));
});

caso('8. el tamano se rechaza ANTES de subir', () => {
  assert.equal(porQueNoSePuedeSubir({ type: 'application/pdf', size: 5000 }), null);
  assert.match(porQueNoSePuedeSubir({ type: 'application/pdf', size: BYTES_MAXIMOS + 1 }), /10 MB/);
  assert.match(porQueNoSePuedeSubir({ type: 'application/pdf', size: 0 }), /vacio/i);
});

caso('9. un tipo que el bucket no acepta se rechaza con su nombre', () => {
  const r = porQueNoSePuedeSubir({ type: 'application/zip', size: 1000 });
  assert.match(r, /application\/zip/);
  // Un tipo vacio SI pasa: hay sistemas que no lo reconocen y manda el bucket.
  assert.equal(porQueNoSePuedeSubir({ type: '', size: 1000 }), null);
});

caso('10. los tipos que la migracion declara son los que acepta el codigo', () => {
  // Si los dos se separan, el usuario ve «subiendo...» y luego un error del
  // bucket que no dice nada util.
  for (const t of ['application/pdf', 'text/xml', 'application/xml', 'image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(porQueNoSePuedeSubir({ type: t, size: 1000 }), null, `el codigo rechaza ${t} y el bucket lo acepta`);
  }
});

console.log(`\nSoportes de gasto (rutas): ${casos}/10 casos OK`);
if (casos !== 10) { console.error('faltaron casos'); process.exit(1); }
