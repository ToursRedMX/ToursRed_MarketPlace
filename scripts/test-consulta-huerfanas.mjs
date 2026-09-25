#!/usr/bin/env node
/**
 * La consulta de migraciones huerfanas no puede quedarse vieja.
 *
 * POR QUE EXISTE
 *
 * `scripts/export-orphan-migrations.sql` lleva incrustada la lista de versiones
 * que YA tienen archivo en el repo, para poder pedirle a la base solo las que
 * NO lo tienen. Esa lista se escribio a mano el 02-sep-2026 con 716 versiones y
 * nadie la volvio a tocar. El 12-sep el repo tenia 912.
 *
 * Eso no es un detalle cosmetico: es el camino de RECUPERACION. Axel decidio el
 * 12-sep-2026 que todos los agentes conserven acceso al Dashboard y que, cuando
 * el ledger se desfase, se baje el SQL de la base y se reconcilie el repo. Con
 * la lista vieja, esa reconciliacion habria declarado huerfanas 200 migraciones
 * —198 de ellas CON archivo— y `import-orphan-migrations.mjs` las habria
 * sobrescrito con su exportacion mecanica, perdiendo la documentacion escrita a
 * mano de cada una. Medido, no supuesto: con el blob de 716 salen 200; con el
 * regenerado salen 2, que son las que de verdad estaban en vuelo.
 *
 * Una red de seguridad que se pudre en silencio es peor que no tenerla, porque
 * se descubre el dia que hace falta.
 *
 * QUE COMPRUEBA
 *
 * Que el blob contenga EXACTAMENTE las versiones de los archivos del repo. Si
 * no, se regenera con `node scripts/generar-consulta-huerfanas.mjs`.
 */
import fs from 'node:fs';

const DIR = 'supabase/migrations';
const SQL = 'scripts/export-orphan-migrations.sql';

const archivos = fs.readdirSync(DIR)
  .map((f) => (f.match(/^(\d{14})_/) || [])[1])
  .filter(Boolean)
  .sort();

if (archivos.length === 0) {
  console.error('ERROR: no se leyo ninguna migracion de ' + DIR + '.');
  console.error('Cero migraciones no es "todo en orden": es que no se leyo nada.');
  process.exit(2);
}

const sql = fs.readFileSync(SQL, 'utf8');
const blob = (sql.match(/select '([0-9,]+)'::text as blob/) || [])[1];
if (!blob) {
  console.error('ERROR: no se hallo el blob de versiones en ' + SQL + '.');
  process.exit(2);
}

const enBlob = new Set(blob.split(','));
const faltan = archivos.filter((v) => !enBlob.has(v));
const sobran = [...enBlob].filter((v) => !archivos.includes(v));

if (faltan.length === 0 && sobran.length === 0) {
  console.log(`Consulta de huerfanas al dia: ${archivos.length} versiones.`);
  process.exit(0);
}

console.error('\n' + '='.repeat(60));
console.error('La consulta de migraciones huerfanas esta VIEJA.');
console.error('');
if (faltan.length) {
  console.error(`  ${faltan.length} migraciones del repo NO estan en la lista.`);
  console.error('  Al reconciliar saldrian como huerfanas y el import las');
  console.error('  SOBRESCRIBIRIA, perdiendo su documentacion. Por ejemplo:');
  faltan.slice(0, 5).forEach((v) => console.error('    ' + v));
}
if (sobran.length) {
  console.error(`  ${sobran.length} versiones de la lista ya no tienen archivo:`);
  sobran.slice(0, 5).forEach((v) => console.error('    ' + v));
}
console.error('');
console.error('  Se arregla con:  node scripts/generar-consulta-huerfanas.mjs');
console.error('='.repeat(60));
process.exit(1);
