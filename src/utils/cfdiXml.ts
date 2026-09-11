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

// ===========================================================================
// LECTURA COMPLETA: todo lo que el CFDI dice, para verlo y para imprimirlo
// ===========================================================================
//
// `leerCfdiParaGasto` responde una pregunta muy concreta —«que campos propongo
// para este gasto»— y por eso descarta casi todo: se queda con seis importes y
// tira conceptos, impuestos, sellos y datos del emisor.
//
// Esta lectura es la contraria: NO juzga, NO valida y NO propone. Devuelve lo
// que el documento dice, tal cual, para poder mostrarlo en pantalla y armar el
// PDF generico. Por eso tampoco recibe el RFC de la plataforma: un CFDI que no
// es tuyo no se puede capturar como gasto, pero si se tiene que poder LEER.
// Separar las dos cosas evita la tentacion de aflojar la validacion del gasto
// para que la vista funcione.

export interface ConceptoCfdi {
  claveProdServ: string;
  noIdentificacion: string;
  cantidad: number;
  claveUnidad: string;
  unidad: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  descuento: number;
  /** IVA trasladado de ESTE concepto. Cero si el CFDI solo lo trae global. */
  iva: number;
}

export interface ImpuestoCfdi {
  impuesto: string;
  nombre: string;
  tipoFactor: string;
  tasaOCuota: string;
  base: number;
  importe: number;
}

export interface TimbreCfdi {
  uuid: string;
  fechaTimbrado: string;
  rfcProvCertif: string;
  noCertificadoSat: string;
  selloCfd: string;
  selloSat: string;
}

export interface ResumenCfdi {
  version: string;
  serie: string;
  folio: string;
  fecha: string;
  lugarExpedicion: string;
  tipoDeComprobante: string;
  tipoDeComprobanteNombre: string;
  formaPago: string;
  formaPagoNombre: string;
  metodoPago: string;
  metodoPagoNombre: string;
  condicionesDePago: string;
  moneda: string;
  tipoCambio: number;
  subTotal: number;
  descuento: number;
  total: number;
  emisor: { rfc: string; nombre: string; regimenFiscal: string; regimenNombre: string };
  receptor: {
    rfc: string; nombre: string; regimenFiscal: string; regimenNombre: string;
    usoCfdi: string; usoCfdiNombre: string; domicilioFiscal: string;
  };
  conceptos: ConceptoCfdi[];
  traslados: ImpuestoCfdi[];
  retenciones: ImpuestoCfdi[];
  totalTrasladados: number;
  totalRetenidos: number;
  timbre: TimbreCfdi | null;
}

// Los catalogos del SAT completos son enormes y cambian; aqui van solo los
// codigos que aparecen en facturas de proveedor normales. Lo que no este se
// imprime con su clave, que sigue siendo informacion util: vale mas «G03»
// que una cadena vacia.
const FORMAS_DE_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque nominativo',
  '03': 'Transferencia electronica de fondos',
  '04': 'Tarjeta de credito',
  '05': 'Monedero electronico',
  '06': 'Dinero electronico',
  '08': 'Vales de despensa',
  '12': 'Dacion en pago',
  '17': 'Compensacion',
  '28': 'Tarjeta de debito',
  '29': 'Tarjeta de servicios',
  '30': 'Aplicacion de anticipos',
  '31': 'Intermediario pagos',
  '99': 'Por definir',
};

const METODOS_DE_PAGO: Record<string, string> = {
  PUE: 'Pago en una sola exhibicion',
  PPD: 'Pago en parcialidades o diferido',
};

const USOS_CFDI: Record<string, string> = {
  G01: 'Adquisicion de mercancias',
  G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general',
  I01: 'Construcciones',
  I02: 'Mobiliario y equipo de oficina',
  I03: 'Equipo de transporte',
  I04: 'Equipo de computo',
  I08: 'Otra maquinaria y equipo',
  D01: 'Honorarios medicos',
  P01: 'Por definir',
  S01: 'Sin efectos fiscales',
  CP01: 'Pagos',
  CN01: 'Nomina',
};

const REGIMENES: Record<string, string> = {
  '601': 'General de Ley Personas Morales',
  '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '606': 'Arrendamiento',
  '607': 'Enajenacion o Adquisicion de Bienes',
  '608': 'Demas ingresos',
  '610': 'Residentes en el Extranjero sin Establecimiento Permanente',
  '611': 'Ingresos por Dividendos',
  '612': 'Personas Fisicas con Actividades Empresariales y Profesionales',
  '614': 'Ingresos por intereses',
  '615': 'Regimen de los ingresos por obtencion de premios',
  '616': 'Sin obligaciones fiscales',
  '620': 'Sociedades Cooperativas de Produccion',
  '621': 'Incorporacion Fiscal',
  '622': 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras',
  '623': 'Opcional para Grupos de Sociedades',
  '624': 'Coordinados',
  '625': 'Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas',
  '626': 'Regimen Simplificado de Confianza',
};

