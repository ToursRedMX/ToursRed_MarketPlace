/**
 * Lector de CFDI para la captura de gastos.
 *
 * ============================================================================
 * POR QUE NO USA DOMParser
 * ============================================================================
 *
 * Ya hay un lector de CFDI en `CfdiViewerModal.tsx` y usa `DOMParser`, que es
 * lo natural en el navegador. Este no, y la razon es que este SI se prueba:
 * `DOMParser` no existe en Node y el repo no tiene runner de pruebas ni forma
 * de instalar uno (el arbol de npm no resuelve por una dependencia vieja que
 * se baja de un CDN bloqueado). Las salidas eran tres:
 *
 *   1. Usar DOMParser y no probar nada. Este archivo propone importes que se
 *      van a un asiento contable; no probarlo no es una opcion.
 *   2. Probar contra un DOMParser de mentira. Entonces la prueba mide el
 *      remedo, no lo que corre en produccion. Peor que no probar.
 *   3. Escribir el recorrido aqui, con una sola ruta de codigo que corre igual
 *      en el navegador y en la prueba. Es lo que se hizo.
 *
 * El recorredor de abajo respeta comillas, comentarios y CDATA, y lleva la
 * PILA de elementos abiertos. La pila no es adorno: `Traslado` aparece dos
 * veces en un CFDI -- una por concepto y otra en el bloque global -- y sumar
 * los dos duplica el IVA. Sin saber de quien cuelga cada nodo, ese error es
 * invisible.
 *
 * ============================================================================
 * QUE HACE Y QUE NO
 * ============================================================================
 *
 * PROPONE, NO DECIDE. Devuelve una propuesta que la pantalla rellena en campos
 * que siguen siendo editables. Nada se guarda sin que una persona lo mire.
 *
 * COMPRUEBA QUE LA FACTURA SEA TUYA. Si el `Receptor@Rfc` no es el RFC de la
 * plataforma, no propone nada. Cargar el gasto de otro contribuyente y
 * acreditar su IVA no es un error de dedo, es un problema con el SAT.
 *
 * DERIVA EL SUBTOTAL DEL TOTAL. No usa `Comprobante@SubTotal`. Con descuentos
 * o retenciones, `SubTotal + IVA` no da `Total`, y el gasto solo tiene tres
 * campos. Tomando total del CFDI e IVA de los traslados, `subtotal = total -
 * iva` siempre cuadra con lo que de verdad se pago.
 */

/** Un elemento del XML con su camino desde la raiz. */
interface Nodo {
  nombre: string;
  camino: string[];
  atributos: Record<string, string>;
}

const ESPACIOS = new Set([' ', '\t', '\n', '\r']);

/** Quita el prefijo de espacio de nombres: `cfdi:Comprobante` -> `Comprobante`. */
const sinPrefijo = (nombre: string): string => {
  const i = nombre.indexOf(':');
  return i === -1 ? nombre : nombre.slice(i + 1);
};

/**
 * Recorre el XML y devuelve todos los elementos con su camino.
 *
 * No valida el documento: si viene roto, devuelve lo que alcanzo a leer y
 * quien llama se da cuenta porque no hay `Comprobante`.
 */
export function recorrerXml(xml: string): Nodo[] {
  const nodos: Nodo[] = [];
  const pila: string[] = [];
  let i = 0;

  while (i < xml.length) {
    const abre = xml.indexOf('<', i);
    if (abre === -1) break;

    // Comentarios, CDATA, declaracion y prologo: se saltan enteros. El
    // comentario importa porque puede llevar un `<` o un `>` adentro, y CDATA
    // porque los PACs meten ahi cadenas originales con signos de todo tipo.
    if (xml.startsWith('<!--', abre)) {
      const fin = xml.indexOf('-->', abre + 4);
      i = fin === -1 ? xml.length : fin + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', abre)) {
      const fin = xml.indexOf(']]>', abre + 9);
      i = fin === -1 ? xml.length : fin + 3;
      continue;
    }
    if (xml.startsWith('<?', abre) || xml.startsWith('<!', abre)) {
      const fin = xml.indexOf('>', abre + 2);
      i = fin === -1 ? xml.length : fin + 1;
      continue;
    }

    // Cierre: </algo>
    if (xml[abre + 1] === '/') {
      const fin = xml.indexOf('>', abre);
      if (fin === -1) break;
      pila.pop();
      i = fin + 1;
      continue;
    }

    // Apertura. Se lee el nombre.
    let p = abre + 1;
    let nombre = '';
    while (p < xml.length && !ESPACIOS.has(xml[p]) && xml[p] !== '>' && xml[p] !== '/') {
      nombre += xml[p];
      p += 1;
    }
    if (!nombre) { i = abre + 1; continue; }
    nombre = sinPrefijo(nombre);

    // Y los atributos, uno por uno. Se avanza POR COMILLAS y no buscando el
    // siguiente `>`: en XML un `>` sin escapar dentro del valor de un atributo
    // es legal, y una base64 de sello o certificado puede traerlo.
    const atributos: Record<string, string> = {};
    let cerroSolo = false;
    while (p < xml.length) {
      while (p < xml.length && ESPACIOS.has(xml[p])) p += 1;
      if (p >= xml.length) break;
      if (xml[p] === '>') { p += 1; break; }
      if (xml[p] === '/' && xml[p + 1] === '>') { cerroSolo = true; p += 2; break; }

      let clave = '';
      while (p < xml.length && xml[p] !== '=' && !ESPACIOS.has(xml[p]) && xml[p] !== '>' && xml[p] !== '/') {
        clave += xml[p];
        p += 1;
      }
      while (p < xml.length && ESPACIOS.has(xml[p])) p += 1;
      if (xml[p] !== '=') continue;   // atributo sin valor: XML invalido, se ignora
      p += 1;
      while (p < xml.length && ESPACIOS.has(xml[p])) p += 1;

      const comilla = xml[p];
      if (comilla !== '"' && comilla !== "'") break;
      p += 1;
      const fin = xml.indexOf(comilla, p);
      if (fin === -1) { p = xml.length; break; }
      atributos[sinPrefijo(clave)] = desescapar(xml.slice(p, fin));
      p = fin + 1;
    }

    nodos.push({ nombre, camino: [...pila], atributos });
    if (!cerroSolo) pila.push(nombre);
    i = p;
  }

  return nodos;
}

