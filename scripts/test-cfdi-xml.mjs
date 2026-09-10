#!/usr/bin/env node
/**
 * Pruebas del lector de CFDI para la captura de gastos.
 *
 * ============================================================================
 * QUE SE PRUEBA, Y POR QUE ESTE ARCHIVO EXISTE
 * ============================================================================
 *
 * `src/utils/cfdiXml.ts` propone importes que terminan en un asiento contable
 * y en una declaracion de IVA acreditable. Tres cosas pueden salir mal y las
 * tres se prueban aqui:
 *
 *   TRAMPA 1 -- duplicar el IVA. En un CFDI, `Traslado` aparece DOS veces: una
 *   dentro de cada concepto y otra en el bloque global de impuestos. Sumar los
 *   dos duplica el impuesto. El caso 3 usa un CFDI con las dos formas a la vez,
 *   que es como los emite cualquier PAC.
 *
 *   TRAMPA 2 -- acreditar el IVA de otro. Si el `Receptor@Rfc` no es el de la
 *   plataforma, la factura es de alguien mas. El caso 5 lo rechaza.
 *
 *   TRAMPA 3 -- que `subtotal + iva` no de `total`. El gasto lo exige con un
 *   CHECK. `Comprobante@SubTotal` NO cumple eso cuando hay descuentos, asi que
 *   el lector deriva el subtotal del total. El caso 4 usa un CFDI con descuento
 *   y comprueba que la propuesta cuadra.
 *
 * Y ademas el recorredor de XML, que se escribio a mano porque DOMParser no
 * existe en Node: los casos 8 y 9 le tiran comentarios con `<` adentro, CDATA,
 * un `>` sin escapar dentro de un atributo y comillas simples.
 *
 *   node scripts/test-cfdi-xml.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Mismo truco que test-tax-breakdown.mjs: se relanza con type-stripping para
// poder importar el .ts CANONICO, no una copia.
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { leerCfdiParaGasto, recorrerXml } = await import(
  pathToFileURL(path.join(AQUI, '..', 'src', 'utils', 'cfdiXml.ts')).href
);

const RFC_MIO = 'TRE210101AB1';
let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

/** Un CFDI 4.0 realista: traslados por concepto Y bloque global, como los PACs. */
const cfdi = ({
  total = '1160.00', subtotal = '1000.00', iva = '160.00', descuento = null,
  moneda = 'MXN', tipoCambio = null, tipo = 'I', rfcReceptor = RFC_MIO,
  uuid = 'A1B2C3D4-0000-1111-2222-333344445555', fecha = '2026-09-08T11:22:33',
} = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="${fecha}" Serie="A" Folio="123" TipoDeComprobante="${tipo}"
  Moneda="${moneda}"${tipoCambio ? ` TipoCambio="${tipoCambio}"` : ''}
  SubTotal="${subtotal}"${descuento ? ` Descuento="${descuento}"` : ''} Total="${total}">
  <cfdi:Emisor Rfc="TEL840315KT6" Nombre="Radiomovil Dipsa SA de CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${rfcReceptor}" Nombre="ToursRed" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="81112100" Cantidad="1" Descripcion="Servicio de internet"
      ValorUnitario="${subtotal}" Importe="${subtotal}"${descuento ? ` Descuento="${descuento}"` : ''}>
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${iva}">
    <cfdi:Traslados>
      <cfdi:Traslado Base="${subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigitalv11"
      Version="1.1" UUID="${uuid}" FechaTimbrado="${fecha}"
      SelloCFD="ABC+/def==" NoCertificadoSAT="00001000000504465028"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

console.log('=== Lector de CFDI para gastos ===');

caso('1. un CFDI normal propone todos los campos', () => {
  const r = leerCfdiParaGasto(cfdi(), RFC_MIO);
  assert.equal(r.error, null, `no debia fallar: ${r.error}`);
  assert.deepEqual(r.avisos, [], `sin avisos: ${r.avisos}`);
  assert.equal(r.propuesta.fecha, '2026-09-08');
  assert.equal(r.propuesta.proveedor, 'Radiomovil Dipsa SA de CV');
  assert.equal(r.propuesta.proveedorRfc, 'TEL840315KT6');
  assert.equal(r.propuesta.descripcion, 'Servicio de internet');
  assert.equal(r.propuesta.moneda, 'MXN');
  assert.equal(r.propuesta.tipoCambio, 1);
  assert.equal(r.propuesta.cfdiUuid, 'A1B2C3D4-0000-1111-2222-333344445555');
});

caso('2. subtotal + iva = total, que es lo que el CHECK exige', () => {
  const { propuesta: p } = leerCfdiParaGasto(cfdi(), RFC_MIO);
  assert.equal(p.total, 1160);
  assert.equal(p.iva, 160);
  assert.equal(p.subtotal, 1000);
  assert.equal(Math.abs(p.total - (p.subtotal + p.iva)) <= 0.01, true);
});

caso('3. TRAMPA 1: el IVA no se duplica pese a los traslados repetidos', () => {
  const xml = cfdi();
  // Prueba de que la trampa esta puesta de verdad: el XML SI trae dos.
  assert.equal((xml.match(/Traslado /g) || []).length, 2, 'el fixture perdio el traslado duplicado');
  const { propuesta: p } = leerCfdiParaGasto(xml, RFC_MIO);
  assert.equal(p.iva, 160, `IVA duplicado: ${p.iva}`);
});

caso('4. TRAMPA 3: con descuento, el subtotal se deriva y sigue cuadrando', () => {
  // SubTotal 1000, descuento 100, IVA sobre 900 = 144, Total 1044.
  // `Comprobante@SubTotal` (1000) + IVA (144) = 1144, que NO es el total.
  const xml = cfdi({ subtotal: '1000.00', descuento: '100.00', iva: '144.00', total: '1044.00' });
  const { propuesta: p } = leerCfdiParaGasto(xml, RFC_MIO);
  assert.equal(p.total, 1044);
  assert.equal(p.iva, 144);
  assert.equal(p.subtotal, 900, 'leyo SubTotal en vez de derivarlo del total');
  assert.equal(Math.abs(p.total - (p.subtotal + p.iva)) <= 0.01, true);
});

caso('5. TRAMPA 2: una factura a nombre de otro se rechaza', () => {
  const r = leerCfdiParaGasto(cfdi({ rfcReceptor: 'XAXX010101000' }), RFC_MIO);
  assert.equal(r.propuesta, null, 'propuso importes de una factura ajena');
  assert.match(r.error, /XAXX010101000/);
  assert.match(r.error, new RegExp(RFC_MIO));
});

caso('6. un complemento de pago o una nota de credito no es un gasto', () => {
  for (const t of ['P', 'E', 'N', 'T']) {
    const r = leerCfdiParaGasto(cfdi({ tipo: t }), RFC_MIO);
    assert.equal(r.propuesta, null, `acepto un CFDI tipo ${t}`);
    assert.match(r.error, new RegExp(`"${t}"`));
  }
});

caso('7. en USD sin tipo de cambio avisa y no inventa el total en pesos', () => {
  const r = leerCfdiParaGasto(cfdi({ moneda: 'USD', total: '13.00', subtotal: '13.00', iva: '0.00' }), RFC_MIO);
  assert.equal(r.error, null);
  assert.equal(r.propuesta.tipoCambio, 0);
  assert.equal(r.propuesta.totalMxn, 0, 'invento un total en pesos sin saber el tipo de cambio');
  assert.equal(r.avisos.some((a) => /tipo de cambio/i.test(a)), true);

  // Y con tipo de cambio, lo propone.
  const conTc = leerCfdiParaGasto(
    cfdi({ moneda: 'USD', tipoCambio: '20.1234', total: '13.00', subtotal: '13.00', iva: '0.00' }), RFC_MIO);
  assert.equal(conTc.propuesta.tipoCambio, 20.1234);
  assert.equal(conTc.propuesta.totalMxn, 261.60);
});

caso('8. el recorredor aguanta comentarios, CDATA y un > dentro de un atributo', () => {
  const xml = `<?xml version="1.0"?>
<!-- ojo: 5 > 3, y aqui va <Comprobante Total="99999"/> que no es un nodo -->
<Comprobante Fecha="2026-09-08T00:00:00" TipoDeComprobante="I" Moneda="MXN"
  Total="500.00" Sello="a>b+c/d==" Certificado='con comillas simples'>
  <Emisor Rfc="AAA010101AAA" Nombre="Proveedor &amp; Asociados"/>
  <Receptor Rfc="${RFC_MIO}"/>
  <Conceptos><Concepto Descripcion="Papeleria"/></Conceptos>
  <Complemento><![CDATA[ 1 > 0 y <Traslado Impuesto="002" Importe="99999"/> ]]></Complemento>
</Comprobante>`;
  const r = leerCfdiParaGasto(xml, RFC_MIO);
  assert.equal(r.error, null, `fallo: ${r.error}`);
  assert.equal(r.propuesta.total, 500);
  assert.equal(r.propuesta.iva, 0, 'leyo un traslado que estaba dentro de un CDATA');
  assert.equal(r.propuesta.proveedor, 'Proveedor & Asociados', 'no desescapo &amp;');

  const nodos = recorrerXml(xml);
  const comp = nodos.find((n) => n.nombre === 'Comprobante');
  assert.equal(comp.atributos.Sello, 'a>b+c/d==', 'se corto en el > del atributo');
  assert.equal(comp.atributos.Certificado, 'con comillas simples');
  // El `5 >` del comentario esta puesto A PROPOSITO y va antes del nodo falso.
  // Sin el, saltar el comentario por la rama generica de `<!` -- que corta en
  // el primer `>` -- funcionaba por casualidad y una mutacion que quitaba la
  // rama de comentarios sobrevivia. Se descubrio asi.
  assert.equal(nodos.some((n) => n.atributos.Total === '99999'), false, 'leyo el nodo del comentario');
});

caso('9. la pila de elementos guarda de quien cuelga cada nodo', () => {
  const nodos = recorrerXml(cfdi());
  const traslados = nodos.filter((n) => n.nombre === 'Traslado');
  assert.equal(traslados.length, 2);
  assert.equal(traslados.filter((t) => t.camino.includes('Concepto')).length, 1);
  assert.equal(traslados.filter((t) => !t.camino.includes('Concepto')).length, 1);
  // El auto-cerrado no debe quedarse abierto en la pila.
  const receptor = nodos.find((n) => n.nombre === 'Receptor');
  const conceptos = nodos.find((n) => n.nombre === 'Conceptos');
  assert.equal(conceptos.camino.includes('Receptor'), false, 'un nodo auto-cerrado quedo abierto en la pila');
  assert.equal(receptor.camino.join('/'), 'Comprobante');
});

caso('10. lo que no es un CFDI se rechaza en vez de proponer ceros', () => {
  for (const basura of ['', '   ', '%PDF-1.4 esto es un pdf', '<html><body>hola</body></html>']) {
    const r = leerCfdiParaGasto(basura, RFC_MIO);
    assert.equal(r.propuesta, null, `acepto: ${basura.slice(0, 20)}`);
    assert.equal(typeof r.error, 'string');
  }
  // Un CFDI sin total tampoco.
  assert.equal(leerCfdiParaGasto(cfdi({ total: '0.00' }), RFC_MIO).propuesta, null);
});

caso('11. sin RFC configurado avisa pero no bloquea la captura', () => {
  const r = leerCfdiParaGasto(cfdi(), '');
  assert.equal(r.error, null, 'bloqueo la captura por una configuracion faltante');
  assert.equal(r.avisos.some((a) => /RFC de la plataforma/i.test(a)), true);
});

console.log(`\nLector de CFDI: ${casos}/11 casos OK`);
if (casos !== 11) { console.error('faltaron casos'); process.exit(1); }
