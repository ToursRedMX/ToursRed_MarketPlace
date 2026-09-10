/**
 * El MFA del panel pide un challenge FRESCO en cada verificacion.
 *
 * ============================================================================
 * EL FALLO QUE ESTO CUBRE, MEDIDO
 * ============================================================================
 *
 * El 10-sep-2026 Axel quedo fuera del panel: metia el codigo correcto de su
 * app autenticadora y GoTrue respondia 422 una y otra vez. El mensaje era
 *
 *     "Challenge and verify IP addresses mismatch"
 *
 * que manda a buscar en la direccion equivocada. Los logs de auth de ese rato:
 *
 *     19:16:34  POST /factors/.../challenge  200
 *     19:16:42  POST /factors/.../verify     200   <- entro
 *     19:57:21  POST /factors/.../verify     422
 *     19:57:36  POST /factors/.../verify     422
 *
 * Dos `verify` seguidos SIN un solo `challenge` en medio. Y la IP era
 * 187.190.63.128 en las cuatro peticiones: nunca cambio de red. El problema
 * no era la IP, era que la pantalla reusaba un challenge ya consumido.
 *
 * La causa estaba en el estado de React: `challengeId` sobrevivia, y la vista
 * decidia que mostrar con `{!challengeId ? <boton> : <input>}`. Al volver a
 * exigirse MFA, como ya habia un id viejo, se saltaba el boton que creaba el
 * challenge y mandaba el codigo contra uno muerto.
 *
 * La ruta de ALTA de MFA (`verifyEnrollment`) nunca tuvo el problema, porque
 * siempre pidio challenge y verify pegados. Esta prueba exige que la ruta de
 * entrada diaria haga lo mismo.
 *
 *   node scripts/test-mfa-challenge-fresco.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FUENTE = 'src/components/MfaGate.tsx';
const tsx = readFileSync(FUENTE, 'utf8');

/** Quita comentarios: las guardias miran el codigo, no la explicacion. */
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

const codigo = soloCodigo(tsx);

/** Recorta el cuerpo de un `const NOMBRE = useCallback(async () => { ... }`. */
const recortar = (nombre) => {
  const marca = `const ${nombre} = useCallback(`;
  const inicio = codigo.indexOf(marca);
  assert.notEqual(inicio, -1, `no se encontro ${nombre} en ${FUENTE}`);
  const abre = codigo.indexOf('{', codigo.indexOf('=>', inicio));
  let nivel = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === '{') nivel++;
    else if (codigo[i] === '}') { nivel--; if (nivel === 0) return codigo.slice(inicio, i + 1); }
  }
  throw new Error(`no cerro ${nombre}`);
};

const casos = [];

// --- 1. La entrada diaria pide challenge ANTES de verificar ----------------
casos.push(() => {
  const cuerpo = recortar('verifyChallenge');
  const posChallenge = cuerpo.indexOf('mfa.challenge');
  const posVerify = cuerpo.indexOf('mfa.verify');

  assert.notEqual(posChallenge, -1,
    'verifyChallenge debe pedir un challenge nuevo: uno guardado ya se consumio y GoTrue lo rechaza con un 422 que habla de IPs');
  assert.notEqual(posVerify, -1, 'verifyChallenge debe llamar a mfa.verify');
  assert.ok(posChallenge < posVerify,
    'el challenge debe crearse ANTES del verify, en la misma accion');
});

// --- 2. La ruta de alta sigue haciendo lo mismo ----------------------------
casos.push(() => {
  const cuerpo = recortar('verifyEnrollment');
  assert.ok(cuerpo.indexOf('mfa.challenge') < cuerpo.indexOf('mfa.verify'),
    'verifyEnrollment tambien debe pedir challenge antes de verificar');
});

// --- 3. No vuelve a guardarse un challenge en el estado --------------------
casos.push(() => {
  // Es la raiz del bug: mientras el id viva mas alla de la accion, se puede
  // reusar. Las variables locales dentro de cada funcion estan bien.
  assert.ok(!/useState[^\n]*challengeId/.test(codigo),
    'no debe existir estado `challengeId`: un challenge guardado se queda gastado');
  assert.ok(!/setChallengeId/.test(codigo),
    'no debe existir setChallengeId');
});

// --- 4. La vista no decide con un challenge guardado -----------------------
casos.push(() => {
  assert.ok(!/\{!challengeId \?/.test(codigo),
    'la vista no debe elegir que mostrar segun un challengeId guardado: asi se saltaba el paso que crea el challenge');
  assert.ok(/\{!factorId \?/.test(codigo),
    'la vista debe guiarse por el factor resuelto');
});

// --- 5. Al volver a exigir MFA se empieza de cero --------------------------
casos.push(() => {
  const i = codigo.indexOf("setState('needs_challenge')");
  assert.notEqual(i, -1, "no se encontro el paso a 'needs_challenge'");
  const antes = codigo.slice(Math.max(0, i - 200), i);
  assert.ok(/setFactorId\(''\)/.test(antes),
    "al pasar a 'needs_challenge' hay que limpiar el factor, para que la pantalla no herede un estado a medias");
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`MFA challenge fresco: ${ok}/${casos.length} casos OK`);