/** Las cinco entidades de XML. `&amp;` va al final para no re-desescapar. */
const desescapar = (texto: string): string =>
  texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

export interface PropuestaGasto {
  fecha: string;
  proveedor: string;
  proveedorRfc: string;
  descripcion: string;
  moneda: string;
  tipoCambio: number;
  subtotal: number;
  iva: number;
  total: number;
  totalMxn: number;
  cfdiUuid: string;
}

export interface LecturaCfdi {
  /** null cuando el XML no sirve para capturar un gasto. */
  propuesta: PropuestaGasto | null;
  /** Lo que impide usarlo. Se muestra en rojo y no se rellena nada. */
  error: string | null;
  /** Lo que hay que mirar antes de guardar. Se muestra en ambar. */
  avisos: string[];
}

const aNumero = (texto: string | undefined): number => {
  if (!texto) return 0;
  const n = Number(texto.trim());
  return Number.isFinite(n) ? n : 0;
};

const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const TIPOS_DE_COMPROBANTE: Record<string, string> = {
  I: 'ingreso',
  E: 'egreso (nota de credito)',
  T: 'traslado',
  N: 'nomina',
  P: 'pago',
};

/**
 * Lee un CFDI y propone los campos del gasto.
 *
 * @param xml               El XML tal cual, como lo entrego el proveedor.
 * @param rfcReceptorEsperado  El RFC de la plataforma (`platform_settings.pac_issuer_rfc`).
 */
