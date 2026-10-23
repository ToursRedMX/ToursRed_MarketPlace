// Contratos de permisos de las tablas del cobro de notificaciones (migracion 20261023071500).
// El 23-oct-2026 se vio contra la base que `authenticated` tenia INSERT/UPDATE/DELETE/TRUNCATE sobre dos tablas que las migraciones
// solo le concedian de lectura: en Supabase las tablas nuevas de `public` traen permisos POR DEFECTO para `authenticated`, y
// `REVOKE ALL ... FROM PUBLIC, anon` no los quita. El RLS (solo politicas de lectura) lo contenia, pero TRUNCATE no pasa por el RLS.
// Lo que se afirma aqui:
//   1. TODA tabla del cobro que `authenticated` solo lee, tiene revocada su escritura en la migracion de revocacion;
//   2. la revocacion cubre TODOS los permisos de escritura, no solo los comunes, y no toca ni SELECT ni al servicio;
//   3. una tabla NUEVA con `GRANT SELECT ... TO authenticated` y sin revocacion de escritura en ninguna migracion hace fallar esta
//      prueba: es el patron que se nos paso dos veces (la prueba de la fase 1 y la del aviso solo leian lo que yo concedi).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const NOMBRE = '20261023071500_revocar_escritura_de_authenticated_en_tablas_del_cobro.sql';
const revocacion = sinComentarios(leer('supabase/migrations/' + NOMBRE));

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

const ESCRITURA = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABLAS = ['public.avisos_cobro_notificaciones', 'public.suscripciones_notificaciones'];

prueba('la migracion revoca TODA la escritura de authenticated en las dos tablas del cobro', () => {
  for (const t of TABLAS) {
    const re = new RegExp(`REVOKE ([A-Z, ]+) ON ${t.replace('.', '\\.')} FROM authenticated;`);
    const m = revocacion.match(re);
    assert.ok(m, `falta el REVOKE de ${t}`);
    const revocados = m[1].split(',').map((p) => p.trim());
    for (const p of ESCRITURA) assert.ok(revocados.includes(p), `${t}: no revoca ${p}`);
  }
});

prueba('no toca la lectura ni al servicio: nada de SELECT revocado, nada que mire a service_role o anon', () => {
  assert.ok(!/REVOKE[^;]*\bSELECT\b/.test(revocacion), 'SELECT se queda: es la lectura propia de cada usuario');
  assert.ok(!/service_role/.test(revocacion), 'el servicio sigue escribiendo');
  assert.ok(!/\bGRANT\b/.test(revocacion));
  assert.ok(!/FROM[^;]*\b(anon|PUBLIC)\b/.test(revocacion), 'anon y PUBLIC ya estaban cerrados');
});

prueba('toda tabla con GRANT SELECT a authenticated y sin politicas de escritura tiene su revocacion de escritura (el patron que se paso dos veces)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const migraciones = readdirSync(dir).filter((f) => f.endsWith('.sql') && f >= '20261023').sort();
  // Tablas de las que `authenticated` solo debe LEER, segun lo que las migraciones del cobro le conceden: un GRANT SELECT sin
  // INSERT/UPDATE/DELETE en la misma sentencia.
  const soloLectura = new Set();
  for (const f of migraciones) {
    const codigo = sinComentarios(leer('supabase/migrations/' + f));
    for (const m of codigo.matchAll(/GRANT SELECT ON (public\.[a-z_]+) TO authenticated;/g)) soloLectura.add(m[1]);
  }
  assert.ok(soloLectura.size >= 2, 'se encontraron las tablas de solo lectura del cobro');
  for (const t of soloLectura) {
    assert.ok(TABLAS.includes(t) || revocacion.includes(`ON ${t} FROM authenticated`),
      `${t}: authenticated solo la lee, pero ninguna migracion le revoca la escritura por defecto de Supabase`);
  }
  for (const t of TABLAS) assert.ok(soloLectura.has(t), `${t} sigue concedida solo de lectura`);
});

prueba('las migraciones originales no se tocaron: la correccion es una migracion NUEVA (el ledger no cambia de versiones)', () => {
  const fase1 = leer('supabase/migrations/20261023003356_cobro_notificaciones_fase1_control_de_acceso.sql');
  assert.match(fase1, /GRANT SELECT ON public\.suscripciones_notificaciones TO authenticated;/);
  const aviso = leer('supabase/migrations/20261023064502_aviso_previo_cobro_notificaciones.sql');
  assert.match(aviso, /GRANT SELECT ON public\.avisos_cobro_notificaciones TO authenticated;/);
  assert.ok(NOMBRE > '20261023064502', 'es posterior a la ultima migracion del cobro');
});

console.log(`OK: ${casos} casos de los permisos de las tablas del cobro.`);
