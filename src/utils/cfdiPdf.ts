/**
 * El PDF generico de un CFDI: ver el XML de forma grafica.
 *
 * ============================================================================
 * QUE ES Y QUE NO ES
 * ============================================================================
 *
 * Un CFDI es un XML. El PDF que manda el proveedor es una REPRESENTACION de
 * ese XML, no el documento fiscal: el documento es el XML. Muchos proveedores
 * mandan los dos, otros solo el XML, y cuando falta el PDF no hay forma de leer
 * la factura sin abrir el archivo en un editor de texto.
 *
 * Esto lo resuelve: arma una representacion impresa a partir del XML, con los
 * campos que el SAT pide en una representacion impresa —emisor, receptor,
 * conceptos, impuestos, folio fiscal, sellos y certificados—.
 *
 * **No sustituye al CFDI ni al PDF del proveedor.** Es una ayuda de lectura, y
 * el pie del documento lo dice para que nadie lo confunda con el original. El
 * XML se conserva entero y se puede descargar aparte.
 *
 * SE GENERA AL VUELO, NO SE GUARDA
 *
 * Sale del XML cada vez que se pide. Asi no puede desincronizarse del original
 * ni ocupa almacenamiento, y si manana se mejora el formato, las facturas
 * viejas tambien se ven mejor. El precio es que hace falta el XML para verlo,
 * que es exactamente la condicion que ya se cumple: sin XML no habria nada que
 * representar.
 */
// Importacion NOMBRADA, no por defecto. `jspdf` resuelve a su build de Node
// (CommonJS) fuera del navegador, y ahi el `default` es el objeto del modulo,
// no el constructor: `new jsPDF()` revienta con «is not a constructor». El
// nombre `jsPDF` existe en LOS DOS builds, asi que este modulo se comporta
// igual en Vite y en las pruebas. (`reportExports.ts` usa la forma por
// defecto; funciona en el navegador y es justo lo que impide probarlo.)
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
// Extension explicita a proposito: `allowImportingTsExtensions` ya esta activo
// y asi este modulo se puede importar TAL CUAL desde las pruebas en Node, sin
// pasar por un bundler. Un PDF que solo se puede probar a ojo no se prueba.
import { leerCfdiCompleto, type ResumenCfdi } from './cfdiXml.ts';

// ---------------------------------------------------------------------------
// Latin-1, porque las fuentes estandar de jsPDF no saben mas
// ---------------------------------------------------------------------------
//
// Las 14 fuentes base de PDF (Helvetica, Courier, Times) codifican en WinAnsi,
// que es Latin-1 con extras. Los acentos del espanol entran sin problema; lo
// que NO entra, jsPDF **lo borra sin decir nada**:
//
//     doc.text('A — B', ...)   ->   en el PDF dice "A  B"
//
// Comprobado contra jspdf 4.2.1 el 11-sep-2026. El caracter no sale mal: sale
// AUSENTE, que es peor, porque nadie nota lo que falta. Y la raya larga es el
// separador natural al escribir en espanol, asi que la trampa es facil de
// pisar: el texto se ve bien en el editor y desaparece en el papel.
//
// `latin1` traduce la puntuacion tipografica a su equivalente imprimible y deja
// un `?` visible en lo que no tenga equivalente. Un `?` se ve y se reporta; un
// hueco no. TODO texto que llega al PDF pasa por aqui.
const EQUIVALENTES: Record<string, string> = {
  '\u2014': '-',   // raya larga
  '\u2013': '-',   // raya corta
  '\u2012': '-',
  '\u2212': '-',   // signo menos
  '\u2018': "'", '\u2019': "'",
  '\u201C': '"', '\u201D': '"',
  '\u2026': '...',
  '\u00A0': ' ',   // espacio duro
  '\u202F': ' ',
  '\u2022': '-',   // vineta
  '\u20AC': 'EUR',
};

export { FONDO_ENCABEZADO, TEXTO_ENCABEZADO };

