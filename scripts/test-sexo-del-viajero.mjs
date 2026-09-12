#!/usr/bin/env node
/**
 * El sexo del viajero: se prellena, se guarda y llega a la aseguradora.
 *
 * ============================================================================
 * EL HUECO QUE ESTO CUBRE, MEDIDO EL 12-SEP-2026
 * ============================================================================
 *
 * Axel pregunto por que el paso 2 le pedia el sexo si ya estaba en su perfil.
 * Eran TRES cosas distintas y la tercera era la grave:
 *
 *   1. El `select` del perfil pedia diez columnas y `sexo` no estaba entre
 *      ellas, asi que a los 6 usuarios que SI lo tienen guardado se les volvia
 *      a pedir. Era el unico campo del formulario sin prellenar.
 *
 *   2. `booking_travelers` NO tenia la columna y `create_booking_atomic` no
 *      mencionaba `sexo` ni una vez: el paso 4 lo mandaba en el payload y se
 *      ignoraba en SILENCIO. Las 44 reservas hechas hasta hoy no lo tienen, y
 *      la aseguradora nunca lo recibio.
 *
 *   3. El perfil ofrece `no_binario` —y hay un usuario con ese valor— pero el
 *      selector del paso 2 solo daba dos opciones, con un cast que afirmaba
 *      un dominio mas estrecho del que existe.
 *
 * ============================================================================
 * LA TRAMPA DEL CASO 5, QUE ES POR LO QUE ESTE ARCHIVO VALE LA PENA
 * ============================================================================
 *
 * El dato viaja por CUATRO sitios en la pantalla y los cuatro tienen que
 * moverse juntos: el `select` que lo trae, el prellenado del titular, la copia
 * del acompanante frecuente, y las opciones del selector.
 *
 * Arreglar solo el prellenado es PEOR que no tocar nada: el campo se pintaria
 * con el valor del perfil y, al elegir un acompanante, se quedaria con el sexo
 * del titular pegado en la fila de otra persona. Un dato equivocado no avisa
 * de nada; uno vacio si.
 *
 *   node scripts/test-sexo-del-viajero.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const paso2  = readFileSync('src/pages/booking-flow/BookingFlowStep2.tsx', 'utf8');
const paso4  = readFileSync('src/pages/booking-flow/BookingFlowStep4.tsx', 'utf8');
const tipos  = readFileSync('src/types/booking-flow.ts', 'utf8');
const compa  = readFileSync('src/types/index.ts', 'utf8');
const xlsx   = readFileSync('supabase/functions/generate-insurance-xlsx/index.ts', 'utf8');
const correo = readFileSync('supabase/functions/send-travel-insurance-notification/index.ts', 'utf8');

/** Los asertos negativos miran el codigo SIN comentarios: si no, se disparan
 *  contra la prosa que explica el arreglo y obligan a no escribir prosa. */
const sinComentarios = (f) =>
  f.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const casos = [];

// --- 1. El perfil se lee CON la columna -------------------------------------
casos.push(() => {
  const select = paso2.match(/\.select\('first_name[^']*'\)/)?.[0] ?? '';
  assert.ok(select, 'no se encontro el select del perfil');
  assert.ok(select.includes('sexo'),
    'el select del perfil no pide `sexo`: sin eso llega undefined y el campo sale vacio aunque este guardado');
});

// --- 2. Y se prellena --------------------------------------------------------
casos.push(() => {
  assert.match(paso2, /sexo: \(userData\.sexo \|\| ''\)/,
    'el prellenado del titular no asigna `sexo`');
});

// --- 3. El acompanante frecuente tambien lo trae -----------------------------
casos.push(() => {
  assert.match(paso2, /sexo: \(companion\.sexo \|\| ''\)/,
    'al elegir un acompanante no se copia su sexo: se quedaria el del titular');
  assert.match(compa, /sexo\?: 'masculino' \| 'femenino' \| 'no_binario';/,
    'FrequentCompanion no declara `sexo`');
});

// --- 4. Las TRES opciones, y sin cast que mienta ------------------------------
casos.push(() => {
  for (const v of ['masculino', 'femenino', 'no_binario']) {
    assert.ok(paso2.includes(`<option value="${v}">`),
      `el selector no ofrece ${v}, que si existe en el perfil y en la base`);
  }
  assert.ok(!/as 'masculino' \| 'femenino' \| ''/.test(sinComentarios(paso2)),
    'quedo el cast que afirmaba un dominio mas estrecho que el real');
  assert.match(tipos, /sexo: 'masculino' \| 'femenino' \| 'no_binario' \| '';/,
    'FlowTraveler.sexo no cubre no_binario');
});

// --- 5. LA TRAMPA: los cuatro sitios a la vez --------------------------------
casos.push(() => {
  const sitios = [
    ['el SELECT del perfil',    /\.select\('first_name[^']*sexo[^']*'\)/],
    ['el PRELLENADO',           /sexo: \(userData\.sexo/],
    ['la copia del ACOMPANANTE',/sexo: \(companion\.sexo/],
    ['las OPCIONES',            /<option value="no_binario">/],
  ];
  for (const [nombre, patron] of sitios) {
    assert.match(paso2, patron,
      `falta ${nombre}. Los cuatro se mueven juntos: a medias, el campo miente en vez de quedarse vacio.`);
  }
});

// --- 6. El paso 4 lo sigue mandando ------------------------------------------
casos.push(() => {
  assert.match(paso4, /sexo: t\.sexo \|\| null,/,
    'el payload dejo de mandar el sexo');
});

// --- 7. Llega a la aseguradora, en los dos caminos ---------------------------
casos.push(() => {
  for (const [nombre, fuente] of [['generate-insurance-xlsx', xlsx],
                                  ['send-travel-insurance-notification', correo]]) {
    assert.ok(fuente.includes('"Sexo",'),
      `${nombre}: falta la cabecera Sexo en la hoja que recibe la aseguradora`);
    assert.match(fuente, /etiquetaDeSexo\(t\.sexo\)/,
      `${nombre}: la cabecera esta pero la fila no la rellena — saldria una columna vacia`);
    assert.match(fuente, /etiquetaDeSexo = \(sexo/,
      `${nombre}: falta el mapeo a la etiqueta`);
    // Y no se manda el valor crudo: la aseguradora recibe "NO BINARIO", no
    // "no_binario". Que la columna exista no sirve si llega en jerga interna.
    assert.ok(fuente.includes('"NO BINARIO"'),
      `${nombre}: no_binario no tiene etiqueta legible`);
  }
  // La que usa un select EXPLICITO tiene que pedir la columna; la otra usa
  // select("*") y la trae sola.
  assert.match(correo, /\.select\("nombre[^"]*sexo"\)/,
    'send-travel-insurance-notification no pide `sexo`: la celda saldria vacia siempre');
});

// --- 8. Un valor desconocido no se cuela --------------------------------------
casos.push(() => {
  for (const fuente of [xlsx, correo]) {
    const mapeo = fuente.match(/const etiquetaDeSexo[\s\S]*?;\n/)?.[0] ?? '';
    assert.ok(/: "";/.test(mapeo),
      'el mapeo no cae en cadena vacia ante un valor desconocido');
    assert.ok(!/sexo\b(?!\s*===)/.test(mapeo.replace(/etiquetaDeSexo|\(sexo:[^)]*\)/g, '')),
      'el mapeo devuelve el valor crudo en algun camino');
  }
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Sexo del viajero: ${ok}/${casos.length} casos OK`);