const IMPUESTOS: Record<string, string> = {
  '001': 'ISR',
  '002': 'IVA',
  '003': 'IEPS',
};

/** Devuelve `nombre` si la clave esta en el catalogo, y si no la clave sola. */
const delCatalogo = (catalogo: Record<string, string>, clave: string): string => {
  const c = (clave ?? '').trim();
  if (!c) return '';
  return catalogo[c] ?? c;
};

const leerImpuestos = (nodos: Nodo[], nombre: 'Traslado' | 'Retencion'): ImpuestoCfdi[] => {
  // Igual que en `leerCfdiParaGasto`: los globales mandan, y solo si no hay se
  // usan los de concepto. Sumar ambos duplicaria el impuesto.
  const globales = nodos.filter(
    (n) => n.nombre === nombre && n.camino.includes('Comprobante') && !n.camino.includes('Concepto'),
  );
  const porConcepto = nodos.filter((n) => n.nombre === nombre && n.camino.includes('Concepto'));
  const fuente = globales.length > 0 ? globales : porConcepto;

  // Un CFDI puede traer varios renglones del mismo impuesto y tasa; se agrupan
  // para que el PDF muestre «IVA 16% ... 32.00» y no tres renglones sueltos.
  const porLlave = new Map<string, ImpuestoCfdi>();
  for (const n of fuente) {
    const impuesto = (n.atributos.Impuesto ?? '').trim();
    const tipoFactor = (n.atributos.TipoFactor ?? '').trim();
    const tasaOCuota = (n.atributos.TasaOCuota ?? '').trim();
    const llave = `${impuesto}|${tipoFactor}|${tasaOCuota}`;
    const previo = porLlave.get(llave);
    const base = aNumero(n.atributos.Base);
    const importe = aNumero(n.atributos.Importe);
    if (previo) {
      previo.base = redondear(previo.base + base);
      previo.importe = redondear(previo.importe + importe);
    } else {
      porLlave.set(llave, {
        impuesto,
        nombre: delCatalogo(IMPUESTOS, impuesto),
        tipoFactor,
        tasaOCuota,
        base: redondear(base),
        importe: redondear(importe),
      });
    }
  }
  return [...porLlave.values()];
};

/**
 * Lee un CFDI entero, sin juzgarlo.
 *
 * Devuelve `null` solo cuando el archivo no es un CFDI en absoluto. Un CFDI de
 * otro RFC, sin timbrar o de un tipo que no sirve para gastos SI se lee: la
 * decision de si se puede capturar como gasto es de `leerCfdiParaGasto`.
 */
