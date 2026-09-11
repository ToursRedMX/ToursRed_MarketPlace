#!/usr/bin/env node
/**
 * Pruebas de `leerCfdiCompleto`: la lectura que alimenta la vista del CFDI y
 * el PDF generico.
 *
 * ============================================================================
 * POR QUE ESTE ARCHIVO EXISTE, APARTE DE test-cfdi-xml.mjs
 * ============================================================================
 *
 * `leerCfdiParaGasto` responde «que campos propongo para el gasto» y tira todo
 * lo demas. `leerCfdiCompleto` devuelve el documento entero para MOSTRARLO. Son
 * dos preguntas distintas y se rompen distinto:
 *
 *   TRAMPA 1 -- repartir mal el IVA entre conceptos. El recorredor de XML
 *   guarda el camino por NOMBRE, no por posicion, asi que los traslados de dos
 *   conceptos distintos tienen caminos IDENTICOS. Si se asignan por camino, el
 *   concepto 1 se lleva el IVA de los dos. El caso 2 usa un CFDI con dos
 *   conceptos de IVA distinto y comprueba cada uno por separado.
 *
 *   TRAMPA 2 -- duplicar los impuestos del resumen. Misma trampa que en el
 *   lector de gastos: `Traslado` vive en el concepto Y en el bloque global. El
 *   caso 3 comprueba que el total trasladado sea 160, no 320.
 *
 *   TRAMPA 3 -- ocultar informacion en vez de mostrarla. Un CFDI de otro RFC,
 *   sin timbrar o de tipo P (pago) NO se puede capturar como gasto, pero SI se
 *   tiene que poder leer: es justo cuando quieres verlo. El caso 6 lo exige.
 *
 *   node scripts/test-cfdi-resumen.mjs
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

const { leerCfdiCompleto } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'cfdiXml.ts')).href
);

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

/** Un concepto con sus propios traslados, como los emite cualquier PAC. */
const concepto = (desc, cantidad, valor, importe, iva) => `
    <cfdi:Concepto ClaveProdServ="80141600" Cantidad="${cantidad}" ClaveUnidad="E48"
                   Unidad="Servicio" Descripcion="${desc}" ValorUnitario="${valor}"
                   Importe="${importe}" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${importe}" Impuesto="002" TipoFactor="Tasa"
                         TasaOCuota="0.160000" Importe="${iva}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>`;

/** CFDI 4.0 con dos conceptos, traslados por concepto Y bloque global. */
const cfdiDoble = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Serie="A" Folio="1234" Fecha="2026-07-01T10:30:00" FormaPago="03"
  MetodoPago="PUE" CondicionesDePago="Contado" LugarExpedicion="06600"
  Moneda="MXN" SubTotal="1000.00" Descuento="0.00" Total="1160.00"
  TipoDeComprobante="I" Exportacion="01">
  <cfdi:Emisor Rfc="TMT150101AAA" Nombre="TIKTOK MEXICO TECNOLOGIA" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="TRE210101AB1" Nombre="TOURS RED" RegimenFiscalReceptor="601"
                 UsoCFDI="G03" DomicilioFiscalReceptor="06600"/>
  <cfdi:Conceptos>${concepto('Publicidad en video', '1', '600.00', '600.00', '96.00')}${concepto('Publicidad en feed', '2', '200.00', '400.00', '64.00')}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00">
    <cfdi:Traslados>
      <cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa"
                     TasaOCuota="0.160000" Importe="160.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
      Version="1.1" UUID="9b1ac6c4-42fa-43b1-87b2-77d904fafbdd"
      FechaTimbrado="2026-07-01T10:35:00" RfcProvCertif="PAC010101AAA"
      NoCertificadoSAT="00001000000504465028" SelloCFD="abc==" SelloSAT="def=="/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