export function leerCfdiParaGasto(xml: string, rfcReceptorEsperado: string): LecturaCfdi {
  const avisos: string[] = [];
  const fallo = (error: string): LecturaCfdi => ({ propuesta: null, error, avisos });

  if (!xml || !xml.trim()) return fallo('El archivo esta vacio.');

  const nodos = recorrerXml(xml);
  const comprobante = nodos.find((n) => n.nombre === 'Comprobante' && n.camino.length === 0)
    ?? nodos.find((n) => n.nombre === 'Comprobante');
  if (!comprobante) {
    return fallo('El archivo no trae un nodo Comprobante: no parece un CFDI. Si es un PDF, hace falta el XML.');
  }

  const emisor   = nodos.find((n) => n.nombre === 'Emisor');
  const receptor = nodos.find((n) => n.nombre === 'Receptor');

  // ---------------------------------------------------------------------
  // Que la factura sea tuya. Esto va ANTES que cualquier importe.
  // ---------------------------------------------------------------------
  const rfcReceptor = (receptor?.atributos.Rfc ?? '').trim().toUpperCase();
  const rfcEsperado = (rfcReceptorEsperado ?? '').trim().toUpperCase();
  if (!rfcEsperado) {
    avisos.push(
      'No hay RFC de la plataforma configurado, asi que no se pudo comprobar que la factura este a tu nombre. ' +
      'Se configura en Ajustes, en los datos fiscales.',
    );
  } else if (!rfcReceptor) {
    return fallo('El CFDI no trae RFC de receptor. No se puede comprobar que la factura este a tu nombre.');
  } else if (rfcReceptor !== rfcEsperado) {
    return fallo(
      `La factura esta a nombre de ${rfcReceptor} y el RFC de la plataforma es ${rfcEsperado}. ` +
      'Acreditar el IVA de un CFDI que no es tuyo es un problema con el SAT, no un error de captura.',
    );
  }

  const tipo = (comprobante.atributos.TipoDeComprobante ?? '').trim().toUpperCase();
  if (tipo && tipo !== 'I') {
    return fallo(
      `Este CFDI es de tipo "${tipo}" (${TIPOS_DE_COMPROBANTE[tipo] ?? 'desconocido'}) y un gasto se captura ` +
      'desde uno de tipo I (ingreso). Un complemento de pago o una nota de credito no es el gasto.',
    );
  }

  // ---------------------------------------------------------------------
  // Los importes.
  // ---------------------------------------------------------------------
  // El IVA sale de los traslados del BLOQUE GLOBAL, no de los de cada
  // concepto: los dos existen y sumar ambos duplica el impuesto. Por eso el
  // recorredor guarda el camino.
  const trasladosGlobales = nodos.filter(
    (n) => n.nombre === 'Traslado'
        && n.camino.includes('Comprobante')
        && !n.camino.includes('Concepto'),
  );
  const trasladosPorConcepto = nodos.filter(
    (n) => n.nombre === 'Traslado' && n.camino.includes('Concepto'),
  );
  const traslados = trasladosGlobales.length > 0 ? trasladosGlobales : trasladosPorConcepto;

  const iva = redondear(
    traslados
      .filter((t) => (t.atributos.Impuesto ?? '').trim() === '002')
      .reduce((suma, t) => suma + aNumero(t.atributos.Importe), 0),
  );

  const otrosImpuestos = traslados.filter((t) => (t.atributos.Impuesto ?? '').trim() !== '002');
  if (otrosImpuestos.length > 0) {
    avisos.push(
      'El CFDI traslada impuestos que no son IVA (IEPS, por ejemplo). El gasto solo separa IVA, ' +
      'asi que van dentro del subtotal. Revisa si eso te sirve.',
    );
  }
  const retenciones = nodos.filter((n) => n.nombre === 'Retencion');
  if (retenciones.length > 0) {
    avisos.push('El CFDI trae impuestos retenidos y el gasto no los separa. Revisa el subtotal.');
  }

  const total = redondear(aNumero(comprobante.atributos.Total));
  if (total <= 0) {
    return fallo('El CFDI no trae un total mayor que cero.');
  }
  // Se DERIVA en vez de leer `SubTotal`: con descuentos o retenciones aquel no
  // cumple subtotal + iva = total, que es justo lo que el gasto exige.
  const subtotal = redondear(total - iva);

  const moneda = (comprobante.atributos.Moneda ?? 'MXN').trim().toUpperCase() || 'MXN';
  let tipoCambio = aNumero(comprobante.atributos.TipoCambio);
  if (moneda === 'MXN') {
    // En un CFDI en pesos el SAT permite omitir TipoCambio o ponerlo en 1.
    if (tipoCambio !== 0 && tipoCambio !== 1) {
      avisos.push(`El CFDI viene en MXN con tipo de cambio ${tipoCambio}. Se usa 1.`);
    }
    tipoCambio = 1;
  } else if (tipoCambio <= 0) {
    avisos.push(
      `El CFDI viene en ${moneda} y no trae tipo de cambio. Hay que capturarlo a mano: ` +
      'sin el no se puede saber cuanto salio en pesos.',
    );
    tipoCambio = 0;
  }

  const timbre = nodos.find((n) => n.nombre === 'TimbreFiscalDigital');
  const cfdiUuid = (timbre?.atributos.UUID ?? '').trim().toUpperCase();
  if (!cfdiUuid) {
    avisos.push('El CFDI no esta timbrado (no trae UUID). Se puede capturar, pero no queda folio fiscal.');
  }

  const conceptos = nodos.filter((n) => n.nombre === 'Concepto');
  const descripcion = conceptos
    .map((c) => (c.atributos.Descripcion ?? '').trim())
    .filter(Boolean)
    .join(' / ')
    .slice(0, 300);

  const fechaCompleta = (comprobante.atributos.Fecha ?? '').trim();
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(fechaCompleta) ? fechaCompleta.slice(0, 10) : '';
  if (!fecha) avisos.push('El CFDI no trae fecha legible. Hay que capturarla.');

  return {
    error: null,
    avisos,
    propuesta: {
      fecha,
      proveedor: (emisor?.atributos.Nombre ?? '').trim(),
      proveedorRfc: (emisor?.atributos.Rfc ?? '').trim().toUpperCase(),
      descripcion,
      moneda,
      tipoCambio,
      subtotal,
      iva,
      total,
      // Propuesta, no verdad: el banco aplica su propio tipo de cambio y la
      // pantalla deja editar este campo.
      totalMxn: tipoCambio > 0 ? redondear(total * tipoCambio) : 0,
      cfdiUuid,
    },
  };
}
