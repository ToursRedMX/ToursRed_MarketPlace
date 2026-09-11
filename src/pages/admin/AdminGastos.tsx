import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, RefreshCw, AlertCircle, Info, CheckCircle2, XCircle,
  FileText, Repeat, Calculator, Trash2, Paperclip, FileDown, Layers, Download,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { leerCfdiParaGasto } from '../../utils/cfdiXml';
import { descargarPdfDeCfdi } from '../../utils/cfdiPdf.ts';
import { prepararLoteDeCfdi, type LoteDeCfdi } from '../../utils/cargaMasivaCfdi.ts';
import {
  subirSoporte, urlDeSoporte, borrarSoporte, descargarTexto,
  TIPOS_ACEPTADOS, type SoporteDeGasto,
} from '../../utils/soportesDeGasto.ts';

/**
 * Captura de gastos de operacion.
 *
 * ============================================================================
 * POR QUE EXISTE
 * ============================================================================
 *
 * El catalogo de cuentas tenia las cuentas de gasto desde hace meses, pero no
 * habia tabla donde capturarlos: los asientos solo nacian de los nueve
 * `source_type` automaticos. Un pago a Telcel o a Anthropic no podia entrar al
 * sistema por ningun lado, y por eso el reporte maestro llevaba un aviso fijo
 * diciendo que los gastos no estaban incluidos.
 *
 * ============================================================================
 * LAS TRES REGLAS DE ESTA PANTALLA
 * ============================================================================
 *
 * 1. EL XML PROPONE, TU CONFIRMAS. Al cargar un CFDI se rellenan los campos,
 *    pero todos siguen siendo editables y nada se guarda hasta que le das
 *    guardar. Si el CFDI no esta a nombre de la plataforma, no se rellena nada
 *    y se dice por que.
 *
 * 2. EL TOTAL EN PESOS SE CALCULA PERO SE PUEDE CORREGIR. Se propone como
 *    `total * tipo de cambio`, y en cuanto lo tocas a mano deja de
 *    recalcularse. Es a proposito: el banco aplica su propio tipo de cambio y
 *    casi nunca cuadra al centavo con el del CFDI, y lo que hay que asentar es
 *    lo que de verdad salio del banco. El boton de la calculadora vuelve a la
 *    formula si te arrepientes.
 *
 * 3. UN BORRADOR NO ES UN GASTO. Mientras esta en borrador no tiene asiento y
 *    no aparece en el reporte maestro. Solo al REGISTRARLO se genera el asiento
 *    y entra a la contabilidad. Los recurrentes generan borradores justamente
 *    por eso: Telcel varia de mes a mes y Claude viene en USD con otro tipo de
 *    cambio cada vez, asi que alguien tiene que mirarlos.
 */

interface Gasto {
  id: string;
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
  metodo_pago: string | null;
  referencia_pago: string | null;
  pagado_en: string | null;
  cfdi_uuid: string | null;
  // Ya venia en el `select('*')` desde siempre, pero no estaba declarado, asi
  // que nada podia usarlo sin que tsc se quejara. Es lo que alimenta la
  // descarga del XML y el PDF generico.
  cfdi_xml: string | null;
  estado: string;
  periodo: string | null;
  asiento_id: string | null;
  notas: string | null;
}

interface PagoDeGasto {
  id: string;
  gasto_id: string;
  fecha: string;
  monto_mxn: number;
  metodo_pago: string | null;
  referencia: string | null;
}

interface Recurrente {
  id: string;
  nombre: string;
  cuenta_contable: string;
  proveedor: string;
  descripcion: string;
  moneda: string;
  subtotal_estimado: number;
  iva_estimado: number;
  dia_del_mes: number;
  activo: boolean;
}

interface Cuenta {
  code: string;
  name: string;
}

interface FormPlantilla {
  id: string | null;
  nombre: string;
  cuenta_contable: string;
  proveedor: string;
  descripcion: string;
  moneda: string;
  subtotal_estimado: string;
  iva_estimado: string;
  dia_del_mes: string;
  activo: boolean;
}

interface Formulario {
  id: string | null;
  fecha: string;
  cuenta_contable: string;
  proveedor: string;
  descripcion: string;
  moneda: string;
  tipo_cambio: string;
  subtotal: string;
  iva: string;
  total_mxn: string;
  metodo_pago: string;
  referencia_pago: string;
  pagado_en: string;
  cfdi_uuid: string;
  cfdi_xml: string;
  notas: string;
}

const HOY = () => new Date().toISOString().slice(0, 10);
const PERIODO_ACTUAL = () => new Date().toISOString().slice(0, 7);

/** "2026-07" -> "julio de 2026". Se arma a mediodia UTC para que el cambio de
 *  huso no corra el mes: `new Date('2026-07-01')` en UTC-6 cae en junio. */
const nombreDePeriodo = (periodo: string): string => {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, 1, 12)).toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const FORMULARIO_VACIO = (): Formulario => ({
  id: null,
  fecha: HOY(),
  cuenta_contable: '',
  proveedor: '',
  descripcion: '',
  moneda: 'MXN',
  tipo_cambio: '1',
  subtotal: '',
  iva: '',
  total_mxn: '',
  metodo_pago: '',
  referencia_pago: '',
  pagado_en: '',
  cfdi_uuid: '',
  cfdi_xml: '',
  notas: '',
});

const PLANTILLA_VACIA = (): FormPlantilla => ({
  id: null,
  nombre: '',
  cuenta_contable: '',
  proveedor: '',
  descripcion: '',
  moneda: 'MXN',
  subtotal_estimado: '',
  iva_estimado: '',
  dia_del_mes: '1',
  activo: true,
});

