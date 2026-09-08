#!/usr/bin/env node
/**
 * Guardia de `search_path` — M-1 de la auditoria de funciones Postgres (05-sep-2026).
 *
 * QUE VIGILA
 *
 * Que ninguna funcion `SECURITY DEFINER` nueva entre al repo sin una clausula
 * `SET search_path` propia.
 *
 * POR QUE
 *
 * En dic-2025 se corrio un ALTER masivo que le puso `SET search_path` a todas
 * las funciones existentes. El problema es que `CREATE OR REPLACE FUNCTION`
 * **reemplaza todos los atributos de la funcion, incluidas sus clausulas SET**.
 * Cualquier funcion recreada despues sin `SET search_path` explicito pierde el
 * ajuste en silencio: no hay error, no hay warning, simplemente vuelve a tener
 * `search_path` mutable. En una funcion `SECURITY DEFINER` eso es un vector de
 * escalada de privilegios.
 *
 * Es una trampa que no avisa, y por eso necesita una guardia y no una nota.
 *
 * POR QUE SOLO MIRA LO QUE TRAE EL PR
 *
 * Escanear las 877 migraciones historicas da 20 hallazgos, todos de funciones
 * definidas ANTES del ALTER masivo y por lo tanto ya arregladas en la base. Se
 * comprobo contra produccion el 08-sep-2026:
 *
 *     SECURITY DEFINER en public ................ 246
 *     ...sin search_path ........................   0
 *
 * O sea que el historico esta limpio y esos 20 serian ruido permanente. Una
 * guardia que nace en 20 se ignora; esta nace en 0 y bloquea de verdad, como
 * `guardia-fiscal`.
 *
 * USO
 *
 *   node scripts/check-search-path.mjs archivo.sql [...]   revisa esos archivos
 *   node scripts/check-search-path.mjs --todo              revisa todas las migraciones
 *
 * Sale con codigo 1 si encuentra una `SECURITY DEFINER` sin `SET search_path`.
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

// Cabecera: desde CREATE ... FUNCTION hasta donde empieza el cuerpo.
// Solo interesa la cabecera: es donde viven SECURITY DEFINER y SET search_path.
const CABECERA = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(([\s\S]*?)\)([\s\S]*?)(?=\bAS\s*\$|\bBEGIN\s+ATOMIC\b)/gi;

const argv = process.argv.slice(2);
const archivos = argv.includes("--todo")
  ? globSync("supabase/migrations/*.sql").sort()
  : argv;

if (archivos.length === 0) {
  console.log("Guardia de search_path: el PR no toca ninguna migracion. Nada que revisar.");
  process.exit(0);
}

const hallazgos = [];
let funcionesVistas = 0;

for (const ruta of archivos) {
  let sql;
  try {
    sql = readFileSync(ruta, "utf8");
  } catch {
    continue; // un archivo borrado en el PR llega en la lista pero ya no existe
  }

  // Se quitan los comentarios de bloque para que un ejemplo dentro de la
  // cabecera de documentacion no cuente como definicion real.
  const limpio = sql.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const m of limpio.matchAll(CABECERA)) {
    funcionesVistas++;
    const nombre = m[1].replaceAll('"', "");
    const args = m[2].replace(/\s+/g, " ").trim();
    const cabecera = m[3];

    const esDefiner = /SECURITY\s+DEFINER/i.test(cabecera);
    const tieneSearchPath = /SET\s+search_path/i.test(cabecera);

    if (esDefiner && !tieneSearchPath) {
      const linea = limpio.slice(0, m.index).split("\n").length;
      hallazgos.push({ ruta, linea, nombre, args });
    }
  }
}

console.log(`Guardia de search_path`);
console.log(`  archivos revisados   ${archivos.length}`);
console.log(`  funciones definidas  ${funcionesVistas}`);
console.log(`  hallazgos            ${hallazgos.length}`);

if (hallazgos.length === 0) {
  console.log("\nOK: ninguna SECURITY DEFINER nueva sin SET search_path.");
  process.exit(0);
}

console.log("\nSECURITY DEFINER sin SET search_path:\n");
for (const h of hallazgos) {
  console.log(`  ${h.ruta}:${h.linea}`);
  console.log(`    ${h.nombre}(${h.args.slice(0, 80)}${h.args.length > 80 ? "..." : ""})`);
}

console.log(`
Como se arregla: anade la clausula a la definicion, antes del cuerpo.

    CREATE OR REPLACE FUNCTION public.ejemplo(p_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public     <-- esta linea
    AS $$ ... $$;

No basta con un ALTER FUNCTION aparte: el siguiente CREATE OR REPLACE lo
volveria a borrar. Tiene que estar en la definicion.`);

process.exit(1);
