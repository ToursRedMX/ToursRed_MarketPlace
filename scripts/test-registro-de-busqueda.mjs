#!/usr/bin/env node
/**
 * Bitacora de busquedas: que se guarda y que NO, segun el consentimiento.
 *
 * Ejercita el modulo REAL `src/utils/registroDeBusqueda.ts` (transpilado, no
 * una copia) y mira el evento que saldria hacia `public.search_events`.
 *
 * Lo que fija:
 *  - sin «todas las cookies», el evento NO lleva sesion, usuario, dispositivo,
 *    idioma ni origen;
 *  - con consentimiento si los lleva;
 *  - una busqueda sin texto (solo filtros) no genera evento;
 *  - un conteo invalido no genera evento (0 SI es valido: es demanda sin resultados);
 *  - las coordenadas de la busqueda por cercania nunca se guardan;
 *  - el texto respeta el tope de 200 caracteres de la tabla.
 *
 * USO
 *
 *   node scripts/test-registro-de-busqueda.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fuente = readFileSync('src/utils/registroDeBusqueda.ts', 'utf8');
const js = ts.transpileModule(fuente, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contexto = { exports: {}, URL };
vm.runInNewContext(js, contexto);
const {
  construirEventoDeBusqueda, textoDeBusqueda, filtrosParaRegistro, dispositivoDeAncho, fuenteDeReferrer,
} = contexto.exports;

// El modulo corre en otro contexto de vm: sus objetos no comparten prototipo
// con los de este archivo y deepStrictEqual los vería distintos. Se compara el JSON.
const igual = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const base = {
  filtros: { destination: '  Oaxaca ', category: 'aventura', minPrice: '500' },
  totalResultados: 0,
  conAnalitica: true,
  sessionId: 'session_123_abc',
  userId: '11111111-2222-4333-8444-555555555555',
  anchoDePantalla: 390,
  idioma: 'es-MX',
  referrer: 'https://www.google.com/',
  hostActual: 'toursred.com.mx',
};

let pruebas = 0;
const prueba = (nombre, fn) => { fn(); pruebas += 1; console.log(`  ok  ${nombre}`); };

prueba('con consentimiento completo lleva sesion, usuario, dispositivo, idioma y origen', () => {
  const e = construirEventoDeBusqueda(base);
  assert.equal(e.query_raw, 'Oaxaca', 'recorta espacios y NO cambia mayusculas: es crudo');
  assert.equal(e.results_count, 0, '0 resultados es un dato valido, no se descarta');
  assert.equal(e.surface, 'tours');
  assert.equal(e.session_id, 'session_123_abc');
  assert.equal(e.user_id, base.userId);
  assert.equal(e.device, 'mobile');
  assert.equal(e.language, 'es-MX');
  assert.equal(e.source, 'google.com');
  igual(e.filters, { campo: 'destination', destination: 'Oaxaca', category: 'aventura', minPrice: '500' });
});

prueba('sin consentimiento NO lleva ningun identificador ni huella', () => {
  const e = construirEventoDeBusqueda({ ...base, conAnalitica: false });
  assert.equal(e.query_raw, 'Oaxaca');
  assert.equal(e.results_count, 0);
  for (const campo of ['session_id', 'user_id', 'device', 'language', 'source']) {
    assert.equal(campo in e, false, `${campo} no debe viajar sin consentimiento`);
  }
});

prueba('una busqueda sin texto (solo filtros) no genera evento', () => {
  assert.equal(construirEventoDeBusqueda({ ...base, filtros: { category: 'aventura', minPrice: '500' } }), null);
  assert.equal(construirEventoDeBusqueda({ ...base, filtros: { destination: '   ', tourName: '' } }), null);
});

prueba('un conteo invalido no genera evento, y 0 si es valido', () => {
  assert.equal(construirEventoDeBusqueda({ ...base, totalResultados: -1 }), null);
  assert.equal(construirEventoDeBusqueda({ ...base, totalResultados: 2.5 }), null);
  assert.equal(construirEventoDeBusqueda({ ...base, totalResultados: Number.NaN }), null);
  assert.equal(construirEventoDeBusqueda({ ...base, totalResultados: 0 }).results_count, 0);
  assert.equal(construirEventoDeBusqueda({ ...base, totalResultados: 7 }).results_count, 7);
});

prueba('el destino pesa mas que el nombre; sin destino se usa el nombre', () => {
  const ambos = textoDeBusqueda({ destination: 'Tlaxcala', tourName: 'Ruta del pulque' });
  assert.equal(ambos.texto, 'Tlaxcala');
  assert.equal(ambos.campo, 'destination');
  const soloNombre = textoDeBusqueda({ tourName: 'Ruta del pulque' });
  assert.equal(soloNombre.texto, 'Ruta del pulque');
  assert.equal(soloNombre.campo, 'tourName');
  assert.equal(textoDeBusqueda({}), null);
});

prueba('las coordenadas de la busqueda por cercania nunca se guardan', () => {
  const f = filtrosParaRegistro({ destination: 'CDMX', lat: '19.4326', lng: '-99.1332', radius: '5', locationName: 'Mi casa' }, 'destination');
  igual(f, { campo: 'destination', destination: 'CDMX', geo: true });
  const serializado = JSON.stringify(f);
  for (const prohibido of ['19.4326', '-99.1332', 'Mi casa']) {
    assert.equal(serializado.includes(prohibido), false, `${prohibido} no debe guardarse`);
  }
});

prueba('el texto respeta el tope de 200 caracteres de la tabla', () => {
  const e = construirEventoDeBusqueda({ ...base, filtros: { destination: 'x'.repeat(500) } });
  assert.equal(e.query_raw.length, 200);
  assert.equal(e.filters.destination.length, 200);
});

prueba('dispositivo por ancho de pantalla', () => {
  assert.equal(dispositivoDeAncho(375), 'mobile');
  assert.equal(dispositivoDeAncho(767), 'mobile');
  assert.equal(dispositivoDeAncho(768), 'tablet');
  assert.equal(dispositivoDeAncho(1023), 'tablet');
  assert.equal(dispositivoDeAncho(1024), 'desktop');
});

prueba('origen: vacio o el propio sitio es directo; si no, el dominio', () => {
  assert.equal(fuenteDeReferrer('', 'toursred.com.mx'), 'directo');
  assert.equal(fuenteDeReferrer(null, 'toursred.com.mx'), 'directo');
  assert.equal(fuenteDeReferrer('https://toursred.com.mx/tours', 'toursred.com.mx'), 'directo');
  assert.equal(fuenteDeReferrer('https://www.toursred.com.mx/', 'toursred.com.mx'), 'directo');
  assert.equal(fuenteDeReferrer('https://l.instagram.com/?u=x', 'toursred.com.mx'), 'l.instagram.com');
  assert.equal(fuenteDeReferrer('no es una url', 'toursred.com.mx'), 'directo');
});

console.log(`\n${pruebas} pruebas pasaron.`);