const aNumero = (texto: string): number => {
  const n = Number(String(texto).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  borrador:   { texto: 'Borrador',   clase: 'bg-amber-100 text-amber-800' },
  registrado: { texto: 'Registrado', clase: 'bg-emerald-100 text-emerald-800' },
  cancelado:  { texto: 'Cancelado',  clase: 'bg-gray-200 text-gray-600' },
};

const AdminGastos: React.FC = () => {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [recurrentes, setRecurrentes] = useState<Recurrente[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [rfcPlataforma, setRfcPlataforma] = useState('');

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisosCfdi, setAvisosCfdi] = useState<string[]>([]);

  const [pagos, setPagos] = useState<PagoDeGasto[]>([]);
  // El pago que se esta capturando, o null si el modal esta cerrado. Guarda el
  // gasto entero y no solo su id: el modal necesita el saldo y el proveedor.
  // Documentos: el XML que ya se guardaba pero no se podia mirar, y los
  // archivos que alguien sube como respaldo.
  const [soportes, setSoportes] = useState<SoporteDeGasto[]>([]);
  const [viendoDocs, setViendoDocs] = useState<Gasto | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const inputSoporte = useRef<HTMLInputElement>(null);

  // Carga masiva: muchos XML de golpe, todos como borradores.
  const [loteAbierto, setLoteAbierto] = useState(false);
  const [lote, setLote] = useState<LoteDeCfdi | null>(null);
  const [cuentaDelLote, setCuentaDelLote] = useState('');
  const [insertandoLote, setInsertandoLote] = useState(false);
  const inputLote = useRef<HTMLInputElement>(null);

  const [pagando, setPagando] = useState<Gasto | null>(null);
  const [formPago, setFormPago] = useState({ fecha: '', monto: '', metodo: '', referencia: '' });

  const [periodo, setPeriodo] = useState(PERIODO_ACTUAL());
  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | 'borrador' | 'registrado' | 'cancelado'>('todos');

  const [formAbierto, setFormAbierto] = useState(false);
  const [plantillaAbierta, setPlantillaAbierta] = useState(false);
  const [plantilla, setPlantilla] = useState<FormPlantilla>(PLANTILLA_VACIA());
  const [form, setForm] = useState<Formulario>(FORMULARIO_VACIO());
  // Cuando alguien toca el total en pesos, deja de recalcularse solo. Es
  // ESTADO y no un ref aunque solo mande sobre un efecto: el texto de ayuda
  // debajo del campo cambia con el, y con un ref ese texto se quedaria una
  // pintada atras cada vez que algo mas no forzara el re-render.
  const [totalMxnAMano, setTotalMxnAMano] = useState(false);
  const inputXml = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    const desde = `${periodo}-01`;
    const [anio, mes] = periodo.split('-').map(Number);
    const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);

    const [resGastos, resRec, resCuentas, resAjustes, resPagos, resSoportes] = await Promise.all([
      supabase.from('gastos_operacion').select('*')
        .gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }),
      supabase.from('gastos_recurrentes').select('*').order('nombre'),
      supabase.from('chart_of_accounts').select('code, name')
        .in('account_type', ['gasto', 'costo']).eq('is_active', true).order('code'),
      supabase.from('platform_settings').select('pac_issuer_rfc').limit(1).maybeSingle(),
      // Los pagos del periodo. Se traen por separado y no con un embed porque
      // un gasto de julio puede pagarse en agosto: el filtro de fecha es del
      // GASTO, y los pagos se ligan por id.
      supabase.from('pagos_de_gasto').select('*').order('fecha'),
      // Los soportes de TODOS los gastos del periodo. Son filas chicas (ruta y
      // nombre, no bytes), asi que traerlas de una vez evita una consulta por
      // gasto al abrir cada panel de documentos.
      supabase.from('soportes_de_gasto').select('*').order('created_at'),
    ]);

    // Los errores se muestran. Una lista vacia por un error de permisos se lee
    // igual que "no hay gastos", y esa confusion ya costo caro en otras
    // pantallas de este panel.
    const fallo = resGastos.error || resRec.error || resCuentas.error || resPagos.error;
    // El de soportes NO tumba la pantalla: si falla, los gastos se siguen
    // viendo y solo faltan los adjuntos. Pero se dice, no se traga.
    if (resSoportes.error) {
      console.error('AdminGastos: no se pudieron leer los soportes', resSoportes.error);
      setAviso('Los gastos se cargaron, pero no se pudieron leer sus archivos adjuntos.');
    }
    if (fallo) {
      setError(`No se pudieron cargar los gastos: ${fallo.message}`);
      setCargando(false);
      return;
    }
    if (resAjustes.error) {
      console.error('AdminGastos: no se pudo leer el RFC de la plataforma', resAjustes.error);
    }

    setGastos((resGastos.data ?? []) as Gasto[]);
    setPagos((resPagos.data ?? []) as PagoDeGasto[]);
    setSoportes((resSoportes.data ?? []) as SoporteDeGasto[]);
    setRecurrentes((resRec.data ?? []) as Recurrente[]);
    setCuentas((resCuentas.data ?? []) as Cuenta[]);
    setRfcPlataforma(resAjustes.data?.pac_issuer_rfc ?? '');
    setCargando(false);
  }, [periodo]);

  useEffect(() => { void cargar(); }, [cargar]);

  // ---------------------------------------------------------------------
  // El total en pesos: se propone, no se impone.
  // ---------------------------------------------------------------------
  const totalDivisa = useMemo(
    () => redondear(aNumero(form.subtotal) + aNumero(form.iva)),
    [form.subtotal, form.iva],
  );
  const totalMxnPropuesto = useMemo(
    () => redondear(totalDivisa * aNumero(form.tipo_cambio)),
    [totalDivisa, form.tipo_cambio],
  );

  // Lo que de verdad se va a guardar. NO se copia la propuesta a `form` desde
  // un efecto: hacerlo asi obliga a mantener sincronizadas dos fuentes del
  // mismo dato y a que cada cambio de tipo de cambio dispare un render extra.
  // Mientras nadie lo edite, el campo MUESTRA la formula; en cuanto lo editas,
  // `form.total_mxn` manda y la formula se queda de referencia en la ayuda.
  const totalMxn = totalMxnAMano ? redondear(aNumero(form.total_mxn)) : totalMxnPropuesto;
  const totalMxnVisible = totalMxnAMano
    ? form.total_mxn
    : (totalMxnPropuesto > 0 ? aDosDecimales(totalMxnPropuesto) : '');

  const cambiar = (campo: keyof Formulario, valor: string) => {
    if (campo === 'total_mxn') setTotalMxnAMano(true);
    setForm((f) => {
      const siguiente = { ...f, [campo]: valor };
      // En pesos el tipo de cambio solo puede ser 1 y la base de datos lo
      // obliga con un CHECK. Aqui se ajusta solo para que nadie choque contra
      // un error que se puede evitar.
      if (campo === 'moneda' && valor.toUpperCase() === 'MXN') siguiente.tipo_cambio = '1';
      return siguiente;
    });
  };

  const abrirNuevo = () => {
    setTotalMxnAMano(false);
    setForm(FORMULARIO_VACIO());
    setAvisosCfdi([]);
    setError(null);
    setFormAbierto(true);
  };

  const abrirEdicion = (g: Gasto) => {
    setTotalMxnAMano(true);   // lo guardado manda; no se recalcula solo
    setForm({
      id: g.id,
      fecha: g.fecha,
      cuenta_contable: g.cuenta_contable,
      proveedor: g.proveedor,
      descripcion: g.descripcion,
      moneda: g.moneda,
      tipo_cambio: String(g.tipo_cambio),
      subtotal: String(g.subtotal),
      iva: String(g.iva),
      total_mxn: String(g.total_mxn),
      metodo_pago: g.metodo_pago ?? '',
      referencia_pago: g.referencia_pago ?? '',
      pagado_en: g.pagado_en ?? '',
      cfdi_uuid: g.cfdi_uuid ?? '',
      cfdi_xml: '',
      notas: g.notas ?? '',
    });
    setAvisosCfdi([]);
    setError(null);
    setFormAbierto(true);
  };

  // ---------------------------------------------------------------------
  // El XML
  // ---------------------------------------------------------------------
  const cargarXml = async (archivo: File) => {
    setAvisosCfdi([]);
    setError(null);
    const texto = await archivo.text();
    const lectura = leerCfdiParaGasto(texto, rfcPlataforma);

    if (lectura.error || !lectura.propuesta) {
      setError(lectura.error ?? 'No se pudo leer el CFDI.');
      return;
    }

    const p = lectura.propuesta;
    // El total en pesos que propone el CFDI se respeta como propuesta: sigue
    // recalculandose si cambias el tipo de cambio, hasta que lo toques.
    setTotalMxnAMano(false);
    setForm((f) => ({
      ...f,
      fecha: p.fecha || f.fecha,
      proveedor: p.proveedor || f.proveedor,
      descripcion: p.descripcion || f.descripcion,
      moneda: p.moneda,
      tipo_cambio: p.tipoCambio > 0 ? String(p.tipoCambio) : '',
      subtotal: String(p.subtotal),
      iva: String(p.iva),
      cfdi_uuid: p.cfdiUuid,
      // Se guarda el XML entero: si manana dudas de un monto, se puede volver a
      // derivar del original en vez de creerle a la captura.
      cfdi_xml: texto,
    }));
    setAvisosCfdi(lectura.avisos);
  };

  // ---------------------------------------------------------------------
  // Documentos de un gasto
  // ---------------------------------------------------------------------
  const soportesDe = useCallback(
    (gastoId: string) => soportes.filter((x) => x.gasto_id === gastoId),
    [soportes],
  );

  /** Cuantos papeles tiene un gasto: el XML cuenta como uno. */
  const documentosDe = useCallback(
    (g: Gasto) => (g.cfdi_xml ? 1 : 0) + soportesDe(g.id).length,
    [soportesDe],
  );

  const bajarXml = (g: Gasto) => {
    if (!g.cfdi_xml) return;
    descargarTexto(`CFDI-${g.cfdi_uuid ?? g.id.slice(0, 8)}.xml`, g.cfdi_xml);
  };

  const bajarPdfDelXml = (g: Gasto) => {
    if (!g.cfdi_xml) return;
    // Devuelve false cuando el texto guardado no es un CFDI legible. No deberia
    // pasar —entro por el lector—, pero descargar un papel en blanco sin decir
    // nada seria peor que el error.
    if (!descargarPdfDeCfdi(g.cfdi_xml)) {
      setError('El XML guardado no se pudo leer como CFDI, asi que no se pudo armar el PDF.');
    }
  };

  const abrirSoporte = async (soporte: SoporteDeGasto) => {
    // El bucket es privado: no hay URL publica, se firma una que caduca.
    const { url, error: fallo } = await urlDeSoporte(supabase, soporte.ruta, 120);
    if (fallo || !url) { setError(fallo ?? 'No se pudo abrir el archivo.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const guardarSoporte = async (gasto: Gasto, archivo: File) => {
    setSubiendo(true);
    setError(null);
    const fallo = await subirSoporte(supabase, gasto.id, archivo);
    setSubiendo(false);
    if (fallo) { setError(fallo); return; }
    setAviso(`Se adjunto ${archivo.name}.`);
    void cargar();
  };

  const quitarSoporte = async (soporte: SoporteDeGasto) => {
    if (!window.confirm(`Quitar ${soporte.nombre}? El archivo se borra y no se puede deshacer.`)) return;
    setSubiendo(true);
    const fallo = await borrarSoporte(supabase, soporte);
    setSubiendo(false);
    if (fallo) { setError(fallo); return; }
    void cargar();
  };

  // ---------------------------------------------------------------------
  // Carga masiva de XML
  // ---------------------------------------------------------------------
  const leerLote = async (archivos: FileList) => {
    setError(null);
    const leidos = await Promise.all(
      [...archivos].map(async (f) => ({ nombre: f.name, texto: await f.text() })),
    );
    // Los UUID que ya estan capturados. Se consultan SIN filtro de periodo: un
    // CFDI de marzo tambien choca contra el indice unico aunque la pantalla
    // este mirando julio, y rechazarlo aqui da un motivo claro en vez de un
    // error de Postgres a mitad del lote.
    const { data, error: fallo } = await supabase
      .from('gastos_operacion').select('cfdi_uuid').not('cfdi_uuid', 'is', null);
    if (fallo) {
      setError(`No se pudieron comprobar los CFDI ya capturados: ${fallo.message}`);
      return;
    }
    const existentes = new Set((data ?? []).map((r: { cfdi_uuid: string }) => r.cfdi_uuid));
    setLote(prepararLoteDeCfdi(leidos, rfcPlataforma, cuentaDelLote, existentes));
  };

  const insertarLote = async () => {
    if (!lote || lote.borradores.length === 0) return;
    if (!cuentaDelLote) { setError('Elige la cuenta contable con la que nacen los borradores.'); return; }

    setInsertandoLote(true);
    setError(null);

    // Mismo criterio que en `guardar`: si la sesion no resuelve se deja que el
    // DEFAULT auth.uid() lo intente, pero no se calla el error.
    const { data: { session: sesion }, error: errorSesion } = await supabase.auth.getSession();
    if (errorSesion) {
      console.error('[AdminGastos] no se pudo resolver quien carga el lote:', errorSesion);
    }
    const autorDelLote = sesion?.user?.id;

    // La cuenta se aplica AQUI y no al preparar: asi se puede cambiar en el
    // dialogo sin tener que volver a leer los archivos.
    const filas = lote.borradores.map((b) => ({
      ...b,
      cuenta_contable: cuentaDelLote,
      ...(autorDelLote ? { creado_por: autorDelLote } : {}),
    }));

    const { error: fallo } = await supabase.from('gastos_operacion').insert(filas);
    setInsertandoLote(false);

    if (fallo) { setError(traducirError(fallo.message)); return; }

    setAviso(
      `Se cargaron ${filas.length} borrador${filas.length === 1 ? '' : 'es'}. `
      + 'Revisa cada uno: la cuenta contable es la misma para todos y el CFDI no dice cual va.',
    );
    setLoteAbierto(false);
    setLote(null);
    void cargar();
  };

  // ---------------------------------------------------------------------
  // Guardar y registrar
  // ---------------------------------------------------------------------
  const validar = (): string | null => {
    if (!form.fecha) return 'Falta la fecha.';
    if (!form.cuenta_contable) return 'Falta la cuenta contable.';
    if (!form.proveedor.trim()) return 'Falta el proveedor.';
    if (!form.descripcion.trim()) return 'Falta la descripcion.';
    if (totalDivisa <= 0) return 'El total tiene que ser mayor que cero.';
    if (aNumero(form.tipo_cambio) <= 0) {
      return form.moneda === 'MXN'
        ? 'El tipo de cambio de un gasto en pesos es 1.'
        : `El gasto viene en ${form.moneda} y falta el tipo de cambio. Sin el no se sabe cuanto salio en pesos.`;
    }
    if (totalMxn <= 0) return 'El total en pesos tiene que ser mayor que cero.';
    if (form.pagado_en && !form.metodo_pago.trim()) return 'Si el gasto ya se pago, falta decir con que metodo.';
    return null;
  };

  const guardar = async () => {
    const problema = validar();
    if (problema) { setError(problema); return; }

    setGuardando(true);
    setError(null);

    const fila = {
      fecha: form.fecha,
      cuenta_contable: form.cuenta_contable,
      proveedor: form.proveedor.trim(),
      descripcion: form.descripcion.trim(),
      moneda: form.moneda.toUpperCase(),
      tipo_cambio: aNumero(form.tipo_cambio),
      subtotal: redondear(aNumero(form.subtotal)),
      iva: redondear(aNumero(form.iva)),
      total: totalDivisa,
      total_mxn: totalMxn,
      metodo_pago: form.metodo_pago.trim() || null,
      referencia_pago: form.referencia_pago.trim() || null,
      pagado_en: form.pagado_en || null,
      cfdi_uuid: form.cfdi_uuid.trim() || null,
      notas: form.notas.trim() || null,
      ...(form.cfdi_xml ? { cfdi_xml: form.cfdi_xml } : {}),
    };

    // Quien lo captura. La columna existia desde el principio y NADIE la
    // llenaba: las capturas nacian con `creado_por` nulo, asi que no habia
    // forma de saber quien registro un gasto — y `gastos_operacion` tampoco
    // tiene trigger de auditoria. Importa desde que el permiso
    // `can_manage_expenses` se le puede dar a alguien que no es el super admin.
    //
    // Solo en el alta: en una edicion sobrescribiria al autor original con el
    // de quien corrige.
    //
    // La red de verdad es el DEFAULT auth.uid() de la tabla (20260911020000),
    // que cubre a cualquier cliente presente o futuro. Esto es el cinturon.
    //
    // Si no hay usuario, la clave se OMITE en vez de mandarse nula: en Postgres
    // un NULL explicito ANULA el DEFAULT —solo aplica cuando la columna no
    // viene—, asi que `creado_por: x ?? null` desactivaria justo la red que
    // pone la migracion. Comprobado contra Postgres 16 al escribirla.
    const { data: sesion, error: errorSesion } = await supabase.auth.getUser();
    if (errorSesion) {
      // No se aborta el guardado: el gasto es el dato que importa y perderlo
      // seria peor que guardarlo sin autor. Pero tampoco se calla, porque un
      // gasto sin autor no se distingue de uno capturado por el cron, y aqui
      // el DEFAULT auth.uid() tampoco va a salvarlo: si la sesion no resuelve
      // en el cliente, lo mas probable es que PostgREST tampoco la vea.
      console.error('[AdminGastos] no se pudo resolver quien captura el gasto:', errorSesion);
    }
    const autor = sesion?.user?.id;

    const { error: errorGuardar } = form.id
      ? await supabase.from('gastos_operacion').update(fila).eq('id', form.id)
      : await supabase.from('gastos_operacion')
          .insert({ ...fila, ...(autor ? { creado_por: autor } : {}) });

    setGuardando(false);
    if (errorGuardar) {
      setError(traducirError(errorGuardar.message));
      return;
    }
    setFormAbierto(false);

    // El gasto puede caer FUERA del mes que se esta viendo, y casi siempre asi
    // es al cargar un XML: el lector toma la fecha del CFDI —la de la factura—
    // mientras el filtro sigue en el mes actual. Sin esto la pantalla decia
    // "guardado" y enseguida mostraba la lista vacia, que se lee como que no se
    // guardo nada. Paso en la primera captura real, 11-sep-2026: una factura de
    // TikTok del 01-jul quedo invisible en el periodo de septiembre.
    //
    // Se mueve el filtro al mes del gasto en vez de solo avisar: el objetivo es
    // VERLO, y dejar al usuario cambiando el selector a mano despues de un
    // mensaje es pedirle que arregle algo que la pantalla ya sabe.
    const periodoDelGasto = form.fecha.slice(0, 7);
    const cambiaDeMes = periodoDelGasto !== periodo;

    const queHizo = form.id
      ? 'Gasto actualizado.'
      : 'Gasto guardado como borrador. Registralo para que entre a contabilidad.';
    setAviso(
      cambiaDeMes
        ? `${queHizo} Quedo en ${nombreDePeriodo(periodoDelGasto)} porque esa es su fecha, `
          + 'asi que se cambio el filtro para mostrartelo.'
        : queHizo,
    );

    if (cambiaDeMes) {
      // `cargar` se dispara solo por el efecto que depende de `periodo`.
      setPeriodo(periodoDelGasto);
      return;
    }
    void cargar();
  };

  const registrar = async (g: Gasto) => {
    setGuardando(true);
    setError(null);
    const { error: errorRegistrar } = await supabase.rpc('registrar_gasto_operacion', { p_gasto_id: g.id });
    setGuardando(false);
    if (errorRegistrar) { setError(traducirError(errorRegistrar.message)); return; }
    setAviso(`Gasto de ${g.proveedor} registrado. Ya cuenta en el reporte maestro.`);
    void cargar();
  };

  /**
   * Abre el modal de pago con el SALDO como monto propuesto. El caso normal es
   * pagar todo lo que falta; el parcial se escribe encima.
   */
  const abrirPago = (g: Gasto) => {
    setFormPago({
      fecha: new Date().toISOString().slice(0, 10),
      monto: saldoDe(g).toFixed(2),
      metodo: g.metodo_pago ?? '',
      referencia: '',
    });
    setPagando(g);
  };

  const guardarPago = async () => {
    if (!pagando) return;
    const monto = redondear(aNumero(formPago.monto));
    const saldo = saldoDe(pagando);

    // Se valida aqui ADEMAS de en la base. La funcion rechaza el sobrepago
    // igual, pero decirlo antes de ir al servidor evita que el usuario vea un
    // error de Postgres traducido a medias.
    if (monto <= 0) { setError('El monto del pago tiene que ser mayor que cero.'); return; }
    if (monto > saldo) {
      setError(`El pago (${formatCurrencyMXN(monto)}) excede el saldo pendiente (${formatCurrencyMXN(saldo)}).`);
      return;
    }
    if (!formPago.fecha) { setError('Captura la fecha del pago.'); return; }

    setGuardando(true);
    setError(null);
    const { error: errorPago } = await supabase.rpc('pagar_gasto_operacion', {
      p_gasto_id: pagando.id,
      p_fecha: formPago.fecha,
      p_monto_mxn: monto,
      p_metodo: formPago.metodo.trim() || null,
      p_referencia: formPago.referencia.trim() || null,
    });
    setGuardando(false);
    if (errorPago) { setError(traducirError(errorPago.message)); return; }

    const resta = redondear(saldo - monto);
    setAviso(resta > 0
      ? `Pago de ${formatCurrencyMXN(monto)} a ${pagando.proveedor} registrado. Quedan ${formatCurrencyMXN(resta)} por pagar.`
      : `Gasto de ${pagando.proveedor} saldado. Salio del banco y ya no figura como deuda.`);
    setPagando(null);
    void cargar();
  };

  const cancelar = async (g: Gasto) => {
    setGuardando(true);
    const { error: errorCancelar } = await supabase
      .from('gastos_operacion').update({ estado: 'cancelado' }).eq('id', g.id);
    setGuardando(false);
    if (errorCancelar) { setError(traducirError(errorCancelar.message)); return; }
    void cargar();
  };

  // ---------------------------------------------------------------------
  // Plantillas
  // ---------------------------------------------------------------------
  const cambiarPlantilla = (campo: keyof FormPlantilla, valor: string) =>
    setPlantilla((f) => ({ ...f, [campo]: valor }));

  const abrirPlantillaNueva = () => {
    setPlantilla(PLANTILLA_VACIA());
    setError(null);
    setPlantillaAbierta(true);
  };

  const abrirPlantilla = (r: Recurrente) => {
    setPlantilla({
      id: r.id,
      nombre: r.nombre,
      cuenta_contable: r.cuenta_contable,
      proveedor: r.proveedor,
      descripcion: r.descripcion,
      moneda: r.moneda,
      subtotal_estimado: String(r.subtotal_estimado),
      iva_estimado: String(r.iva_estimado),
      dia_del_mes: String(r.dia_del_mes),
      activo: r.activo,
    });
    setError(null);
    setPlantillaAbierta(true);
  };

  const guardarPlantilla = async () => {
    if (!plantilla.nombre.trim())          { setError('Falta el nombre de la plantilla.'); return; }
    if (!plantilla.cuenta_contable)        { setError('Falta la cuenta contable.'); return; }
    if (!plantilla.proveedor.trim())       { setError('Falta el proveedor.'); return; }
    if (!plantilla.descripcion.trim())     { setError('Falta la descripcion.'); return; }
    const dia = aNumero(plantilla.dia_del_mes);
    if (!Number.isInteger(dia) || dia < 1 || dia > 28) {
      // Hasta 28 y no 31: un recurrente al 31 no existiria en febrero, y "el
      // ultimo dia del mes" es otra regla que aqui no hace falta.
      setError('El dia del mes tiene que estar entre 1 y 28.');
      return;
    }

    setGuardando(true);
    setError(null);
    const fila = {
      nombre: plantilla.nombre.trim(),
      cuenta_contable: plantilla.cuenta_contable,
      proveedor: plantilla.proveedor.trim(),
      descripcion: plantilla.descripcion.trim(),
      moneda: plantilla.moneda.toUpperCase(),
      subtotal_estimado: redondear(aNumero(plantilla.subtotal_estimado)),
      iva_estimado: redondear(aNumero(plantilla.iva_estimado)),
      dia_del_mes: dia,
      activo: plantilla.activo,
    };
    const { error: errorGuardar } = plantilla.id
      ? await supabase.from('gastos_recurrentes').update(fila).eq('id', plantilla.id)
      : await supabase.from('gastos_recurrentes').insert(fila);

    setGuardando(false);
    if (errorGuardar) { setError(traducirError(errorGuardar.message)); return; }
    setPlantillaAbierta(false);
    setAviso(plantilla.id ? 'Plantilla actualizada.' : 'Plantilla creada. Genera los borradores del periodo cuando quieras.');
    void cargar();
  };

  const alternarPlantilla = async (r: Recurrente) => {
    setGuardando(true);
    const { error: errorAlternar } = await supabase
      .from('gastos_recurrentes').update({ activo: !r.activo }).eq('id', r.id);
    setGuardando(false);
    if (errorAlternar) { setError(traducirError(errorAlternar.message)); return; }
    void cargar();
  };

  const borrarPlantilla = async (r: Recurrente) => {
    setGuardando(true);
    setError(null);

    // Antes de borrar se cuenta lo que ya genero. La llave foranea es ON DELETE
    // SET NULL, asi que borrarla NO rompe nada... y ese es justo el problema:
    // los gastos que genero se quedan con `recurrente_id` en NULL y salen del
    // indice unico que impide dos borradores en el mismo periodo. Si despues se
    // vuelve a crear la plantilla, el generador crearia un SEGUNDO borrador de
    // un mes que ya estaba capturado. Desactivar no tiene ese problema, asi que
    // borrar se permite solo cuando no hay nada que perder.
    const { count, error: errorConteo } = await supabase
      .from('gastos_operacion')
      .select('id', { count: 'exact', head: true })
      .eq('recurrente_id', r.id);

    if (errorConteo) {
      setGuardando(false);
      setError(`No se pudo comprobar si la plantilla ya genero gastos: ${errorConteo.message}`);
      return;
    }
    if ((count ?? 0) > 0) {
      setGuardando(false);
      setError(
        `"${r.nombre}" ya genero ${count} gasto(s) y por eso no se borra: los gastos perderian su vinculo y ` +
        'el generador podria volver a crear un borrador de un mes ya capturado. Desactivala en vez de borrarla.',
      );
      return;
    }

    const { error: errorBorrar } = await supabase.from('gastos_recurrentes').delete().eq('id', r.id);
    setGuardando(false);
    if (errorBorrar) { setError(traducirError(errorBorrar.message)); return; }
    setAviso(`Plantilla "${r.nombre}" borrada.`);
    void cargar();
  };

  const generarRecurrentes = async () => {
    setGuardando(true);
    setError(null);
    const { data, error: errorGenerar } =
      await supabase.rpc('generar_borradores_de_gastos_recurrentes', { p_periodo: periodo });
    setGuardando(false);
    if (errorGenerar) { setError(traducirError(errorGenerar.message)); return; }
    const creados = Number(data ?? 0);
    setAviso(creados === 0
      ? `Los recurrentes de ${periodo} ya estaban generados. No se duplico nada.`
      : `Se crearon ${creados} borradores para ${periodo}. Revisa los importes antes de registrarlos.`);
    void cargar();
  };

  // ---------------------------------------------------------------------
  // Totales del periodo
  // ---------------------------------------------------------------------
  const visibles = useMemo(
    () => (estadoFiltro === 'todos' ? gastos : gastos.filter((g) => g.estado === estadoFiltro)),
    [gastos, estadoFiltro],
  );
  /** Lo abonado a cada gasto, por id. Un gasto puede tener varios pagos. */
  const pagadoPorGasto = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pagos) {
      m.set(p.gasto_id, redondear((m.get(p.gasto_id) ?? 0) + Number(p.monto_mxn)));
    }
    return m;
  }, [pagos]);

  const saldoDe = (g: Gasto): number =>
    redondear(Number(g.total_mxn) - (pagadoPorGasto.get(g.id) ?? 0));

  const totales = useMemo(() => {
    const registrados = gastos.filter((g) => g.estado === 'registrado');
    // Se suma lo ABONADO y lo que RESTA, no el total de los gastos marcados
    // pagados: con parcialidades un gasto esta en los dos lados a la vez, y la
    // version anterior —que contaba el total entero segun `pagado_en`— mandaba
    // los 232 completos a «por pagar» aunque ya se hubieran abonado 100.
    const abonado = registrados.reduce(
      (s, g) => s + (pagadoPorGasto.get(g.id) ?? 0), 0);
    return {
      registrado: registrados.reduce((s, g) => s + Number(g.total_mxn), 0),
      pagado: redondear(abonado),
      porPagar: redondear(registrados.reduce((s, g) => s + saldoDe(g), 0)),
      borradores: gastos.filter((g) => g.estado === 'borrador').length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastos, pagadoPorGasto]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gastos de operacion</h1>
          <p className="text-sm text-gray-600 mt-1">
            Renta, internet, software, viaticos. Lo que se registra aqui entra al reporte maestro.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() => void cargar()} disabled={cargando}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={() => { setLote(null); setLoteAbierto(true); }}
            title="Carga varios XML de golpe. Todos entran como borradores para revisarlos despues."
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            <Layers className="h-4 w-4" /> Cargar XML en masa
          </button>
          <button
            onClick={abrirNuevo}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
          >
            <Plus className="h-4 w-4" /> Nuevo gasto
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">✕</button>
        </div>
      )}
      {aviso && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso(null)} className="text-emerald-600 hover:text-emerald-800">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Tarjeta titulo="Gasto registrado" valor={formatCurrencyMXN(totales.registrado)} nota="del periodo" />
        <Tarjeta titulo="Ya pagado" valor={formatCurrencyMXN(totales.pagado)} nota="salio del banco" />
        <Tarjeta titulo="Por pagar" valor={formatCurrencyMXN(totales.porPagar)} nota="deuda con proveedores" />
        <Tarjeta titulo="Borradores" valor={String(totales.borradores)} nota="sin asiento todavia" />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Formulario                                                        */}
      {/* ---------------------------------------------------------------- */}
      {formAbierto && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{form.id ? 'Editar gasto' : 'Nuevo gasto'}</h2>
            <button onClick={() => setFormAbierto(false)} className="text-gray-400 hover:text-gray-600">
              <XCircle className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-4 py-3">
            <button
              onClick={() => inputXml.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white rounded-lg text-sm hover:bg-gray-50"
            >
              <Upload className="h-4 w-4" /> Cargar XML del CFDI
            </button>
            <input
              ref={inputXml} type="file" accept=".xml,text/xml,application/xml" className="hidden"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) void cargarXml(archivo);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-gray-600 flex-1 min-w-[16rem]">
              El XML rellena los campos y se guarda completo, pero todo queda editable: revisa antes de guardar.
              Se comprueba que la factura este a nombre de {rfcPlataforma || '(RFC sin configurar)'}.
            </p>
          </div>

          {avisosCfdi.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Info className="h-4 w-4" /> Revisa esto del CFDI
              </div>
              <ul className="list-disc pl-6 space-y-1">
                {avisosCfdi.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Campo etiqueta="Fecha">
              <input type="date" value={form.fecha} onChange={(e) => cambiar('fecha', e.target.value)} className={CLASE_INPUT} />
            </Campo>
            <Campo etiqueta="Cuenta contable">
              <select value={form.cuenta_contable} onChange={(e) => cambiar('cuenta_contable', e.target.value)} className={CLASE_INPUT}>
                <option value="">Selecciona una cuenta</option>
                {cuentas.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Proveedor">
              <input value={form.proveedor} onChange={(e) => cambiar('proveedor', e.target.value)} className={CLASE_INPUT} placeholder="Telcel, Anthropic, arrendador..." />
            </Campo>

            <Campo etiqueta="Descripcion" ancho="md:col-span-3">
              <input value={form.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} className={CLASE_INPUT} placeholder="Internet de oficina, septiembre" />
            </Campo>

            <Campo etiqueta="Moneda">
              <input value={form.moneda} onChange={(e) => cambiar('moneda', e.target.value.toUpperCase().slice(0, 3))} className={CLASE_INPUT} maxLength={3} />
            </Campo>
            <Campo
              etiqueta="Tipo de cambio"
              ayuda={form.moneda === 'MXN' ? 'En pesos siempre es 1.' : 'El que uses para declarar.'}
            >
              <input
                type="number" step="0.000001" min="0"
                value={form.tipo_cambio}
                onChange={(e) => cambiar('tipo_cambio', e.target.value)}
                disabled={form.moneda === 'MXN'}
                className={`${CLASE_INPUT} ${form.moneda === 'MXN' ? 'bg-gray-100 text-gray-500' : ''}`}
              />
            </Campo>
            <Campo etiqueta="IVA" ayuda="Dejalo en cero si el proveedor no lo traslada.">
              <input type="number" step="0.01" min="0" value={form.iva} onChange={(e) => cambiar('iva', e.target.value)} className={CLASE_INPUT} placeholder="0.00" />
            </Campo>

            <Campo etiqueta="Subtotal">
              <input type="number" step="0.01" min="0" value={form.subtotal} onChange={(e) => cambiar('subtotal', e.target.value)} className={CLASE_INPUT} placeholder="0.00" />
            </Campo>
            <Campo etiqueta={`Total en ${form.moneda || 'la divisa'}`} ayuda="Se calcula: subtotal + IVA.">
              <input value={totalDivisa ? totalDivisa.toFixed(2) : ''} readOnly className={`${CLASE_INPUT} bg-gray-100 text-gray-600`} />
            </Campo>
            <Campo
              etiqueta="Total en pesos (esto se asienta)"
              ayuda={
                totalMxnAMano
                  ? `Editado a mano. La formula daria ${totalMxnPropuesto ? formatCurrencyMXN(totalMxnPropuesto) : '—'}.`
                  : 'Calculado como total x tipo de cambio. Puedes corregirlo.'
              }
            >
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0" value={totalMxnVisible} onChange={(e) => cambiar('total_mxn', e.target.value)} className={CLASE_INPUT} />
                <button
                  type="button"
                  title="Volver al total calculado"
                  onClick={() => setTotalMxnAMano(false)}
                  className="px-3 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  <Calculator className="h-4 w-4" />
                </button>
              </div>
            </Campo>

            <Campo etiqueta="Pagado el" ayuda="Vacio = todavia se debe.">
              <input type="date" value={form.pagado_en} onChange={(e) => cambiar('pagado_en', e.target.value)} className={CLASE_INPUT} />
            </Campo>
            <Campo etiqueta="Metodo de pago">
              <input value={form.metodo_pago} onChange={(e) => cambiar('metodo_pago', e.target.value)} className={CLASE_INPUT} placeholder="spei, tarjeta, efectivo" />
            </Campo>
            <Campo etiqueta="Referencia">
              <input value={form.referencia_pago} onChange={(e) => cambiar('referencia_pago', e.target.value)} className={CLASE_INPUT} placeholder="Folio de la transferencia" />
            </Campo>

            <Campo etiqueta="UUID del CFDI" ancho="md:col-span-2">
              <input value={form.cfdi_uuid} onChange={(e) => cambiar('cfdi_uuid', e.target.value)} className={CLASE_INPUT} placeholder="Se rellena solo al cargar el XML" />
            </Campo>
            <Campo etiqueta="Notas">
              <input value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} className={CLASE_INPUT} />
            </Campo>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button onClick={() => setFormAbierto(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancelar
            </button>
            <button
              onClick={() => void guardar()} disabled={guardando}
              className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Guardar borrador'}
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Lista                                                             */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
          {(['todos', 'borrador', 'registrado', 'cancelado'] as const).map((e) => (
            <button
              key={e} onClick={() => setEstadoFiltro(e)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                estadoFiltro === e ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {e === 'todos' ? 'Todos' : ETIQUETA_ESTADO[e].texto}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Fecha</th>
                <th className="px-4 py-3 text-left font-medium">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium">Cuenta</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">En pesos</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cargando && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Cargando...</td></tr>
              )}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  No hay gastos en {periodo} con ese filtro.
                </td></tr>
              )}
              {visibles.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{g.fecha}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{g.proveedor}</div>
                    <div className="text-xs text-gray-500">{g.descripcion}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {g.cfdi_uuid && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {g.cfdi_uuid.slice(0, 8)}
                        </span>
                      )}
                      {/* El contador va aqui y no en una columna aparte: la
                          tabla ya tiene siete y el dato pertenece al gasto. */}
                      <button
                        onClick={() => setViendoDocs(g)}
                        title="Ver el XML, bajar el PDF y adjuntar comprobantes"
                        className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1"
                      >
                        <Paperclip className="h-3 w-3" />
                        {documentosDe(g) === 0
                          ? 'Sin documentos'
                          : `${documentosDe(g)} documento${documentosDe(g) === 1 ? '' : 's'}`}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{g.cuenta_contable}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                    {Number(g.total).toFixed(2)} {g.moneda}
                    {g.moneda !== 'MXN' && (
                      faltaTipoDeCambio(g)
                        ? <div className="text-xs text-amber-700 font-medium">falta el TC</div>
                        : <div className="text-xs text-gray-400">TC {Number(g.tipo_cambio)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                    {formatCurrencyMXN(Number(g.total_mxn))}
                    <div className="text-xs font-normal text-gray-400">
                      {g.pagado_en ? `pagado ${g.pagado_en}` : 'por pagar'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {g.estado !== 'registrado' ? (
                      <span className="text-gray-300">—</span>
                    ) : saldoDe(g) <= 0 ? (
                      <span className="text-emerald-600 text-xs font-medium">Pagado</span>
                    ) : (
                      <>
                        <span className="text-amber-700 font-medium">{formatCurrencyMXN(saldoDe(g))}</span>
                        {/* Solo se dice «de X» cuando hubo un abono: en un gasto
                            sin pagos el saldo ES el total y repetirlo es ruido. */}
                        {(pagadoPorGasto.get(g.id) ?? 0) > 0 && (
                          <span className="block text-[11px] text-gray-500">
                            de {formatCurrencyMXN(Number(g.total_mxn))}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${ETIQUETA_ESTADO[g.estado]?.clase ?? ''}`}>
                      {ETIQUETA_ESTADO[g.estado]?.texto ?? g.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {g.estado === 'borrador' && (
                      <>
                        <button onClick={() => abrirEdicion(g)} className="text-gray-600 hover:text-gray-900 text-sm mr-3">
                          Editar
                        </button>
                        <button
                          onClick={() => void registrar(g)}
                          disabled={guardando || faltaTipoDeCambio(g)}
                          title={faltaTipoDeCambio(g)
                            ? `Captura el tipo de cambio de ${g.moneda} antes de registrar: con 1 se asentarian ${g.moneda} como pesos.`
                            : 'Genera el asiento contable'}
                          className="text-emerald-700 hover:text-emerald-900 text-sm font-medium mr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Registrar
                        </button>
                        <button onClick={() => void cancelar(g)} disabled={guardando} className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                          <Trash2 className="h-4 w-4 inline" />
                        </button>
                      </>
                    )}
                    {g.estado === 'registrado' && (
                      <>
                        {saldoDe(g) > 0 && (
                          <button
                            onClick={() => abrirPago(g)}
                            disabled={guardando}
                            title="Genera el asiento del pago: carga a proveedores y abona a bancos"
                            className="text-emerald-700 hover:text-emerald-900 text-sm font-medium mr-3 disabled:opacity-40"
                          >
                            Registrar pago
                          </button>
                        )}
                        <span className="text-xs text-gray-400">Asiento {g.asiento_id?.slice(0, 8)}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Documentos de un gasto                                            */}
      {/* ---------------------------------------------------------------- */}
      {viendoDocs && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">Documentos</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {viendoDocs.proveedor} — {viendoDocs.descripcion}
                </p>
              </div>
              <button onClick={() => setViendoDocs(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* --- El CFDI --- */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">CFDI</h4>
                {viendoDocs.cfdi_xml ? (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span className="font-mono text-xs">{viendoDocs.cfdi_uuid ?? 'sin folio fiscal'}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      El XML es el documento fiscal. El PDF se arma a partir de el cada vez que lo pides,
                      asi que siempre coincide con el original.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => bajarXml(viendoDocs)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50"
                      >
                        <Download className="h-3.5 w-3.5" /> Descargar XML
                      </button>
                      <button
                        onClick={() => bajarPdfDelXml(viendoDocs)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50"
                      >
                        <FileDown className="h-3.5 w-3.5" /> Ver como PDF
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 rounded-lg border border-dashed border-gray-300 p-3">
                    Este gasto se capturo a mano, sin CFDI. Puedes adjuntar el PDF de la factura abajo.
                  </p>
                )}
              </div>

              {/* --- Los soportes --- */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-900">Soportes</h4>
                  <button
                    onClick={() => inputSoporte.current?.click()}
                    disabled={subiendo}
                    className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" /> {subiendo ? 'Subiendo...' : 'Adjuntar archivo'}
                  </button>
                  <input
                    ref={inputSoporte} type="file" className="hidden"
                    accept={TIPOS_ACEPTADOS.join(',')}
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      if (archivo && viendoDocs) void guardarSoporte(viendoDocs, archivo);
                      e.target.value = '';
                    }}
                  />
                </div>

                {soportesDe(viendoDocs.id).length === 0 ? (
                  <p className="text-sm text-gray-500 rounded-lg border border-dashed border-gray-300 p-3">
                    Nada adjunto todavia. Aqui va el PDF del proveedor, el comprobante de la
                    transferencia o el contrato. Ninguno es obligatorio.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {soportesDe(viendoDocs.id).map((x) => (
                      <li key={x.id} className="flex items-center gap-3 px-3 py-2">
                        <Paperclip className="h-4 w-4 text-gray-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-gray-800 truncate">{x.nombre}</div>
                          <div className="text-xs text-gray-400">
                            {x.bytes ? `${(x.bytes / 1024).toFixed(0)} KB` : ''}
                            {x.created_at ? ` · ${x.created_at.slice(0, 10)}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => void abrirSoporte(x)}
                          className="text-xs text-gray-600 hover:text-red-600"
                        >
                          Abrir
                        </button>
                        <button
                          onClick={() => void quitarSoporte(x)}
                          disabled={subiendo}
                          className="text-gray-300 hover:text-red-600 disabled:opacity-50"
                          title="Quitar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-200 text-right">
              <button
                onClick={() => setViendoDocs(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Carga masiva de XML                                               */}
      {/* ---------------------------------------------------------------- */}
      {loteAbierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">Cargar XML en masa</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Todos entran como BORRADORES. Ninguno se registra ni genera asiento.
                </p>
              </div>
              <button
                onClick={() => { setLoteAbierto(false); setLote(null); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta contable</label>
                <select
                  value={cuentaDelLote}
                  onChange={(e) => setCuentaDelLote(e.target.value)}
                  className={CLASE_INPUT}
                >
                  <option value="">Elige una cuenta...</option>
                  {cuentas.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                  ))}
                </select>
                {/* Esto no es un detalle: el CFDI dice quien cobra y cuanto,
                    pero no a que cuenta va el gasto. Eso es criterio contable. */}
                <p className="text-xs text-gray-500 mt-1">
                  El CFDI no dice a que cuenta va el gasto: eso es criterio contable, no dato fiscal.
                  Todos nacen con esta y la corriges despues en los que no vayan aqui.
                </p>
              </div>

              <div>
                <button
                  onClick={() => inputLote.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" /> Elegir archivos XML
                </button>
                <input
                  ref={inputLote} type="file" multiple className="hidden"
                  accept=".xml,text/xml,application/xml"
                  onChange={(e) => {
                    if (e.target.files?.length) void leerLote(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {lote && (
                <>
                  <div className="flex gap-3 text-sm">
                    <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">
                      {lote.listos} listo{lote.listos === 1 ? '' : 's'}
                    </span>
                    {lote.rechazados > 0 && (
                      <span className="px-2 py-1 rounded bg-red-50 text-red-800">
                        {lote.rechazados} sin cargar
                      </span>
                    )}
                  </div>

                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 max-h-72 overflow-y-auto">
                    {lote.resultados.map((r) => (
                      <li key={r.nombre} className="px-3 py-2 text-sm">
                        <div className="flex items-start gap-2">
                          {r.borrador
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                            : <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
                          <div className="min-w-0 flex-1">
                            <div className="text-gray-800 truncate">{r.nombre}</div>
                            {r.borrador && (
                              <div className="text-xs text-gray-500">
                                {r.borrador.proveedor} · {r.borrador.fecha} ·{' '}
                                {r.borrador.total.toFixed(2)} {r.borrador.moneda}
                              </div>
                            )}
                            {r.motivo && <div className="text-xs text-red-700 mt-0.5">{r.motivo}</div>}
                            {r.avisos.map((a) => (
                              <div key={a} className="text-xs text-amber-700 mt-0.5">{a}</div>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => { setLoteAbierto(false); setLote(null); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void insertarLote()}
                disabled={insertandoLote || !lote || lote.listos === 0 || !cuentaDelLote}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {insertandoLote
                  ? 'Cargando...'
                  : `Cargar ${lote?.listos ?? 0} borrador${(lote?.listos ?? 0) === 1 ? '' : 'es'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Pago de un gasto registrado                                       */}
      {/* ---------------------------------------------------------------- */}
      {pagando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-900">Registrar pago</h2>
              <button onClick={() => setPagando(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {pagando.proveedor} — saldo pendiente{' '}
              <span className="font-medium text-amber-700">{formatCurrencyMXN(saldoDe(pagando))}</span>
              {' '}de {formatCurrencyMXN(Number(pagando.total_mxn))}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Fecha del pago</label>
                <input
                  type="date" value={formPago.fecha}
                  min={pagando.fecha}
                  onChange={(e) => setFormPago({ ...formPago, fecha: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">No puede ser anterior al gasto.</p>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Monto</label>
                <input
                  type="text" value={formPago.monto}
                  onChange={(e) => setFormPago({ ...formPago, monto: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Viene con el saldo completo. Cambialo si es un pago parcial.
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Metodo de pago</label>
                <input
                  type="text" value={formPago.metodo} placeholder="spei, tarjeta, efectivo"
                  onChange={(e) => setFormPago({ ...formPago, metodo: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Referencia</label>
                <input
                  type="text" value={formPago.referencia} placeholder="Folio de la transferencia"
                  onChange={(e) => setFormPago({ ...formPago, referencia: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Genera un asiento: carga a Acreedores diversos y abono a Bancos. El gasto
              queda saldado solo cuando el saldo llega a cero.
            </p>

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setPagando(null)} className="px-4 py-2 text-gray-600 hover:text-gray-900">
                Cancelar
              </button>
              <button
                onClick={() => void guardarPago()} disabled={guardando}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Registrar pago
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Recurrentes                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Gastos recurrentes</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void generarRecurrentes()} disabled={guardando || recurrentes.length === 0}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Generar borradores de {periodo}
            </button>
            <button
              onClick={abrirPlantillaNueva}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" /> Nueva plantilla
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          Las plantillas generan BORRADORES, nunca gastos registrados: el importe de Telcel cambia cada mes y
          el de Claude viene en USD con otro tipo de cambio. Generarlo dos veces el mismo mes no duplica nada.
        </p>

        {plantillaAbierta && (
          <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {plantilla.id ? 'Editar plantilla' : 'Nueva plantilla'}
              </h3>
              <button onClick={() => setPlantillaAbierta(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Campo etiqueta="Nombre" ayuda="Como la vas a reconocer en la lista.">
                <input value={plantilla.nombre} onChange={(e) => cambiarPlantilla('nombre', e.target.value)}
                  className={CLASE_INPUT} placeholder="Telcel oficina, Claude, renta" />
              </Campo>
              <Campo etiqueta="Cuenta contable">
                <select value={plantilla.cuenta_contable} onChange={(e) => cambiarPlantilla('cuenta_contable', e.target.value)} className={CLASE_INPUT}>
                  <option value="">Selecciona una cuenta</option>
                  {cuentas.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Proveedor">
                <input value={plantilla.proveedor} onChange={(e) => cambiarPlantilla('proveedor', e.target.value)}
                  className={CLASE_INPUT} placeholder="Radiomovil Dipsa, Anthropic" />
              </Campo>

              <Campo etiqueta="Descripcion" ancho="md:col-span-3">
                <input value={plantilla.descripcion} onChange={(e) => cambiarPlantilla('descripcion', e.target.value)}
                  className={CLASE_INPUT} placeholder="Internet de oficina" />
              </Campo>

              <Campo etiqueta="Moneda">
                <input value={plantilla.moneda} maxLength={3}
                  onChange={(e) => cambiarPlantilla('moneda', e.target.value.toUpperCase().slice(0, 3))}
                  className={CLASE_INPUT} />
              </Campo>
              <Campo etiqueta="Subtotal estimado" ayuda="Se corrige cada mes al revisar el borrador.">
                <input type="number" step="0.01" min="0" value={plantilla.subtotal_estimado}
                  onChange={(e) => cambiarPlantilla('subtotal_estimado', e.target.value)} className={CLASE_INPUT} placeholder="0.00" />
              </Campo>
              <Campo etiqueta="IVA estimado" ayuda="Cero si el proveedor no lo traslada.">
                <input type="number" step="0.01" min="0" value={plantilla.iva_estimado}
                  onChange={(e) => cambiarPlantilla('iva_estimado', e.target.value)} className={CLASE_INPUT} placeholder="0.00" />
              </Campo>

              <Campo etiqueta="Dia del mes" ayuda="Del 1 al 28: el 31 no existe en febrero.">
                <input type="number" min={1} max={28} value={plantilla.dia_del_mes}
                  onChange={(e) => cambiarPlantilla('dia_del_mes', e.target.value)} className={CLASE_INPUT} />
              </Campo>
              <Campo etiqueta="Activa" ayuda="Solo las activas generan borradores.">
                <label className="flex items-center gap-2 text-sm text-gray-700 py-2">
                  <input type="checkbox" checked={plantilla.activo}
                    onChange={(e) => setPlantilla((f) => ({ ...f, activo: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300" />
                  Genera borradores cada mes
                </label>
              </Campo>
            </div>

            {plantilla.moneda !== 'MXN' && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  La plantilla NO guarda tipo de cambio, a proposito: cambia cada mes. El borrador va a nacer
                  con un 1 de relleno y no se puede registrar hasta que captures el tipo de cambio del periodo.
                </span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button onClick={() => setPlantillaAbierta(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancelar
              </button>
              <button onClick={() => void guardarPlantilla()} disabled={guardando}
                className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50">
                {guardando ? 'Guardando...' : plantilla.id ? 'Guardar cambios' : 'Crear plantilla'}
              </button>
            </div>
          </div>
        )}

        {recurrentes.length === 0 ? (
          <p className="text-sm text-gray-500">
            Todavia no hay plantillas. Crea una para Telcel, la renta o Claude y genera sus borradores cada mes.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recurrentes.map((r) => (
              <li key={r.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-[14rem]">
                  <span className={`font-medium ${r.activo ? 'text-gray-900' : 'text-gray-400'}`}>{r.nombre}</span>
                  <span className="text-gray-500"> — {r.proveedor}, cuenta {r.cuenta_contable}, dia {r.dia_del_mes}</span>
                  {!r.activo && <span className="ml-2 text-xs text-gray-400">(inactiva, no genera nada)</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-600">
                    {(Number(r.subtotal_estimado) + Number(r.iva_estimado)).toFixed(2)} {r.moneda}
                  </span>
                  <button onClick={() => abrirPlantilla(r)} className="text-gray-600 hover:text-gray-900">
                    Editar
                  </button>
                  <button onClick={() => void alternarPlantilla(r)} disabled={guardando}
                    className="text-gray-600 hover:text-gray-900 disabled:opacity-50">
                    {r.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => void borrarPlantilla(r)} disabled={guardando}
                    title="Solo se puede borrar si todavia no genero ningun gasto"
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const CLASE_INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500';

/**
 * Un borrador recurrente en moneda extranjera nace con `tipo_cambio = 1` porque
 * la columna no admite 0 ni NULL y el tipo de cambio del mes no se sabe al
 * generarlo. Ese 1 es relleno, no un dato: registrarlo asentaria dolares como
 * si fueran pesos. La base lo prohibe con un CHECK; esto solo lo dice antes.
 */
const faltaTipoDeCambio = (g: Gasto): boolean =>
  g.moneda !== 'MXN' && Number(g.tipo_cambio) === 1;

/** Formatea el total propuesto igual que lo escribiria una persona. */
const aDosDecimales = (n: number): string => n.toFixed(2);

/**
 * Los errores de Postgres son exactos pero ilegibles. Se traducen los que una
 * persona puede provocar desde esta pantalla; el resto se muestra tal cual,
 * porque esconder un error desconocido es peor que enseñarlo feo.
 */
function traducirError(mensaje: string): string {
  if (mensaje.includes('gastos_mxn_tipo_cambio_uno')) return 'Un gasto en pesos tiene que llevar tipo de cambio 1.';
  if (mensaje.includes('gastos_total_cuadra')) return 'El total no cuadra con subtotal + IVA.';
  if (mensaje.includes('gastos_operacion_cfdi_unico')) return 'Ese CFDI ya se capturo antes. Buscalo en la lista en vez de capturarlo otra vez.';
  if (mensaje.includes('gastos_registrado_con_tipo_de_cambio_real'))
    return 'Falta capturar el tipo de cambio del periodo. Un gasto en moneda extranjera no se puede registrar con tipo de cambio 1: se asentarian dolares como si fueran pesos.';
  if (mensaje.includes('gastos_registrado_tiene_asiento')) return 'Un gasto registrado necesita su asiento. Usa el boton Registrar en vez de cambiar el estado a mano.';
  if (mensaje.includes('cuenta de gasto o costo')) return mensaje;
  if (mensaje.includes('No autorizado')) return 'No tienes el permiso para capturar gastos. Pideselo a un super admin (permiso "Gestionar gastos").';
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level'))
    return 'No tienes el permiso para capturar gastos. Pideselo a un super admin (permiso "Gestionar gastos").';
  return mensaje;
}

const Tarjeta: React.FC<{ titulo: string; valor: string; nota: string }> = ({ titulo, valor, nota }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="text-xs text-gray-500">{titulo}</div>
    <div className="text-xl font-bold text-gray-900 mt-1">{valor}</div>
    <div className="text-xs text-gray-400 mt-0.5">{nota}</div>
  </div>
);

const Campo: React.FC<{ etiqueta: string; ayuda?: string; ancho?: string; children: React.ReactNode }> =
  ({ etiqueta, ayuda, ancho, children }) => (
    <div className={ancho}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{etiqueta}</label>
      {children}
      {ayuda && <p className="text-xs text-gray-500 mt-1">{ayuda}</p>}
    </div>
  );

export default AdminGastos;
