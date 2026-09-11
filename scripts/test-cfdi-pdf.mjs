#!/usr/bin/env node
/**
 * Pruebas del PDF generico de un CFDI.
 *
 * ============================================================================
 * LA TRAMPA QUE MOTIVA ESTE ARCHIVO
 * ============================================================================
 *
 * Las 14 fuentes base de PDF codifican en WinAnsi (Latin-1). Un caracter fuera
 * de ese juego NO sale mal en el papel: **no sale**. jspdf lo borra sin avisar.
 *
 *     doc.text('A — B', ...)   ->   el PDF dice "A  B"
 *
 * Comprobado contra jspdf 4.2.1 el 11-sep-2026. Y la raya larga es el separador
 * natural al escribir en espanol, asi que se pisa sola: el codigo se ve bien y
 * el papel sale con un hueco. Un `?` se nota y se reporta; un hueco no.
 *
 * Por eso todo texto pasa por `latin1()` y por eso se prueba: no basta con que
 * el PDF se genere, tiene que CONTENER lo que dice el XML. Las afirmaciones van
 * contra los bytes del PDF, que es lo unico que el lector va a ver.
 *
 * Los acentos del espanol SI entran en Latin-1 y tienen que sobrevivir: una
 * prueba que solo exigiera ASCII pasaria borrando «México».
 *
 *   node scripts/test-cfdi-pdf.mjs
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

const ruta = (f) => pathToFileURL(path.join(AQUI, '..', 'src', 'utils', f)).href;
const { leerCfdiCompleto } = await import(ruta('cfdiXml.ts'));
const { construirPdfDeCfdi, nombreDePdf, descargarPdfDeCfdi, latin1 } = await import(ruta('cfdiPdf.ts'));

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

/** El PDF como texto Latin-1: es la codificacion en que jspdf escribe. */
const comoTexto = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

const cfdiDe = ({
  emisor = 'TIKTOK MEXICO TECNOLOGIA', descripcion = 'Venta de espacios publicitarios - México',
  moneda = 'MXN', timbre = true, total = '232.00',
} = {}) => `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="SMB"
  Folio="518070" Fecha="2026-07-01T11:32:51" SubTotal="200.00" Moneda="${moneda}"
  TipoCambio="1" Total="${total}" TipoDeComprobante="I" LugarExpedicion="11529"
  FormaPago="04" MetodoPago="PUE"
  CondicionesDePago="Payment due in 0 days from the invoice date.">
  <cfdi:Emisor Rfc="TMT2011241B9" Nombre="${emisor}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="TRG250711JWA" Nombre="TOURS RED GLOBAL" DomicilioFiscalReceptor="11560"
                 RegimenFiscalReceptor="626" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="EA"
                   Descripcion="${descripcion}" ValorUnitario="200.00" Importe="200.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>
        <cfdi:Traslado Base="200.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="32.00"/>
      </cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="32.00"><cfdi:Traslados>
    <cfdi:Traslado Base="200.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="32.00"/>
  </cfdi:Traslados></cfdi:Impuestos>
  ${timbre ? `<cfdi:Complemento><tfd:TimbreFiscalDigital
     xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"
     UUID="9b1ac6c4-42fa-43b1-87b2-77d904fafbdd" RfcProvCertif="SNF171020F3A"
     FechaTimbrado="2026-07-01T11:32:53" SelloCFD="N2Fb/8J+dC3Ug=="
     NoCertificadoSAT="00001000000518812364" SelloSAT="EPZv/qeKUgz8+fN=="/></cfdi:Complemento>` : ''}
</cfdi:Comprobante>`;

// ===========================================================================
caso('1. latin1 traduce en vez de borrar', () => {
  assert.equal(latin1('A — B'), 'A - B', 'la raya larga se perdio');
  assert.equal(latin1('a…b'), 'a...b');
  assert.equal(latin1('“x”'), '"x"');
  assert.equal(latin1('‘y’'), "'y'");
  assert.equal(latin1('20€'), '20EUR');
  assert.equal(latin1('a b'), 'a b', 'el espacio duro no se normalizo');
  // Lo que no tiene equivalente deja marca VISIBLE, no un hueco.
  assert.equal(latin1('日本'), '??');
  assert.equal(latin1(''), '');
});

caso('2. los acentos del espanol SI pasan', () => {
  // Latin-1 los cubre. Una prueba que exigiera ASCII borraria «México».
  assert.equal(latin1('éñúÁÜ¿¡'), 'éñúÁÜ¿¡');
});

