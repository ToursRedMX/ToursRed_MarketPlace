/**
 * La tasa de comision que ve y guarda AdminAgencies sale de la configuracion,
 * no de un 10% clavado en el codigo.
 *
 * ============================================================================
 * QUE PASABA
 * ============================================================================
 *
 * `src/pages/admin/AdminAgencies.tsx` resolvia la tasa de cada agencia con
 * `agency.commission_rate || 0.10` en cinco sitios distintos (el estado inicial
 * del formulario, `openEditModal`, el input, el promedio de las estadisticas y
 * la celda de la tabla). Eso tiene dos fallos encadenados:
 *
 * 1. EL DEFAULT ESTABA MAL. 10% es un dato viejo. El default real vive en
 *    `platform_settings.agency_commission_percentage` y hoy es 15%. Con el
 *    valor clavado, el dia que se cambie la configuracion el front sigue
 *    diciendo otra cosa y nadie se entera, porque no falla: solo miente.
 *
 * 2. `||` TRATA EL 0 COMO AUSENTE. Y 0% es un acuerdo legitimo -- el propio
 *    input de la pantalla lo acepta (`Math.max(0, parsed)`). El resultado es
 *    un bug de ida y vuelta que se puede describir en una linea: pactas 0%,
 *    guardas, reabres la ficha y ves 10%; si guardas cualquier otro campo,
 *    ese 10% se escribe en la base. La agencia empieza a pagar una comision
 *    que nadie acordo.
 *
 * Al 10-sep-2026 ninguna de las 5 agencias tiene la tasa en 0 ni en NULL, asi
 * que el dano todavia no ocurrio. Es una trampa armada, no un incendio.
 *
 * Que NULL sea alcanzable no es teorico: la migracion 20260703020012 le quito
 * a `agencies.commission_rate` el NOT NULL y el DEFAULT, y lo sustituyo por un
 * trigger BEFORE INSERT. Un UPDATE que deje la columna en NULL la deja en NULL.
 *
 *   node scripts/test-tasa-comision-agencia.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const FUENTE = 'src/pages/admin/AdminAgencies.tsx';   // la pantalla
const HELPER = 'src/utils/comisionAgencia.ts';        // el resolvedor
const codigo = readFileSync(FUENTE, 'utf8');
const codigoHelper = readFileSync(HELPER, 'utf8');

/**
 * Quita comentarios de linea y de bloque.
 *
 * No es cosmetico. Las guardias de texto de mas abajo buscan `|| 0.10`, y este
 * mismo archivo explica en su documentacion por que ese patron estaba mal --
 * o sea que la guardia se dispararia con su propia explicacion. Ya paso dos
 * veces en esta auditoria. Se compara contra el codigo, no contra la prosa.
 */
const soloCodigo = (texto) => {
  let fuera = '';
  for (let i = 0; i < texto.length; i++) {
    const par = texto.slice(i, i + 2);
    if (par === '//') { const f = texto.indexOf('\n', i); if (f === -1) break; i = f; fuera += '\n'; continue; }
    if (par === '/*') { const f = texto.indexOf('*/', i); if (f === -1) break; i = f + 1; continue; }
    fuera += texto[i];
  }
  return fuera;
};

// Las guardias de texto miran las DOS: el resolvedor no sirve de nada si la
// pantalla se salta una llamada y vuelve a poner su propio fallback.
const cuerpo = soloCodigo(codigo) + '\n' + soloCodigo(codigoHelper);

/** Recorta `export const NOMBRE = (...) => { ... }` contando llaves. */
function recortarArrow(fuente, nombre, archivo) {
  const marca = `export const ${nombre} = (`;
  const inicio = fuente.indexOf(marca);
  assert.notEqual(inicio, -1, `no se encontro ${nombre} en ${archivo}`);
  const abre = fuente.indexOf('=> {', inicio) + 3;
  let nivel = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}') { nivel--; if (nivel === 0) return fuente.slice(inicio, i + 1); }
  }
  throw new Error(`no cerro ${nombre}`);
}

