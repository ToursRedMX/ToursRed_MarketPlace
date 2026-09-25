// Reescribe scripts/export-orphan-migrations.sql con la lista de versiones
// ACTUAL del repo. Solo toca el blob; el cuerpo de la consulta no se toca.
import fs from 'node:fs';

const DIR = 'supabase/migrations';
const SQL = 'scripts/export-orphan-migrations.sql';

const versiones = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => (f.match(/^(\d{14})_/) || [])[1])
  .filter(Boolean)
  .sort();

if (!versiones.length) { console.error('no se hallaron migraciones'); process.exit(2); }

const texto = fs.readFileSync(SQL, 'utf8');
const nl = texto.includes('\r\n') ? '\r\n' : '\n';

// El blob es la unica linea con `select '...'::text as blob`.
const re = /^(\s*select ')[0-9,]*('::text as blob)$/m;
if (!re.test(texto)) { console.error('no se hallo el blob en ' + SQL); process.exit(2); }

const anterior = (texto.match(re)[0].match(/\d{14}/g) || []).length;
let salida = texto.replace(re, (_, a, b) => a + versiones.join(',') + b);

// La cabecera dice cuantas hay y cuando se genero: se actualiza tambien, porque
// una cifra vieja en un comentario es como se llego a este problema.
salida = salida.replace(
  /^-- La lista de versiones que YA tienen archivo va incrustada abajo \(\d+ al[\s\S]*?-- correr tal cual\..*$/m,
  '-- La lista de versiones que YA tienen archivo va incrustada abajo (' + versiones.length + ' al' + nl +
  '-- ' + new Date().toISOString().slice(0, 10) + '). NO se edita a mano: se regenera con' + nl +
  '--' + nl +
  '--     node scripts/generar-consulta-huerfanas.mjs' + nl +
  '--' + nl +
  '-- y ese script la lee del repo. Estuvo incrustada a mano desde el 02-sep-2026' + nl +
  '-- con 716 versiones; para el 12-sep el repo tenia 912, asi que la consulta' + nl +
  '-- habria declarado huerfanas 196 migraciones que SI tenian archivo, y el' + nl +
  '-- import las habria sobrescrito con su exportacion mecanica, perdiendo la' + nl +
  '-- documentacion escrita a mano de cada una. Correr el generador ANTES de usar' + nl +
  '-- esta consulta.'
);

fs.writeFileSync(SQL, salida);
console.log('blob: ' + anterior + ' -> ' + versiones.length + ' versiones');
