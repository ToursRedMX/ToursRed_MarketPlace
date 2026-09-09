#!/usr/bin/env node
/**
 * Contador de consultas a Supabase que ignoran el error — F-1 de la auditoria
 * de frontend (05-sep-2026).
 *
 * QUE CUENTA
 *
 * Sitios con la forma `const { ... } = await supabase...` en los que la
 * desestructuracion NO pide `error`.
 *
 * POR QUE IMPORTA
 *
 * Cuando la consulta falla, `data` llega `null`, el componente pinta la lista
 * vacia o su estado inicial, y el usuario ve una pantalla que PARECE correcta y
 * esta mal. No hay error en consola, no hay reintento, no hay mensaje. Es el
 * defecto que mas probablemente se vea en produccion despues del lanzamiento y
 * el mas dificil de diagnosticar: el reporte sera "no me aparecen los
 * asientos", sin nada en los logs.
 *
 * En los casos peores ni siquiera pinta vacio: pinta MAL. En `SeatMapPicker`,
 * un fallo dejaba `statusData = []` y todos los asientos aparecian LIBRES.
 *
 * POR QUE ES UN CONTADOR Y NO UNA GUARDIA EN CERO
 *
 * Son 247 sitios. Arreglarlos todos de golpe seria un cambio enorme e
 * irrevisable, y una parte son intencionales (widgets opcionales donde fallar
 * en silencio es lo correcto: un banner que no se pinta, un contador que no
 * aparece). El propio hallazgo dice que el triage es el primer paso.
 *
 * Asi que esto funciona como el contador de `lint`: no exige bajar, pero
 * IMPIDE SUBIR. La deuda deja de crecer mientras se paga por tramos.
 *
 * COMO BAJAR LA LINEA BASE
 *
 * Al arreglar sitios, corre esto, toma el numero nuevo y actualiza LINEA_BASE.
 * El script te lo recuerda cuando detecta menos de los esperados.
 *
 * Uso:
 *   node scripts/check-supabase-errors.mjs           cuenta y compara
 *   node scripts/check-supabase-errors.mjs --lista   ademas lista los sitios
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Historial de bajadas:
//   262  medicion inicial (05-sep-2026)
//   247  08-sep: tier 1 — flujo de reserva, mapa de asientos, facturas del
//        viajero, documentos de agencia
//   234  09-sep: tier 2 — los dos archivos que cortan TODO el producto
//        (src/lib/supabase.ts y src/context/AuthContext.tsx) mas los mensajes
//        de las dos pantallas de alta. Ver el commit para el detalle: dos de
//        esos sitios no pintaban vacio, CONCEDIAN de mas.
//   191  09-sep: tier 3 — el camino completo del viajero, que es el que van a
//        recorrer las UAT: facturas, reservas, billetera, pago exitoso,
//        detalle y catalogo de tours, y el formulario de reserva. 43 sitios.
//   188  09-sep: MfaGate dejaba de exigir el segundo factor si fallaba la
//        lectura de platform_settings.
//   175  09-sep: src/lib/supabase.ts completo — busqueda por destino,
//        manifiesto de pasajeros, borrado de categorias y las cuatro
//        lecturas de la politica de cancelacion.
//   166  09-sep: los componentes de seguridad — mantenimiento, ajustes de
//        MFA, passkeys y el panel de interruptores de seguridad.
//   154  09-sep: pagos a agencias, conciliacion de OpenPay y el sync
//        contable. Aqui salio ademas la destructuracion mala de
//        getSession() que dejaba tres llamadas sin Authorization.
//   145  09-sep: la pantalla de contabilidad. Ahi un cero por error de
//        lectura se ve igual que un cero de verdad.
const LINEA_BASE = Number(process.env.BASELINE_SUPABASE_ERRORS ?? 145);

const DESTR = /const\s*\{([^}]*)\}\s*=\s*await\s+supabase\b/gm;

function* archivos(dir) {
  for (const e of readdirSync(dir)) {
    const ruta = join(dir, e);
    if (statSync(ruta).isDirectory()) yield* archivos(ruta);
    else if (/\.tsx?$/.test(e)) yield ruta;
  }
}

const sitios = [];
for (const ruta of archivos("src")) {
  const txt = readFileSync(ruta, "utf8");
  for (const m of txt.matchAll(DESTR)) {
    if (/\berror\b/.test(m[1])) continue;
    const linea = txt.slice(0, m.index).split("\n").length;
    sitios.push({ ruta, linea, campos: m[1].replace(/\s+/g, " ").trim() });
  }
}

const n = sitios.length;
console.log(`Consultas a Supabase que ignoran el error`);
console.log(`  encontradas   ${n}`);
console.log(`  linea base    ${LINEA_BASE}`);

if (process.argv.includes("--lista")) {
  console.log("");
  for (const s of sitios) console.log(`  ${s.ruta}:${s.linea}  { ${s.campos} }`);
}

if (n > LINEA_BASE) {
  const nuevos = n - LINEA_BASE;
  console.error(`
FALLA: ${nuevos} consulta(s) nueva(s) sin manejo de error.

Cuando una consulta a Supabase falla, \`data\` llega null y el componente pinta
su estado vacio. El usuario ve una pantalla que parece correcta y esta mal.

Como se arregla:

    const { data, error } = await supabase.from('tabla').select('...');
    if (error) {
      console.error('[Componente] que no se pudo leer:', error);
      setError('Mensaje para el usuario, con que puede hacer al respecto.');
      return;
    }

Si en ESTE caso fallar en silencio es lo correcto —un widget opcional, un
badge— igual desestructura \`error\` y deja al menos el console.error, con un
comentario de por que no se le dice al usuario.

Corre con --lista para verlos todos.`);
  process.exit(1);
}

if (n < LINEA_BASE) {
  console.log(`
Bajaron ${LINEA_BASE - n}. Actualiza LINEA_BASE a ${n} en este archivo para
que no puedan volver a subir hasta ahi.`);
}

console.log("\nOK: la deuda no crecio.");
