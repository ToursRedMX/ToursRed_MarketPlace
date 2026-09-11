#!/usr/bin/env node
/**
 * Pruebas de la carga masiva de CFDI.
 *
 * ============================================================================
 * LO QUE SE PRUEBA: TODO LO QUE FALLA EN SILENCIO
 * ============================================================================
 *
 * Cargar 30 XML de golpe es justo el escenario donde un error no se nota: la
 * pantalla dice «listo» y quedaron 28. Las trampas:
 *
 *   TRAMPA 1 -- el mismo CFDI DOS VECES en la misma seleccion. Los dos archivos
 *   se leen perfectamente bien y proponen gastos validos; el segundo INSERT
 *   choca contra el indice unico de `cfdi_uuid`. Si el lote se inserta de
 *   golpe, ese error se lleva por delante a los demas. Caso 3.
 *
 *   TRAMPA 2 -- un CFDI en moneda extranjera SIN tipo de cambio. La columna no
 *   admite 0 ni NULL, asi que hay que meter un 1 de relleno. Ese 1 registrado
 *   asentaria dolares como pesos. Tiene que entrar MARCADO, nunca callado.
 *   Caso 5, que es el que mas importa: es el unico donde el dato entra MAL a
 *   proposito y la unica defensa es el aviso.
 *
 *   TRAMPA 3 -- que un archivo malo tumbe el lote entero. Caso 6.
 *
 *   node scripts/test-carga-masiva-cfdi.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { prepararLoteDeCfdi } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'cargaMasivaCfdi.ts')).href
);

const RFC_MIO = 'TRG250711JWA';
const CUENTA = '601.02';
let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

const cfdi = ({
  uuid = '9b1ac6c4-42fa-43b1-87b2-77d904fafbdd', rfcReceptor = RFC_MIO,
  moneda = 'MXN', tipoCambio = null, total = '232.00', iva = '32.00',
  proveedor = 'TIKTOK MEXICO TECNOLOGIA', fecha = '2026-07-01T11:32:51',
  tipo = 'I',
} = {}) => `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="${fecha}" SubTotal="200.00" Moneda="${moneda}"
  ${tipoCambio === null ? '' : `TipoCambio="${tipoCambio}"`}
  Total="${total}" TipoDeComprobante="${tipo}" LugarExpedicion="11529">
  <cfdi:Emisor Rfc="TMT2011241B9" Nombre="${proveedor}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${rfcReceptor}" Nombre="TOURS RED GLOBAL"
                 RegimenFiscalReceptor="626" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="EA"
                   Descripcion="Publicidad" ValorUnitario="200.00" Importe="200.00" ObjetoImp="02"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${iva}"><cfdi:Traslados>
    <cfdi:Traslado Base="200.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/>
  </cfdi:Traslados></cfdi:Impuestos>
  ${uuid ? `<cfdi:Complemento><tfd:TimbreFiscalDigital
    xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"
    UUID="${uuid}" FechaTimbrado="${fecha}"/></cfdi:Complemento>` : ''}
</cfdi:Comprobante>`;

const arch = (nombre, texto) => ({ nombre, texto });

// ===========================================================================
caso('1. un lote limpio produce un borrador por archivo', () => {
  const lote = prepararLoteDeCfdi([
    arch('a.xml', cfdi({ uuid: '11111111-1111-1111-1111-111111111111' })),
    arch('b.xml', cfdi({ uuid: '22222222-2222-2222-2222-222222222222', proveedor: 'TELCEL' })),
  ], RFC_MIO, CUENTA, new Set());

  assert.equal(lote.listos, 2);
  assert.equal(lote.rechazados, 0);
  assert.equal(lote.borradores.length, 2);
  assert.equal(lote.borradores[0].proveedor, 'TIKTOK MEXICO TECNOLOGIA');
  assert.equal(lote.borradores[1].proveedor, 'TELCEL');
  // El UUID se normaliza a mayusculas, como lo guarda la base.
  assert.equal(lote.borradores[0].cfdi_uuid, '11111111-1111-1111-1111-111111111111'.toUpperCase());
});

caso('2. los importes cuadran con lo que exige el CHECK de la tabla', () => {
  const [b] = prepararLoteDeCfdi([arch('a.xml', cfdi())], RFC_MIO, CUENTA, new Set()).borradores;
  assert.equal(b.total, 232);
  assert.equal(b.iva, 32);
  assert.equal(b.subtotal, 200);
  // `gastos_total_cuadra`: |total - (subtotal + iva)| <= 0.01
  assert.ok(Math.abs(b.total - (b.subtotal + b.iva)) <= 0.01, 'el borrador no pasaria el CHECK');
  // `gastos_total_mxn_positivo` y `gastos_tipo_cambio_positivo`
  assert.ok(b.total_mxn > 0);
  assert.ok(b.tipo_cambio > 0);
  // `gastos_mxn_tipo_cambio_uno`
  assert.equal(b.tipo_cambio, 1);
  assert.equal(b.cuenta_contable, CUENTA);
  // Y el XML entero se conserva: es lo que alimenta el PDF generico.
  assert.ok(b.cfdi_xml.includes('cfdi:Comprobante'));
});

caso('3. el mismo CFDI dos veces EN EL LOTE solo entra una vez', () => {
  // Pasa de verdad con las descargas del portal del SAT. Los dos archivos se
  // leen bien; el segundo INSERT chocaria contra el indice unico.
  const mismo = cfdi({ uuid: '33333333-3333-3333-3333-333333333333' });
  const lote = prepararLoteDeCfdi([
    arch('factura.xml', mismo),
    arch('factura (1).xml', mismo),
  ], RFC_MIO, CUENTA, new Set());

  assert.equal(lote.listos, 1, 'el duplicado del lote se coló');
  assert.equal(lote.rechazados, 1);
  assert.equal(lote.resultados[1].borrador, null);
  assert.match(lote.resultados[1].motivo, /repetido en la seleccion/i);
  // Y el que SI paso es el primero, no el segundo.
  assert.equal(lote.resultados[0].nombre, 'factura.xml');
});

caso('4. un CFDI ya capturado se rechaza con su motivo', () => {
  const uuid = '44444444-4444-4444-4444-444444444444';
  const lote = prepararLoteDeCfdi(
    [arch('vieja.xml', cfdi({ uuid }))],
    RFC_MIO, CUENTA, new Set([uuid.toUpperCase()]),
  );
  assert.equal(lote.listos, 0);
  assert.match(lote.resultados[0].motivo, /ya esta capturado/i);
});

caso('5. dolares sin tipo de cambio entra MARCADO, nunca callado', () => {
  // El unico caso donde el dato entra mal a proposito: la columna exige > 0 y
  // el CFDI no lo trae. El 1 es relleno; registrarlo asentaria USD como MXN.
  const lote = prepararLoteDeCfdi(
    [arch('claude.xml', cfdi({ moneda: 'USD', tipoCambio: null, uuid: '55555555-5555-5555-5555-555555555555' }))],
    RFC_MIO, CUENTA, new Set(),
  );

  assert.equal(lote.listos, 1, 'se rechazo un CFDI que si se puede capturar como borrador');
  const [b] = lote.borradores;
  assert.equal(b.moneda, 'USD');
  assert.equal(b.tipo_cambio, 1, 'la columna no admite 0 ni NULL');

  // LA AFIRMACION QUE IMPORTA: el aviso existe y dice que no se puede registrar.
  const avisos = lote.resultados[0].avisos.join(' | ');
  assert.match(avisos, /tipo de cambio/i, 'entro con tipo de cambio de relleno SIN avisar');
  assert.match(avisos, /no se podra registrar/i, 'el aviso no dice que no se puede registrar');
  assert.match(avisos, /USD/, 'el aviso no dice de que moneda se trata');
});

caso('6. un archivo malo NO tumba a los buenos', () => {
  const lote = prepararLoteDeCfdi([
    arch('bueno1.xml', cfdi({ uuid: '61111111-1111-1111-1111-111111111111' })),
    arch('esto-es-un-pdf.pdf', '%PDF-1.4 no soy un cfdi'),
    arch('vacio.xml', ''),
    arch('de-otro.xml', cfdi({ rfcReceptor: 'XAXX010101000', uuid: '62222222-2222-2222-2222-222222222222' })),
    arch('complemento-de-pago.xml', cfdi({ tipo: 'P', uuid: '63333333-3333-3333-3333-333333333333' })),
    arch('bueno2.xml', cfdi({ uuid: '64444444-4444-4444-4444-444444444444' })),
  ], RFC_MIO, CUENTA, new Set());

  assert.equal(lote.listos, 2, 'los buenos no sobrevivieron al lote');
  assert.equal(lote.rechazados, 4);
  assert.equal(lote.resultados.length, 6, 'se perdio el veredicto de algun archivo');

  // Cada rechazo dice POR QUE, y el motivo es especifico.
  assert.match(lote.resultados[1].motivo, /no parece un CFDI|PDF/i);
  assert.match(lote.resultados[2].motivo, /vacio/i);
  assert.match(lote.resultados[3].motivo, /a nombre de/i);
  assert.match(lote.resultados[4].motivo, /tipo "P"|complemento de pago/i);

  // Y los nombres de archivo se conservan, que es como el usuario los identifica.
  assert.deepEqual(lote.resultados.map((r) => r.nombre), [
    'bueno1.xml', 'esto-es-un-pdf.pdf', 'vacio.xml', 'de-otro.xml',
    'complemento-de-pago.xml', 'bueno2.xml',
  ]);
});

caso('7. un CFDI sin timbrar entra, con su aviso y sin uuid', () => {
  // Sin UUID no choca con el indice unico, que es parcial.
  const lote = prepararLoteDeCfdi([arch('sin-timbre.xml', cfdi({ uuid: '' }))], RFC_MIO, CUENTA, new Set());
  assert.equal(lote.listos, 1);
  assert.equal(lote.borradores[0].cfdi_uuid, null, 'un uuid vacio tiene que ser NULL, no cadena vacia');
  assert.match(lote.resultados[0].avisos.join(' '), /no esta timbrado|UUID/i);
});

caso('8. dos CFDI sin timbrar NO se estorban entre si', () => {
  // El duplicado se detecta por UUID. Sin UUID no hay duplicado que detectar, y
  // si se compararan cadenas vacias el segundo se rechazaria sin razon.
  const lote = prepararLoteDeCfdi([
    arch('a.xml', cfdi({ uuid: '', proveedor: 'UNO' })),
    arch('b.xml', cfdi({ uuid: '', proveedor: 'DOS' })),
  ], RFC_MIO, CUENTA, new Set());
  assert.equal(lote.listos, 2, 'dos CFDI sin timbrar se trataron como duplicados');
});

caso('9. un lote vacio no revienta', () => {
  const lote = prepararLoteDeCfdi([], RFC_MIO, CUENTA, new Set());
  assert.equal(lote.listos, 0);
  assert.equal(lote.rechazados, 0);
  assert.deepEqual(lote.borradores, []);
});

caso('10. el orden de los resultados es el de los archivos', () => {
  // La pantalla los pinta en lista junto al nombre; si se reordenaran, el
  // usuario leeria el motivo equivocado al lado del archivo equivocado.
  const lote = prepararLoteDeCfdi([
    arch('1.xml', 'basura'),
    arch('2.xml', cfdi({ uuid: 'a2222222-2222-2222-2222-222222222222' })),
    arch('3.xml', 'mas basura'),
    arch('4.xml', cfdi({ uuid: 'a4444444-4444-4444-4444-444444444444' })),
  ], RFC_MIO, CUENTA, new Set());

  assert.deepEqual(lote.resultados.map((r) => r.nombre), ['1.xml', '2.xml', '3.xml', '4.xml']);
  assert.deepEqual(lote.resultados.map((r) => r.borrador !== null), [false, true, false, true]);
});

console.log(`\nCarga masiva de CFDI: ${casos}/10 casos OK`);
if (casos !== 10) { console.error('faltaron casos'); process.exit(1); }