caso('1. lee la cabecera, el emisor y el receptor con sus catalogos', () => {
  const r = leerCfdiCompleto(cfdiDoble);
  assert.equal(r.version, '4.0');
  assert.equal(r.serie, 'A');
  assert.equal(r.folio, '1234');
  assert.equal(r.total, 1160);
  assert.equal(r.emisor.nombre, 'TIKTOK MEXICO TECNOLOGIA');
  assert.equal(r.emisor.rfc, 'TMT150101AAA');
  assert.equal(r.emisor.regimenNombre, 'General de Ley Personas Morales');
  assert.equal(r.receptor.usoCfdiNombre, 'Gastos en general');
  assert.equal(r.formaPagoNombre, 'Transferencia electronica de fondos');
  assert.equal(r.metodoPagoNombre, 'Pago en una sola exhibicion');
  assert.equal(r.tipoDeComprobanteNombre, 'ingreso');
});

caso('2. cada concepto se lleva SU iva, no el del vecino', () => {
  const r = leerCfdiCompleto(cfdiDoble);
  assert.equal(r.conceptos.length, 2);

  assert.equal(r.conceptos[0].descripcion, 'Publicidad en video');
  assert.equal(r.conceptos[0].importe, 600);
  assert.equal(r.conceptos[0].cantidad, 1);
  assert.equal(r.conceptos[0].iva, 96, 'el concepto 1 no se quedo con su propio IVA');

  assert.equal(r.conceptos[1].descripcion, 'Publicidad en feed');
  assert.equal(r.conceptos[1].importe, 400);
  assert.equal(r.conceptos[1].cantidad, 2);
  assert.equal(r.conceptos[1].iva, 64, 'el concepto 2 se quedo sin IVA o con el ajeno');

  // Y la suma de los conceptos es el traslado global: ni de mas ni de menos.
  const suma = r.conceptos.reduce((s, c) => s + c.iva, 0);
  assert.equal(suma, 160);
});

caso('3. el impuesto NO se duplica entre el concepto y el bloque global', () => {
  const r = leerCfdiCompleto(cfdiDoble);
  assert.equal(r.traslados.length, 1);
  assert.equal(r.traslados[0].importe, 160, 'sumo los traslados de concepto Y los globales');
  assert.equal(r.traslados[0].nombre, 'IVA');
  assert.equal(r.traslados[0].tasaOCuota, '0.160000');
  assert.equal(r.totalTrasladados, 160);
});

caso('4. el timbre completo, en mayusculas', () => {
  const r = leerCfdiCompleto(cfdiDoble);
  assert.equal(r.timbre.uuid, '9B1AC6C4-42FA-43B1-87B2-77D904FAFBDD');
  assert.equal(r.timbre.fechaTimbrado, '2026-07-01T10:35:00');
  assert.equal(r.timbre.noCertificadoSat, '00001000000504465028');
  assert.equal(r.timbre.rfcProvCertif, 'PAC010101AAA');
});

caso('5. varios renglones del mismo impuesto y tasa se agrupan en uno', () => {
  // Un CFDI con el IVA partido en dos traslados globales de la misma tasa. Si
  // no se agrupara, el PDF sacaria dos renglones «IVA 16%» y el lector daria
  // dos entradas donde el SAT ve una.
  const partido = cfdiDoble.replace(
    '<cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa"\n                     TasaOCuota="0.160000" Importe="160.00"/>',
    '<cfdi:Traslado Base="600.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="96.00"/>'
    + '<cfdi:Traslado Base="400.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="64.00"/>',
  );
  const r = leerCfdiCompleto(partido);
  assert.equal(r.traslados.length, 1, 'no agrupo los traslados de la misma tasa');
  assert.equal(r.traslados[0].base, 1000);
  assert.equal(r.traslados[0].importe, 160);
});

caso('6. un CFDI que NO sirve como gasto se sigue pudiendo LEER', () => {
  // Es el punto de tener dos lecturas. Justo cuando el CFDI no se puede
  // capturar es cuando quieres abrirlo para ver por que.
  const deOtro = cfdiDoble.replace('Rfc="TRE210101AB1"', 'Rfc="XAXX010101000"');
  const r1 = leerCfdiCompleto(deOtro);
  assert.notEqual(r1, null, 'se nego a leer un CFDI de otro RFC');
  assert.equal(r1.receptor.rfc, 'XAXX010101000');

  const dePago = cfdiDoble.replace('TipoDeComprobante="I"', 'TipoDeComprobante="P"');
  const r2 = leerCfdiCompleto(dePago);
  assert.notEqual(r2, null, 'se nego a leer un complemento de pago');
  assert.equal(r2.tipoDeComprobanteNombre, 'pago');

  const sinTimbre = cfdiDoble.replace(/<cfdi:Complemento>[\s\S]*<\/cfdi:Complemento>/, '');
  const r3 = leerCfdiCompleto(sinTimbre);
  assert.notEqual(r3, null, 'se nego a leer un CFDI sin timbrar');
  assert.equal(r3.timbre, null);
  assert.equal(r3.total, 1160, 'perdio los importes al faltar el timbre');
});