caso('3. el PDF contiene lo que dice el XML', () => {
  const doc = construirPdfDeCfdi(leerCfdiCompleto(cfdiDe()));
  const t = comoTexto(doc);
  for (const esperado of [
    'TIKTOK MEXICO TECNOLOGIA',   // emisor
    'TOURS RED GLOBAL',           // receptor
    'TMT2011241B9', 'TRG250711JWA',
    'Folio SMB-518070',
    '01/07/2026',                 // la fecha, ya legible
    'Tarjeta de credito',         // FormaPago 04 resuelta del catalogo
    'Gastos en general',          // UsoCFDI G03
    'Simplificado de Confianza',  // regimen 626 del receptor
    '232.00', '200.00', '32.00',
    '9B1AC6C4-42FA-43B1-87B2-77D904FAFBDD',
    '00001000000518812364',       // certificado del SAT
  ]) {
    assert.ok(t.includes(esperado), `el PDF no dice "${esperado}"`);
  }
});

caso('4. el aviso de que el documento fiscal es el XML va SIEMPRE', () => {
  // Sin esto el PDF se puede confundir con la representacion impresa del
  // proveedor, y no lo es.
  const t = comoTexto(construirPdfDeCfdi(leerCfdiCompleto(cfdiDe())));
  assert.ok(t.includes('El documento fiscal valido es el XML'), 'falta el aviso del pie');
});

caso('5. un acento del XML llega al papel, en Latin-1', () => {
  const t = comoTexto(construirPdfDeCfdi(leerCfdiCompleto(cfdiDe())));
  // 'M\xe9xico': la e acentuada es el byte E9 en Latin-1, no UTF-8 de dos bytes.
  assert.ok(t.includes('México'), 'se perdio el acento de la descripcion');
  assert.ok(!t.includes('MÃ©xico'), 'el acento salio como UTF-8 mal interpretado');
});

caso('6. una raya larga EN LOS DATOS no abre un hueco', () => {
  // El caso real: un proveedor con raya en su razon social. Antes del saneador
  // el PDF decia "ACME  SA" con dos espacios y nadie se enteraba.
  const doc = construirPdfDeCfdi(leerCfdiCompleto(cfdiDe({ emisor: 'ACME — SA de CV' })));
  const t = comoTexto(doc);
  assert.ok(t.includes('ACME - SA de CV'), 'la raya larga del emisor se convirtio en hueco');
  assert.ok(!t.includes('ACME  SA de CV'), 'quedo el hueco de la raya borrada');
});

caso('7. un CFDI sin timbrar se imprime y lo dice', () => {
  const doc = construirPdfDeCfdi(leerCfdiCompleto(cfdiDe({ timbre: false })));
  const t = comoTexto(doc);
  assert.ok(t.includes('no esta timbrado'), 'no avisa que el CFDI no tiene timbre');
  assert.ok(t.includes('232.00'), 'perdio los importes al faltar el timbre');
});

caso('8. el nombre del archivo sale del folio fiscal', () => {
  assert.equal(
    nombreDePdf(leerCfdiCompleto(cfdiDe())),
    'CFDI-9B1AC6C4-42FA-43B1-87B2-77D904FAFBDD.pdf',
  );
  // Sin timbre cae a serie-folio, que sigue identificando el documento.
  assert.equal(nombreDePdf(leerCfdiCompleto(cfdiDe({ timbre: false }))), 'CFDI-SMB-518070.pdf');
});

caso('9. lo que no es un CFDI no descarga un papel en blanco', () => {
  // Devuelve false ANTES de construir nada, para que la pantalla pueda decirlo.
  assert.equal(descargarPdfDeCfdi(''), false);
  assert.equal(descargarPdfDeCfdi('%PDF-1.4 esto ya es un pdf'), false);
  assert.equal(descargarPdfDeCfdi('<html>hola</html>'), false);
});

caso('10. una moneda extranjera se imprime con su clave', () => {
  const t = comoTexto(construirPdfDeCfdi(leerCfdiCompleto(cfdiDe({ moneda: 'USD' }))));
  assert.ok(t.includes('USD'), 'el total no dice en que moneda esta');
});

console.log(`\nPDF generico de CFDI: ${casos}/10 casos OK`);
if (casos !== 10) { console.error('faltaron casos'); process.exit(1); }
