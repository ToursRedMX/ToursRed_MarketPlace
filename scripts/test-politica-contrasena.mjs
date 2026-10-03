// `verify-reset-code` aceptaba contrasenas de 6 caracteres sin exigir nada
// mas (pendiente 3 de la entrada 33). Al investigarlo salio que la regla de
// 6 caracteres era la misma en 6 lugares del repo -- consistente, pero floja
// -- y que una septima (FirstLoginPasswordGate) y una octava (ExecutivePerfil)
// ya habian subido a 8 por su cuenta, cada una con su propia copia. Axel
// decidio subir el minimo a 8 + mayuscula + minuscula + numero EN TODA LA
// APP (no solo el reset), asi que se centralizo en politicaContrasena.ts
// (src/ y su copia en _shared/, que no importa de src/) y se aplico en los
// ~20 lugares que crean o cambian una contrasena elegida por una persona
// (no los que GENERAN una temporal, que ya eran mas fuertes que el minimo).
//
// Esta prueba corre las DOS copias (deben ser identicas) y hace una guardia
// estatica: ningun archivo de src/ o supabase/functions/ debe volver a
// comparar una contrasena contra 6 caracteres.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function cargar(ruta) {
  const fuente = readFileSync(ruta, 'utf8');
  const compilado = ts.transpileModule(fuente, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compilado, { exports, module: { exports } });
  return exports;
}

let casos = 0;
for (const ruta of ['src/lib/politicaContrasena.ts', 'supabase/functions/_shared/politicaContrasena.ts']) {
  const { validarContrasena, LONGITUD_MINIMA_CONTRASENA } = cargar(ruta);
  assert.equal(LONGITUD_MINIMA_CONTRASENA, 8, ruta);

  for (const [password, debeFallar, motivo] of [
    ['Abcdef1', true, 'longitud: 7 caracteres'],
    ['abcdefg1', true, 'sin mayuscula'],
    ['ABCDEFG1', true, 'sin minuscula'],
    ['Abcdefgh', true, 'sin numero'],
    ['Abcdefg1', false, 'cumple las cuatro reglas'],
    ['Contrasena8', false, 'mas larga, igual cumple'],
  ]) {
    const error = validarContrasena(password);
    if (debeFallar) {
      assert.ok(error, `${ruta}: "${password}" deberia fallar (${motivo}) y no fallo`);
    } else {
      assert.equal(error, null, `${ruta}: "${password}" deberia pasar (${motivo}) y dio: ${error}`);
    }
    casos++;
  }

  // El viejo minimo de 6 ya NO debe aceptarse en ninguna copia.
  assert.ok(validarContrasena('Abc123'), `${ruta}: una contrasena de 6 caracteres ya no deberia aceptarse`);
  casos++;
}
console.log(`validarContrasena: ${casos} casos en ambas copias (src/ y _shared/).`);

// Guardia estatica: nada debe volver a comparar contra 6 caracteres. Los que
// GENERAN una temporal (generateTempPassword) no cuentan: ya son mas fuertes
// que el minimo y no la piden al elegirla, la fabrican.
let archivosConUmbralViejo = 0;
function recorrer(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
    const ruta = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) { recorrer(ruta); continue; }
    if (!/\.(ts|tsx)$/.test(entrada.name)) continue;
    const contenido = readFileSync(ruta, 'utf8');
    // Case-insensitive: las variables son `newPassword`, `password`, no solo
    // "password" en minusculas. [^\n]{0,60} para no cruzar de linea y no
    // atrapar un .length < 6 que no tenga nada que ver (ej. un codigo de 6
    // digitos usa !==, no <, asi que no entra aqui de todos modos).
    if (/(password|contrase[ñn]a)[^\n]{0,60}<\s*6\b/i.test(contenido) || /al menos 6 caracteres/i.test(contenido)) {
      console.error(`Umbral viejo de 6 caracteres encontrado en ${ruta}`);
      archivosConUmbralViejo++;
    }
  }
}
recorrer('src');
recorrer('supabase/functions');
assert.equal(archivosConUmbralViejo, 0, 'ver los archivos listados arriba');
console.log('Guardia estatica: ningun archivo compara una contrasena contra el viejo minimo de 6.');