export function latin1(texto: string): string {
  if (!texto) return '';
  let salida = '';
  for (const c of texto) {
    const equivalente = EQUIVALENTES[c];
    if (equivalente !== undefined) { salida += equivalente; continue; }
    // 0x20-0x7E es ASCII imprimible; 0xA0-0xFF es el resto de Latin-1.
    const p = c.codePointAt(0) ?? 0;
    salida += (p >= 0x20 && p <= 0x7e) || (p >= 0xa0 && p <= 0xff) ? c : '?';
  }
  return salida;
}

/** Separador para el PDF: la raya larga no sobrevive, el punto medio si. */
const SEP = ' \u00B7 ';

const MARGEN = 12;
const GRIS = 120;
const NEGRO = 33;
// El encabezado de la tabla va en oscuro, asi que su TEXTO tiene que ir en
// claro. `autoTable` hereda `styles.textColor` en el encabezado si no se le
// dice otra cosa, y eso deja negro sobre gris oscuro: ilegible. Las dos
// constantes viven juntas para que se vea de un golpe que contrastan, y una
// prueba lo exige.
const FONDO_ENCABEZADO: [number, number, number] = [45, 45, 45];
const TEXTO_ENCABEZADO = 255;

const pesos = (n: number, moneda: string): string =>
  `${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

/** `2026-07-01T11:32:51` -> `01/07/2026 11:32`. Sin librerias: el CFDI ya trae ISO. */
const fechaLegible = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
};

/** Parte una cadena larga (un sello) en renglones de `n` caracteres. */
const enRenglones = (texto: string, n: number): string =>
  (texto.match(new RegExp(`.{1,${n}}`, 'g')) ?? []).join('\n');

/**
 * Dibuja un bloque de etiqueta/valor en dos columnas y devuelve la Y siguiente.
 *
 * Los valores largos se parten: un nombre de razon social no cabe en el ancho
 * de media pagina y sin esto se saldria del papel.
 */
function bloque(
  doc: jsPDF, x: number, y: number, ancho: number,
  titulo: string, campos: Array<[string, string]>,
): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(NEGRO);
  doc.text(titulo, x, y);
  let cursor = y + 4.5;

  doc.setFontSize(7.5);
  for (const [etiqueta, valor] of campos) {
    if (!valor) continue;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(GRIS);
    doc.text(latin1(etiqueta), x, cursor);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(NEGRO);
    const lineas = doc.splitTextToSize(latin1(valor), ancho - 26);
    doc.text(lineas, x + 25, cursor);
    cursor += 3.8 * lineas.length;
  }
  return cursor;
}

/**
 * Arma el PDF y lo devuelve como jsPDF, sin guardarlo.
 *
 * Devolverlo en vez de guardarlo deja que quien llama decida: descargar,
 * abrir en una pestana o mandarlo por correo. `descargarPdfDeCfdi` es el
 * caso comun.
 */
export function construirPdfDeCfdi(cfdi: ResumenCfdi): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const ancho = doc.internal.pageSize.getWidth();
  const medio = (ancho - MARGEN * 2 - 6) / 2;

  // ---------------------------------------------------------------- cabecera
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(NEGRO);
  doc.text(latin1(cfdi.emisor.nombre || 'Emisor sin nombre'), MARGEN, 18);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GRIS);
  doc.text(
    latin1(`Comprobante Fiscal Digital por Internet (CFDI) version ${cfdi.version || '-'}`),
    MARGEN, 23,
  );

  // El folio va a la derecha, alineado al borde.
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(NEGRO);
  const folio = [cfdi.serie, cfdi.folio].filter(Boolean).join('-') || 'sin folio';
  doc.text(latin1(`Folio ${folio}`), ancho - MARGEN, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(GRIS);
  doc.text(latin1(fechaLegible(cfdi.fecha)), ancho - MARGEN, 23, { align: 'right' });

  doc.setDrawColor(210);
  doc.line(MARGEN, 27, ancho - MARGEN, 27);

  // ------------------------------------------------------- emisor / receptor
  const yEmisor = bloque(doc, MARGEN, 34, medio, 'Emisor', [
    ['RFC', cfdi.emisor.rfc],
    ['Nombre', cfdi.emisor.nombre],
    ['Regimen', [cfdi.emisor.regimenFiscal, cfdi.emisor.regimenNombre].filter(Boolean).join(SEP)],
    ['Expedido en', cfdi.lugarExpedicion],
  ]);
  const yReceptor = bloque(doc, MARGEN + medio + 6, 34, medio, 'Receptor', [
    ['RFC', cfdi.receptor.rfc],
    ['Nombre', cfdi.receptor.nombre],
    ['Regimen', [cfdi.receptor.regimenFiscal, cfdi.receptor.regimenNombre].filter(Boolean).join(SEP)],
    ['Uso del CFDI', [cfdi.receptor.usoCfdi, cfdi.receptor.usoCfdiNombre].filter(Boolean).join(SEP)],
    ['CP fiscal', cfdi.receptor.domicilioFiscal],
  ]);

  const yPago = bloque(doc, MARGEN, Math.max(yEmisor, yReceptor) + 4, ancho - MARGEN * 2, 'Pago', [
    ['Forma', [cfdi.formaPago, cfdi.formaPagoNombre].filter(Boolean).join(SEP)],
    ['Metodo', [cfdi.metodoPago, cfdi.metodoPagoNombre].filter(Boolean).join(SEP)],
    ['Moneda', cfdi.moneda + (cfdi.moneda !== 'MXN' && cfdi.tipoCambio > 0 ? `  (tipo de cambio ${cfdi.tipoCambio})` : '')],
    ['Condiciones', cfdi.condicionesDePago],
    ['Tipo', [cfdi.tipoDeComprobante, cfdi.tipoDeComprobanteNombre].filter(Boolean).join(SEP)],
  ]);

  // ------------------------------------------------------------- conceptos
  autoTable(doc, {
    startY: yPago + 3,
    margin: { left: MARGEN, right: MARGEN },
    head: [['Clave', 'Cant.', 'Unidad', 'Descripcion', 'P. unitario', 'Importe', 'IVA']],
    body: cfdi.conceptos.map((c) => [
      latin1(c.claveProdServ),
      String(c.cantidad),
      latin1(c.unidad || c.claveUnidad),
      latin1(c.descripcion),
      pesos(c.valorUnitario, ''),
      pesos(c.importe, ''),
      c.iva ? pesos(c.iva, '') : '-',
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO },
    headStyles: { fillColor: FONDO_ENCABEZADO, textColor: TEXTO_ENCABEZADO, fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 12, halign: 'right' },
      2: { cellWidth: 18 },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
    },
  });

  // Sin conceptos autoTable igual deja `lastAutoTable`; el `?? ` cubre que no.
  type ConLastTable = jsPDF & { lastAutoTable?: { finalY: number } };
  let y = ((doc as ConLastTable).lastAutoTable?.finalY ?? yPago) + 6;

  // --------------------------------------------------------------- totales
  const totales: Array<[string, number]> = [['Subtotal', cfdi.subTotal]];
  if (cfdi.descuento > 0) totales.push(['Descuento', -cfdi.descuento]);
  for (const t of cfdi.traslados) {
    const tasa = t.tipoFactor === 'Tasa' && t.tasaOCuota
      ? ` ${(Number(t.tasaOCuota) * 100).toFixed(2).replace(/\.00$/, '')}%`
      : '';
    totales.push([`${t.nombre || t.impuesto}${tasa}`, t.importe]);
  }
  for (const t of cfdi.retenciones) {
    totales.push([`${t.nombre || t.impuesto} retenido`, -t.importe]);
  }

  doc.setFontSize(8);
  const xEtiqueta = ancho - MARGEN - 60;
  const xValor = ancho - MARGEN;
  for (const [etiqueta, monto] of totales) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRIS);
    doc.text(latin1(etiqueta), xEtiqueta, y);
    doc.setTextColor(NEGRO);
    doc.text(latin1(pesos(monto, '')), xValor, y, { align: 'right' });
    y += 4.5;
  }
  doc.setDrawColor(210);
  doc.line(xEtiqueta, y - 2.5, xValor, y - 2.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NEGRO);
  doc.text(latin1('Total'), xEtiqueta, y + 1.5);
  doc.text(latin1(pesos(cfdi.total, cfdi.moneda)), xValor, y + 1.5, { align: 'right' });
  y += 10;

  // ----------------------------------------------------------------- timbre
  if (cfdi.timbre) {
    doc.setDrawColor(210);
    doc.line(MARGEN, y, ancho - MARGEN, y);
    y += 5;
    y = bloque(doc, MARGEN, y, ancho - MARGEN * 2, 'Timbre fiscal digital', [
      ['Folio fiscal', cfdi.timbre.uuid],
      ['Timbrado el', fechaLegible(cfdi.timbre.fechaTimbrado)],
      ['Certificado SAT', cfdi.timbre.noCertificadoSat],
      ['PAC', cfdi.timbre.rfcProvCertif],
    ]);

    // Los sellos son enormes; van en cuerpo pequeno y partidos, como en
    // cualquier representacion impresa.
    doc.setFontSize(5.5);
    doc.setFont('courier', 'normal');
    for (const [etiqueta, sello] of [
      ['Sello digital del CFDI', cfdi.timbre.selloCfd],
      ['Sello del SAT', cfdi.timbre.selloSat],
    ] as Array<[string, string]>) {
      if (!sello) continue;
      doc.setTextColor(GRIS);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(latin1(etiqueta), MARGEN, y + 3);
      doc.setFont('courier', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(NEGRO);
      const lineas = enRenglones(latin1(sello), 130).split('\n');
      doc.text(lineas, MARGEN, y + 6.5);
      y += 6.5 + lineas.length * 2.4;
    }
  } else {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(GRIS);
    doc.text(latin1('Este CFDI no trae timbre fiscal digital: no esta timbrado.'), MARGEN, y);
    // Sin `y += 6`: el pie se coloca desde el alto de la pagina, no desde aqui,
    // asi que avanzar el cursor seria una linea muerta que aparenta importar.
  }

  // -------------------------------------------------------------------- pie
  // El aviso NO es decorativo: sin el, este PDF se puede confundir con la
  // representacion impresa del proveedor, y no lo es.
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p += 1) {
    doc.setPage(p);
    const alto = doc.internal.pageSize.getHeight();
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRIS);
    doc.text(
      latin1('Representacion impresa generada por ToursRed a partir del XML del CFDI. '
      + 'El documento fiscal valido es el XML, no este PDF.'),
      MARGEN, alto - 8,
    );
    doc.text(latin1(`${p} / ${paginas}`), ancho - MARGEN, alto - 8, { align: 'right' });
  }

  return doc;
}

/** Nombre de archivo estable: folio fiscal si lo hay, y si no serie-folio. */
export function nombreDePdf(cfdi: ResumenCfdi): string {
  const base = cfdi.timbre?.uuid
    || [cfdi.serie, cfdi.folio].filter(Boolean).join('-')
    || 'cfdi';
  return `CFDI-${base}.pdf`;
}

/**
 * Lee el XML, arma el PDF y lo descarga.
 *
 * Devuelve `false` cuando el texto no es un CFDI, para que la pantalla pueda
 * decirlo en vez de descargar un papel en blanco.
 */
export function descargarPdfDeCfdi(xml: string): boolean {
  const cfdi = leerCfdiCompleto(xml);
  if (!cfdi) return false;
  construirPdfDeCfdi(cfdi).save(nombreDePdf(cfdi));
  return true;
}