export function leerCfdiCompleto(xml: string): ResumenCfdi | null {
  if (!xml || !xml.trim()) return null;

  const nodos = recorrerXml(xml);
  const comprobante = nodos.find((n) => n.nombre === 'Comprobante' && n.camino.length === 0)
    ?? nodos.find((n) => n.nombre === 'Comprobante');
  if (!comprobante) return null;

  const a = comprobante.atributos;
  const emisor = nodos.find((n) => n.nombre === 'Emisor')?.atributos ?? {};
  const receptor = nodos.find((n) => n.nombre === 'Receptor')?.atributos ?? {};
  const timbreNodo = nodos.find((n) => n.nombre === 'TimbreFiscalDigital');

  const conceptos: ConceptoCfdi[] = nodos
    .filter((n) => n.nombre === 'Concepto')
    .map((c, i) => {
      // El IVA del concepto sale de SUS traslados. Se identifican por el camino:
      // un `Traslado` cuyo camino pasa por `Concepto`. Como el recorredor no
      // numera los conceptos, se usa el orden de aparicion entre conceptos.
      const iva = nodos
        .filter((n) => n.nombre === 'Traslado' && n.camino.includes('Concepto')
                    && indiceDeConcepto(nodos, n) === i
                    && (n.atributos.Impuesto ?? '').trim() === '002')
        .reduce((s, n) => s + aNumero(n.atributos.Importe), 0);
      return {
        claveProdServ: (c.atributos.ClaveProdServ ?? '').trim(),
        noIdentificacion: (c.atributos.NoIdentificacion ?? '').trim(),
        cantidad: aNumero(c.atributos.Cantidad),
        claveUnidad: (c.atributos.ClaveUnidad ?? '').trim(),
        unidad: (c.atributos.Unidad ?? '').trim(),
        descripcion: (c.atributos.Descripcion ?? '').trim(),
        valorUnitario: redondear(aNumero(c.atributos.ValorUnitario)),
        importe: redondear(aNumero(c.atributos.Importe)),
        descuento: redondear(aNumero(c.atributos.Descuento)),
        iva: redondear(iva),
      };
    });

  const traslados = leerImpuestos(nodos, 'Traslado');
  const retenciones = leerImpuestos(nodos, 'Retencion');

  const tipo = (a.TipoDeComprobante ?? '').trim().toUpperCase();
  const moneda = (a.Moneda ?? 'MXN').trim().toUpperCase() || 'MXN';

  return {
    version: (a.Version ?? '').trim(),
    serie: (a.Serie ?? '').trim(),
    folio: (a.Folio ?? '').trim(),
    fecha: (a.Fecha ?? '').trim(),
    lugarExpedicion: (a.LugarExpedicion ?? '').trim(),
    tipoDeComprobante: tipo,
    tipoDeComprobanteNombre: TIPOS_DE_COMPROBANTE[tipo] ?? '',
    formaPago: (a.FormaPago ?? '').trim(),
    formaPagoNombre: delCatalogo(FORMAS_DE_PAGO, a.FormaPago ?? ''),
    metodoPago: (a.MetodoPago ?? '').trim(),
    metodoPagoNombre: delCatalogo(METODOS_DE_PAGO, a.MetodoPago ?? ''),
    condicionesDePago: (a.CondicionesDePago ?? '').trim(),
    moneda,
    tipoCambio: moneda === 'MXN' ? 1 : aNumero(a.TipoCambio),
    subTotal: redondear(aNumero(a.SubTotal)),
    descuento: redondear(aNumero(a.Descuento)),
    total: redondear(aNumero(a.Total)),
    emisor: {
      rfc: (emisor.Rfc ?? '').trim().toUpperCase(),
      nombre: (emisor.Nombre ?? '').trim(),
      regimenFiscal: (emisor.RegimenFiscal ?? '').trim(),
      regimenNombre: delCatalogo(REGIMENES, emisor.RegimenFiscal ?? ''),
    },
    receptor: {
      rfc: (receptor.Rfc ?? '').trim().toUpperCase(),
      nombre: (receptor.Nombre ?? '').trim(),
      regimenFiscal: (receptor.RegimenFiscalReceptor ?? '').trim(),
      regimenNombre: delCatalogo(REGIMENES, receptor.RegimenFiscalReceptor ?? ''),
      usoCfdi: (receptor.UsoCFDI ?? '').trim(),
      usoCfdiNombre: delCatalogo(USOS_CFDI, receptor.UsoCFDI ?? ''),
      domicilioFiscal: (receptor.DomicilioFiscalReceptor ?? '').trim(),
    },
    conceptos,
    traslados,
    retenciones,
    totalTrasladados: redondear(traslados.reduce((s, t) => s + t.importe, 0)),
    totalRetenidos: redondear(retenciones.reduce((s, t) => s + t.importe, 0)),
    timbre: timbreNodo
      ? {
          uuid: (timbreNodo.atributos.UUID ?? '').trim().toUpperCase(),
          fechaTimbrado: (timbreNodo.atributos.FechaTimbrado ?? '').trim(),
          rfcProvCertif: (timbreNodo.atributos.RfcProvCertif ?? '').trim().toUpperCase(),
          noCertificadoSat: (timbreNodo.atributos.NoCertificadoSAT ?? '').trim(),
          selloCfd: (timbreNodo.atributos.SelloCFD ?? '').trim(),
          selloSat: (timbreNodo.atributos.SelloSAT ?? '').trim(),
        }
      : null,
  };
}

/**
 * A que concepto pertenece un nodo hijo, por orden de aparicion.
 *
 * El recorredor guarda el camino por NOMBRE (`['Comprobante','Conceptos',
 * 'Concepto','Impuestos','Traslados']`), no por posicion, asi que dos conceptos
 * tienen caminos identicos. Como `recorrerXml` devuelve los nodos en el orden
 * del documento, el concepto de un hijo es el ultimo `Concepto` que aparecio
 * antes que el.
 */
function indiceDeConcepto(nodos: Nodo[], hijo: Nodo): number {
  const posicion = nodos.indexOf(hijo);
  let indice = -1;
  for (let i = 0; i < posicion; i += 1) {
    if (nodos[i].nombre === 'Concepto') indice += 1;
  }
  return indice;
}