caso('7. una clave fuera de catalogo se imprime, no se borra', () => {
  // «G03» vale mas que una cadena vacia. Si el SAT publica una clave nueva, el
  // PDF tiene que seguir diciendo algo.
  const raro = cfdiDoble.replace('UsoCFDI="G03"', 'UsoCFDI="Z99"')
                        .replace('FormaPago="03"', 'FormaPago="77"');
  const r = leerCfdiCompleto(raro);
  assert.equal(r.receptor.usoCfdiNombre, 'Z99');
  assert.equal(r.formaPagoNombre, '77');
});

caso('8. lo que no es un CFDI devuelve null, sin reventar', () => {
  assert.equal(leerCfdiCompleto(''), null);
  assert.equal(leerCfdiCompleto('   '), null);
  assert.equal(leerCfdiCompleto('%PDF-1.4 esto es un pdf'), null);
  assert.equal(leerCfdiCompleto('<html><body>hola</body></html>'), null);
});

caso('9. un CFDI en dolares conserva su tipo de cambio', () => {
  const usd = cfdiDoble.replace('Moneda="MXN"', 'Moneda="USD" TipoCambio="20.50"');
  const r = leerCfdiCompleto(usd);
  assert.equal(r.moneda, 'USD');
  assert.equal(r.tipoCambio, 20.5);
});

caso('10. un CFDI sin conceptos no revienta el reparto de IVA', () => {
  const pelado = cfdiDoble.replace(/<cfdi:Conceptos>[\s\S]*<\/cfdi:Conceptos>/, '<cfdi:Conceptos/>');
  const r = leerCfdiCompleto(pelado);
  assert.equal(r.conceptos.length, 0);
  assert.equal(r.totalTrasladados, 160, 'perdio el impuesto global al no haber conceptos');
});

