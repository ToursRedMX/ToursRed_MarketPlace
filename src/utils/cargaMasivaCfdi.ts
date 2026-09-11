/**
 * Carga masiva de CFDI: muchos XML, muchos borradores.
 *
 * ============================================================================
 * POR QUE ES UN MODULO Y NO CODIGO DENTRO DE LA PANTALLA
 * ============================================================================
 *
 * Porque casi todo lo que puede salir mal aqui es SILENCIOSO:
 *
 *   * un XML repetido dentro del MISMO lote. Los dos se leen bien, los dos
 *     proponen un gasto valido, y el segundo INSERT choca contra el indice
 *     unico de `cfdi_uuid`. Si el lote se inserta de golpe, el error se lleva
 *     por delante a los demas;
 *   * un XML que ya esta capturado de antes. Igual, pero contra la base;
 *   * un CFDI a nombre de otro RFC, que no se puede capturar como gasto;
 *   * un CFDI en dolares sin tipo de cambio. La columna NO admite 0 ni NULL,
 *     asi que hay que meter un 1 de relleno — y ese 1 registrado asentaria
 *     dolares como pesos. Entra como borrador MARCADO, nunca callado.
 *
 * Este modulo decide todo eso ANTES de tocar la base y devuelve un veredicto
 * por archivo. La pantalla solo pinta el resultado y manda a insertar los que
 * pasaron.
 *
 * NADA SE REGISTRA. Todo entra como BORRADOR, que es lo que se pidio: quedan
 * cargados y despues se entra a cada uno a revisar, corregir la cuenta y, si
 * hace falta, colgarle su PDF.
 */
import { leerCfdiParaGasto } from './cfdiXml.ts';

export interface ArchivoCfdi {
  nombre: string;
  texto: string;
}

/** Lo que se va a insertar. Coincide con las columnas de `gastos_operacion`. */
export interface BorradorDeGasto {
  fecha: string;
  cuenta_contable: string;
  proveedor: string;
  descripcion: string;
  moneda: string;
  tipo_cambio: number;
  subtotal: number;
  iva: number;
  total: number;
  total_mxn: number;
  cfdi_uuid: string | null;
  cfdi_xml: string;
}

export interface ResultadoDeArchivo {
  nombre: string;
  /** Cuando es null, `motivo` dice por que no se pudo. */
  borrador: BorradorDeGasto | null;
  motivo: string | null;
  /** Lo que hay que mirar aunque el borrador si se haya podido armar. */
  avisos: string[];
}

export interface LoteDeCfdi {
  resultados: ResultadoDeArchivo[];
  /** Los borradores listos, en el orden de los archivos. */
  borradores: BorradorDeGasto[];
  /** Cuantos se pudieron y cuantos no, para el resumen de la pantalla. */
  listos: number;
  rechazados: number;
}

const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Prepara un lote de XML.
 *
 * @param archivos       Los XML leidos como texto.
 * @param rfcPlataforma  El RFC de la plataforma, para comprobar que las
 *                       facturas sean tuyas.
 * @param cuenta         La cuenta contable con la que nacen TODOS. El CFDI no
 *                       dice a que cuenta va el gasto —eso es criterio
 *                       contable, no dato fiscal—, asi que se elige una para
 *                       el lote y se corrige despues en cada borrador.
 * @param uuidsExistentes UUIDs ya capturados. Se pasan de fuera para que este
 *                       modulo no consulte nada y se pueda probar entero.
 */
export function prepararLoteDeCfdi(
  archivos: ArchivoCfdi[],
  rfcPlataforma: string,
  cuenta: string,
  uuidsExistentes: ReadonlySet<string>,
): LoteDeCfdi {
  const resultados: ResultadoDeArchivo[] = [];
  // Los del propio lote. Un mismo CFDI puede venir dos veces en la seleccion
  // —pasa con las descargas del portal del SAT— y los dos archivos se leen
  // perfectamente bien.
  const vistosEnElLote = new Set<string>();

  for (const archivo of archivos) {
    const avisos: string[] = [];
    const falla = (motivo: string) =>
      resultados.push({ nombre: archivo.nombre, borrador: null, motivo, avisos });

    const lectura = leerCfdiParaGasto(archivo.texto, rfcPlataforma);
    if (lectura.error || !lectura.propuesta) {
      falla(lectura.error ?? 'No se pudo leer el CFDI.');
      continue;
    }

    const p = lectura.propuesta;
    avisos.push(...lectura.avisos);

    const uuid = p.cfdiUuid || '';
    if (uuid && uuidsExistentes.has(uuid)) {
      falla('Ese CFDI ya esta capturado. Buscalo en la lista en vez de volver a cargarlo.');
      continue;
    }
    if (uuid && vistosEnElLote.has(uuid)) {
      falla('Este CFDI viene repetido en la seleccion: ya se preparo desde otro archivo.');
      continue;
    }

    // El tipo de cambio. La columna exige > 0, asi que un CFDI en moneda
    // extranjera sin `TipoCambio` entra con 1 de RELLENO. Ese 1 no es un dato:
    // registrarlo asentaria dolares como pesos, y por eso la base lo prohibe al
    // registrar y la pantalla lo marca. Aqui se avisa para que no pase callado.
    let tipoCambio = p.tipoCambio;
    if (p.moneda !== 'MXN' && tipoCambio <= 0) {
      tipoCambio = 1;
      avisos.push(
        `Viene en ${p.moneda} y el CFDI no trae tipo de cambio. Entra con 1 de relleno y `
        + 'NO se podra registrar hasta que captures el real: con 1 se asentarian '
        + `${p.moneda} como si fueran pesos.`,
      );
    }
    if (p.moneda === 'MXN') tipoCambio = 1;

    const totalMxn = redondear(p.total * tipoCambio);
    if (!(p.total > 0) || !(totalMxn > 0)) {
      falla('El CFDI no propone un total mayor que cero.');
      continue;
    }
    if (!p.fecha) {
      falla('El CFDI no trae fecha legible y un gasto sin fecha no se puede capturar.');
      continue;
    }

    if (uuid) vistosEnElLote.add(uuid);
    resultados.push({
      nombre: archivo.nombre,
      motivo: null,
      avisos,
      borrador: {
        fecha: p.fecha,
        cuenta_contable: cuenta,
        proveedor: p.proveedor || '(sin proveedor en el CFDI)',
        descripcion: p.descripcion || '(sin descripcion en el CFDI)',
        moneda: p.moneda,
        tipo_cambio: tipoCambio,
        subtotal: redondear(p.subtotal),
        iva: redondear(p.iva),
        total: redondear(p.total),
        total_mxn: totalMxn,
        cfdi_uuid: uuid || null,
        // El XML entero: si manana dudas de un monto se vuelve a derivar del
        // original en vez de creerle a la captura. Y es lo que alimenta el PDF.
        cfdi_xml: archivo.texto,
      },
    });
  }

  const borradores = resultados
    .map((r) => r.borrador)
    .filter((b): b is BorradorDeGasto => b !== null);

  return {
    resultados,
    borradores,
    listos: borradores.length,
    rechazados: resultados.length - borradores.length,
  };
}