// Se evalua la funcion REAL del archivo, no una copia escrita aqui. Una copia
// probaria que la copia esta bien.
const fuenteTs = recortarArrow(codigoHelper, 'tasaEfectivaAgencia', HELPER).replace(/^export /, '');
const js = ts.transpileModule(fuenteTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const ctx = { Number, parseFloat };
vm.createContext(ctx);
vm.runInContext(`${js}; globalThis.__fn = tasaEfectivaAgencia;`, ctx);
const tasa = ctx.__fn;

const DEFAULT_PLATAFORMA = 15; // platform_settings.agency_commission_percentage, 10-sep-2026
const casos = [];

// --- 1. Una tasa pactada se respeta tal cual -------------------------------
casos.push(() => {
  assert.equal(tasa(0.10, DEFAULT_PLATAFORMA), 0.10, 'AVENTOURAX tiene 10% por contrato');
  assert.equal(tasa(0.15, DEFAULT_PLATAFORMA), 0.15, "MA A'LOB KI'IN tiene 15%");
  assert.equal(tasa(0.18, DEFAULT_PLATAFORMA), 0.18);
});

// --- 2. EL BUG: 0% pactado tiene que sobrevivir ----------------------------
casos.push(() => {
  assert.equal(tasa(0, DEFAULT_PLATAFORMA), 0,
    'con `|| 0.10` un 0% pactado se convertia en 10% al reabrir la ficha');
});

// --- 3. Sin valor -> el default DE LA CONFIGURACION, no 10% ----------------
casos.push(() => {
  assert.equal(tasa(null, DEFAULT_PLATAFORMA), 0.15,
    'null debe caer al default de plataforma (15%), no al 10% viejo');
  assert.equal(tasa(undefined, DEFAULT_PLATAFORMA), 0.15);
  assert.notEqual(tasa(null, DEFAULT_PLATAFORMA), 0.10);
});

// --- 4. El default SIGUE a la configuracion --------------------------------
casos.push(() => {
  // Si Axel sube el default a 18% en AdminSettings, el front tiene que moverse
  // solo. Este caso es el que falla si alguien vuelve a clavar un numero.
  assert.equal(tasa(null, 18), 0.18);
  assert.equal(tasa(null, 12), 0.12);
  assert.equal(tasa(null, 0), 0, 'un default de 0% configurado tambien es valido');
});

// --- 5. PostgREST devuelve numeric como string -----------------------------
casos.push(() => {
  // Por eso el codigo original tenia `parseFloat(a.commission_rate)` en dos de
  // los cinco sitios y no en los otros tres. Aqui se cubren los dos formatos.
  assert.equal(tasa('0.10', DEFAULT_PLATAFORMA), 0.10);
  assert.equal(tasa('0', DEFAULT_PLATAFORMA), 0, 'el string "0" tampoco es ausencia');
});

// --- 6. Texto invalido no puede pintar NaN en pantalla ---------------------
casos.push(() => {
  // `NaN || 0.10` daba 0.10, o sea que el `||` tapaba esto por accidente. Al
  // pasar a `??` deja de taparse solo y hay que tratarlo a proposito.
  assert.equal(tasa('', DEFAULT_PLATAFORMA), 0.15);
  assert.equal(tasa('n/a', DEFAULT_PLATAFORMA), 0.15);
  assert.ok(!Number.isNaN(tasa('n/a', DEFAULT_PLATAFORMA)));
});

// --- 7. No vuelve el 10% clavado -------------------------------------------
casos.push(() => {
  const sitios = cuerpo.match(/\|\|\s*0\.10\b/g) || [];
  assert.equal(sitios.length, 0,
    `volvio el fallback clavado \`|| 0.10\` en ${FUENTE} (${sitios.length} sitio(s))`);
  assert.equal((cuerpo.match(/\?\?\s*0\.10\b/g) || []).length, 0,
    'un `?? 0.10` arregla el 0 pero deja el default viejo: tambien esta mal');
});

// --- 8. Todos los sitios pasan por el resolver -----------------------------
casos.push(() => {
  // Cinco lecturas de `commission_rate` en el componente tienen que resolverse
  // con el helper. Si alguien agrega una sexta con su propio fallback, esto no
  // lo detecta por si solo -- pero el caso 7 si detecta el patron que usaria.
  const usos = (cuerpo.match(/tasaEfectivaAgencia\(/g) || []).length;
  assert.ok(usos >= 6, `se esperaban >= 6 usos de tasaEfectivaAgencia, hay ${usos}`);
});

// --- 9. El default de plataforma se carga sin descartar el 0 ---------------
casos.push(() => {
  assert.ok(/agency_commission_percentage\s*!=\s*null/.test(cuerpo),
    'la carga de platform_settings debe usar `!= null`: con `if (data?.x)` un default de 0% configurado se descartaba');
  assert.ok(!/if\s*\(data\?\.agency_commission_percentage\)/.test(cuerpo),
    'volvio la comprobacion por veracidad al cargar el default');
});

// --- 10. La pantalla usa el resolvedor compartido, no una copia -----------
casos.push(() => {
  assert.ok(/import \{ tasaEfectivaAgencia \} from '\.\.\/\.\.\/utils\/comisionAgencia'/.test(cuerpo),
    'AdminAgencies debe importar el resolvedor de src/utils/comisionAgencia.ts');
  assert.equal((soloCodigo(codigo).match(/export const tasaEfectivaAgencia/g) || []).length, 0,
    'el resolvedor vive en su propio modulo, no dentro de la pantalla');
});

// --- 11. El placeholder del input no miente --------------------------------
casos.push(() => {
  assert.ok(!/placeholder="Ej: 10"/.test(cuerpo),
    'el placeholder decia "Ej: 10" con el default en 15%');
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Tasa de comision de agencia: ${ok}/${casos.length} casos OK`);