caso('11. sobrevive a un CFDI real de PAC: sello, certificado y acentos', () => {
  // Las trampas de aqui NO son inventadas: salen de comparar contra un CFDI
  // real de proveedor (TikTok, via Diverza) el 11-sep-2026. El fixture de
  // arriba no las tenia y por eso pasaba sin probar nada de esto.
  //
  //   * `Sello` y `Certificado` son base64 LARGO con `/`, `+` y `=` dentro del
  //     valor del atributo. El recorredor busca comillas, no cualquier signo,
  //     pero eso hay que demostrarlo, no suponerlo.
  //   * `xsi:schemaLocation` trae DOS URLs separadas por un espacio, con `//`
  //     y `:` adentro.
  //   * La descripcion trae acentos en UTF-8.
  //   * Un espacio de nombres extra (`dvz`, la addenda del PAC) que no estorba.
  const sello = 'N2FbQqvmqBCtIBBT/8J+dC3UgF9InZ/ygJ99pOPQDWv//2ApBH+QGoDQ4TlHknT4QM3HwOAAhmXRpgE=';
  const cert = 'MIIGTzCCBDegAwIBAgIUMDAwMDEwMDAwMDA3MTQwMTU4MzcwDQYJKoZIhvcNAQELBQAwggGVMTUwMwYD'
             + 'VQQDDCxBQyBERUwgU0VSVklDSU8gREUgQURNSU5JU1RSQUNJT04gVFJJQlVUQVJJQTEuMCwGA1UECgwl'
             + 'U0VSVklDSU8gREUgQURNSU5JU1RSQUNJT04gVFJJQlVUQVJJQTEaMBgGA1UECwwRU0FULUlFUyBBdXRo'
             + 'b3JpdHkxMjAwBgkqhkiG9w0BCQEWI3NlcnZpY2lvc2FsY29udHJpYnV5ZW50ZUBzYXQuZ29iLm14+/==';
  const real = `<?xml version="1.0" encoding="utf-8"?><cfdi:Comprobante `
    + `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
    + `xmlns:cfdi="http://www.sat.gob.mx/cfd/4" `
    + `xmlns:dvz="http://www.diverza.com/ns/addenda/diverza/1" `
    + `xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" `
    + `Version="4.0" Serie="SMB" Fecha="2026-07-01T11:32:51" Sello="${sello}" `
    + `NoCertificado="00001000000714015837" Certificado="${cert}" `
    + `CondicionesDePago="Payment due in 0 days from the invoice date." `
    + `SubTotal="200.00" Moneda="MXN" TipoCambio="1" Total="232.00" `
    + `TipoDeComprobante="I" Exportacion="01" LugarExpedicion="11529" `
    + `FormaPago="04" MetodoPago="PUE" Folio="518070">`
    + `<cfdi:Emisor Rfc="TMT2011241B9" Nombre="TIKTOK MEXICO TECNOLOGIA" RegimenFiscal="601"/>`
    + `<cfdi:Receptor Rfc="TRG250711JWA" Nombre="TOURS RED GLOBAL" DomicilioFiscalReceptor="11560" `
    + `RegimenFiscalReceptor="626" UsoCFDI="G03"/>`
    + `<cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="EA" `
    + `Descripcion="Venta de espacios publicitarios - M\u00e9xico" ValorUnitario="200.00" Importe="200.00" ObjetoImp="02">`
    + `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="200.00" Impuesto="002" TipoFactor="Tasa" `
    + `TasaOCuota="0.160000" Importe="32.00"/></cfdi:Traslados></cfdi:Impuestos>`
    + `</cfdi:Concepto></cfdi:Conceptos>`
    + `<cfdi:Impuestos TotalImpuestosTrasladados="32.00"><cfdi:Traslados>`
    + `<cfdi:Traslado Base="200.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="32.00"/>`
    + `</cfdi:Traslados></cfdi:Impuestos>`
    + `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" `
    + `Version="1.1" UUID="9b1ac6c4-42fa-43b1-87b2-77d904fafbdd" RfcProvCertif="SNF171020F3A" `
    + `FechaTimbrado="2026-07-01T11:32:53" SelloCFD="${sello}" NoCertificadoSAT="00001000000518812364" `
    + `SelloSAT="${sello}"/></cfdi:Complemento></cfdi:Comprobante>`;

  const r = leerCfdiCompleto(real);
  assert.notEqual(r, null, 'no pudo leer un CFDI con la forma que emite un PAC real');
  assert.equal(r.serie, 'SMB');
  assert.equal(r.folio, '518070');
  assert.equal(r.total, 232);
  assert.equal(r.subTotal, 200);
  assert.equal(r.formaPagoNombre, 'Tarjeta de credito');
  assert.equal(r.receptor.regimenNombre, 'Regimen Simplificado de Confianza');
  assert.equal(r.emisor.rfc, 'TMT2011241B9');
  assert.equal(r.condicionesDePago, 'Payment due in 0 days from the invoice date.');

  // El acento sobrevivio al recorrido.
  assert.equal(r.conceptos.length, 1);
  assert.equal(r.conceptos[0].descripcion, 'Venta de espacios publicitarios - M\u00e9xico');
  assert.equal(r.conceptos[0].claveUnidad, 'EA');

  // Y el IVA no se duplico pese a estar en el concepto Y en el global.
  assert.equal(r.totalTrasladados, 32);
  assert.equal(r.conceptos[0].iva, 32);

  // El sello se leyo entero, con sus `/` y `+`.
  assert.equal(r.timbre.selloSat, sello);
  assert.equal(r.timbre.uuid, '9B1AC6C4-42FA-43B1-87B2-77D904FAFBDD');
});

console.log(`\nLectura completa de CFDI: ${casos}/11 casos OK`);
if (casos !== 11) { console.error('faltaron casos'); process.exit(1); }
