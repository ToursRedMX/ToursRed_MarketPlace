import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, RefreshCw, AlertCircle, Info, CheckCircle2, XCircle,
  FileText, Repeat, Calculator, Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { leerCfdiParaGasto } from '../../utils/cfdiXml';

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
  estado: string;
  periodo: string | null;
  asiento_id: string | null;
  notas: string | null;
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

    const [resGastos, resRec, resCuentas, resAjustes] = await Promise.all([
      supabase.from('gastos_operacion').select('*')
        .gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }),
      supabase.from('gastos_recurrentes').select('*').order('nombre'),
      supabase.from('chart_of_accounts').select('code, name')
        .in('account_type', ['gasto', 'costo']).eq('is_active', true).order('code'),
      supabase.from('platform_settings').select('pac_issuer_rfc').limit(1).maybeSingle(),
    ]);

    // Los errores se muestran. Una lista vacia por un error de permisos se lee
    // igual que "no hay gastos", y esa confusion ya costo caro en otras
    // pantallas de este panel.
    const fallo = resGastos.error || resRec.error || resCuentas.error;
    if (fallo) {
      setError(`No se pudieron cargar los gastos: ${fallo.message}`);
      setCargando(false);
      return;
    }
    if (resAjustes.error) {
      console.error('AdminGastos: no se pudo leer el RFC de la plataforma', resAjustes.error);
    }

    setGastos((resGastos.data ?? []) as Gasto[]);
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

    const { error: errorGuardar } = form.id
      ? await supabase.from('gastos_operacion').update(fila).eq('id', form.id)
      : await supabase.from('gastos_operacion').insert(fila);

    setGuardando(false);
    if (errorGuardar) {
      setError(traducirError(errorGuardar.message));
      return;
    }
    setFormAbierto(false);
    setAviso(form.id ? 'Gasto actualizado.' : 'Gasto guardado como borrador. Registralo para que entre a contabilidad.');
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
  const totales = useMemo(() => {
    const registrados = gastos.filter((g) => g.estado === 'registrado');
    return {
      registrado: registrados.reduce((s, g) => s + Number(g.total_mxn), 0),
      pagado: registrados.filter((g) => g.pagado_en).reduce((s, g) => s + Number(g.total_mxn), 0),
      porPagar: registrados.filter((g) => !g.pagado_en).reduce((s, g) => s + Number(g.total_mxn), 0),
      borradores: gastos.filter((g) => g.estado === 'borrador').length,
    };
  }, [gastos]);

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
                    {g.cfdi_uuid && (
                      <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <FileText className="h-3 w-3" /> {g.cfdi_uuid.slice(0, 8)}
                      </div>
                    )}
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
                      <span className="text-xs text-gray-400">Asiento {g.asiento_id?.slice(0, 8)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
