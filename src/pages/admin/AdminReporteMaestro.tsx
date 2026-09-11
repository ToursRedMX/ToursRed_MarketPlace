import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Filter, Search, TrendingUp, TrendingDown, Wallet, Landmark,
  BarChart2, Download, RefreshCw, Calendar, Tag, AlertCircle, Info,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

/**
 * Reporte maestro: el log financiero de la plataforma.
 *
 * ============================================================================
 * POR QUE ESTA PANTALLA YA NO CALCULA NADA
 * ============================================================================
 *
 * Hasta el 10-sep-2026 esta pantalla armaba sus filas aqui mismo, con 13
 * bloques que consultaban 13 tablas y sumaban a mano. Eso permitio tres
 * errores que no se ven al leer el codigo:
 *
 *   * Leia `bookings.platform_revenue` como si fuera el ingreso de la
 *     plataforma. No lo es: solo trae cargos por servicio, sin la comision.
 *   * Leia `cancellation_penalty_records`, que tiene CERO filas, mientras los
 *     reembolsos de verdad viven en otras tablas.
 *   * Nunca tocaba `payment_transactions`, que es donde esta el dinero.
 *
 * Resultado medido: mostraba $335.00 en una ventana donde entraron $10,000.
 *
 * Ahora toda la logica vive en `vista_movimientos_financieros` (migracion
 * 20260910080000), que se prueba contra un Postgres de verdad en
 * `scripts/test-vista-movimientos.sql`. Aqui solo se consulta y se pinta.
 *
 * ============================================================================
 * LAS CUATRO COLUMNAS
 * ============================================================================
 *
 * Un movimiento de dinero responde TRES preguntas distintas, y el reporte
 * viejo solo intentaba una. Con un anticipo de $10,000:
 *
 *   CAJA     +$10,000  entro al banco
 *   PASIVO    +$8,500  se le deben a la agencia
 *   INGRESO   +$1,500  esto si se gano
 *
 * Las tres son ciertas a la vez. Sumar solo la primera dice que ToursRed
 * facturo $10,000; sumar solo la tercera dice $1,500. Ninguna sola esta bien.
 *
 * La cuarta, TRASPASO, es para el dinero que cambia de dueno sin mover las
 * otras tres: pagar una reserva con el monedero, o un reembolso que se
 * acredita al monedero. Sin ella esos movimientos serian filas de puros ceros.
 */

interface MovimientoFila {
  fecha: string;
  categoria: string;
  naturaleza: 'ingreso' | 'egreso';
  descripcion: string;
  referencia: string;
  entidad: string | null;
  metodo: string | null;
  caja: number;
  pasivo: number;
  ingreso: number;
  traspaso: number;
  origen_tabla: string;
  origen_id: string;
}

interface Filtros {
  desde: string;
  hasta: string;
  naturaleza: 'todas' | 'ingreso' | 'egreso';
  categoria: string;
  busqueda: string;
}

const ETIQUETAS: Record<string, string> = {
  cobro_booking_deposit: 'Anticipo de reserva',
  cobro_payment_plan_installment: 'Cuota de plan de pagos',
  cobro_membership: 'Membresia',
  cobro_otro: 'Otro cobro',
  comision_procesador: 'Comision de procesador',
  recarga_monedero: 'Recarga de monedero',
  tarjeta_regalo: 'Tarjeta de regalo',
  servicio_opcional: 'Servicio opcional',
  suplemento: 'Suplemento',
  tour_destacado: 'Tour destacado',
  reconocimiento_ingreso: 'Comision y cargo por servicio',
  comision_aseguradora: 'Comision de aseguradora',
  pago_agencia: 'Liberacion a agencia',
  pago_con_monedero: 'Pago con monedero',
  comision_ejecutivo: 'Comision de ejecutivo',
  puntos_otorgados: 'Puntos otorgados',
  liquidacion_aseguradora: 'Liquidacion a aseguradora',
  contracargo: 'Contracargo',
  // El gasto y su pago son dos renglones distintos, en dos fechas distintas:
  // el devengo el dia de la factura, la salida de banco el dia que se pago.
  gasto_operacion: 'Gasto de operacion',
  pago_de_gasto: 'Pago de gasto',
};

const etiqueta = (c: string) =>
  ETIQUETAS[c] ?? c.replace(/^reembolso_/, 'Reembolso: ').replace(/_/g, ' ');

const money = (n: number) => formatCurrencyMXN(n);
const fecha = (d: string) => {
  try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return d; }
};
const hoy = () => format(new Date(), 'yyyy-MM-dd');
const primeroDelMes = () =>
  format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');

const AdminReporteMaestro: React.FC = () => {
  const [filas, setFilas] = useState<MovimientoFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [filtros, setFiltros] = useState<Filtros>({
    desde: primeroDelMes(),
    hasta: hoy(),
    naturaleza: 'todas',
    categoria: 'todas',
    busqueda: '',
  });

  // Contador de peticiones. Sin el, dos cargas encimadas se pisan: la que
  // termina al final gana, aunque sea la vieja. Eso produjo una pantalla con
  // 185 filas Y el banner de error al mismo tiempo, que es exactamente lo que
  // un reporte financiero no debe hacer -- deja al lector sin saber si lo que
  // ve es bueno.
  const peticionActual = React.useRef(0);

  const cargar = useCallback(async () => {
    // Un `<input type="date">` pasa por '' mientras se edita, y PostgREST
    // responde 400 a `fecha=gte.` sin valor. No es un error que valga la pena
    // ensenar: es un estado intermedio de la escritura.
    if (!filtros.desde || !filtros.hasta) return;

    const miTurno = ++peticionActual.current;
    setCargando(true);
    setError('');
    try {
      const { data, error: errorConsulta } = await supabase
        .from('vista_movimientos_financieros')
        .select('*')
        .gte('fecha', filtros.desde)
        .lte('fecha', `${filtros.hasta}T23:59:59`)
        .order('fecha', { ascending: false });

      // Si esto falla en silencio la pantalla se ve completa con cero
      // movimientos, que es indistinguible de un periodo sin actividad. Un
      // reporte financiero vacio por error es peor que no mostrar reporte.
      if (errorConsulta) throw errorConsulta;
      if (miTurno !== peticionActual.current) return;  // llego tarde: la ignoramos

      setFilas(
        (data ?? []).map((f: Record<string, unknown>) => ({
          fecha: String(f.fecha),
          categoria: String(f.categoria),
          naturaleza: f.naturaleza === 'egreso' ? 'egreso' : 'ingreso',
          descripcion: String(f.descripcion ?? ''),
          referencia: String(f.referencia ?? ''),
          entidad: (f.entidad as string) ?? null,
          metodo: (f.metodo as string) ?? null,
          caja: Number(f.caja ?? 0),
          pasivo: Number(f.pasivo ?? 0),
          ingreso: Number(f.ingreso ?? 0),
          traspaso: Number(f.traspaso ?? 0),
          origen_tabla: String(f.origen_tabla ?? ''),
          origen_id: String(f.origen_id ?? ''),
        })),
      );
    } catch (e) {
      if (miTurno !== peticionActual.current) return;
      setError(
        e instanceof Error
          ? `No se pudo cargar el reporte: ${e.message}`
          : 'No se pudo cargar el reporte.',
      );
      setFilas([]);
    } finally {
      if (miTurno === peticionActual.current) setCargando(false);
    }
  }, [filtros.desde, filtros.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => filas.filter((f) => {
    if (filtros.naturaleza !== 'todas' && f.naturaleza !== filtros.naturaleza) return false;
    if (filtros.categoria !== 'todas' && f.categoria !== filtros.categoria) return false;
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      const enAlgunLado =
        f.descripcion.toLowerCase().includes(q) ||
        f.referencia.toLowerCase().includes(q) ||
        etiqueta(f.categoria).toLowerCase().includes(q) ||
        (f.entidad ?? '').toLowerCase().includes(q);
      if (!enAlgunLado) return false;
    }
    return true;
  }), [filas, filtros.naturaleza, filtros.categoria, filtros.busqueda]);

  const totales = useMemo(() => filtradas.reduce(
    (acc, f) => ({
      caja: acc.caja + f.caja,
      pasivo: acc.pasivo + f.pasivo,
      ingreso: acc.ingreso + f.ingreso,
      traspaso: acc.traspaso + f.traspaso,
    }),
    { caja: 0, pasivo: 0, ingreso: 0, traspaso: 0 },
  ), [filtradas]);

  // Las categorias salen de los datos, no de una lista escrita a mano. Asi, el
  // dia que la vista agregue un concepto, aparece solo en el filtro en vez de
  // quedarse invisible porque nadie actualizo un arreglo aqui.
  const categorias = useMemo(
    () => Array.from(new Set(
      filas
        .filter((f) => filtros.naturaleza === 'todas' || f.naturaleza === filtros.naturaleza)
        .map((f) => f.categoria),
    )).sort((a, b) => etiqueta(a).localeCompare(etiqueta(b))),
    [filas, filtros.naturaleza],
  );

  const porCategoria = useMemo(() => {
    const m = new Map<string, { caja: number; pasivo: number; ingreso: number; traspaso: number }>();
    for (const f of filtradas) {
      const a = m.get(f.categoria) ?? { caja: 0, pasivo: 0, ingreso: 0, traspaso: 0 };
      m.set(f.categoria, {
        caja: a.caja + f.caja, pasivo: a.pasivo + f.pasivo,
        ingreso: a.ingreso + f.ingreso, traspaso: a.traspaso + f.traspaso,
      });
    }
    return [...m.entries()].sort((x, y) => Math.abs(y[1].caja) - Math.abs(x[1].caja));
  }, [filtradas]);

  const exportar = () => {
    const wb = XLSX.utils.book_new();

    const resumen: (string | number)[][] = [
      ['REPORTE MAESTRO DE MOVIMIENTOS FINANCIEROS'],
      [''],
      ['Periodo:', `${fecha(filtros.desde)} - ${fecha(filtros.hasta)}`],
      ['Generado:', format(new Date(), 'dd/MM/yyyy HH:mm')],
      [''],
      ['LAS TRES CAPAS'],
      ['Activo (movimiento de bancos):', money(totales.caja)],
      ['Pasivo (dinero de terceros):', money(totales.pasivo)],
      ['Ingreso reconocido:', money(totales.ingreso)],
      ['Traspasos (cambian de dueno):', money(totales.traspaso)],
      [''],
      ['NOTA: los gastos de operacion SI estan incluidos desde el 10-sep-2026,'],
      ['pero solo los REGISTRADOS. Los borradores no tienen asiento todavia.'],
      [''],
      ['POR CATEGORIA', 'Activo', 'Pasivo', 'Ingreso', 'Traspaso'],
      ...porCategoria.map(([cat, t]) => [etiqueta(cat), t.caja, t.pasivo, t.ingreso, t.traspaso]),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
    wsResumen['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const detalle: (string | number)[][] = [
      ['Fecha', 'Categoria', 'Naturaleza', 'Descripcion', 'Referencia',
       'Entidad', 'Metodo', 'Activo', 'Pasivo', 'Ingreso', 'Traspaso', 'Origen'],
      ...filtradas.map((f) => [
        fecha(f.fecha), etiqueta(f.categoria), f.naturaleza, f.descripcion,
        f.referencia, f.entidad ?? '', f.metodo ?? '',
        Number(f.caja.toFixed(2)), Number(f.pasivo.toFixed(2)),
        Number(f.ingreso.toFixed(2)), Number(f.traspaso.toFixed(2)),
        f.origen_tabla,
      ]),
    ];
    const wsDetalle = XLSX.utils.aoa_to_sheet(detalle);
    wsDetalle['!cols'] = [
      { wch: 12 }, { wch: 26 }, { wch: 11 }, { wch: 38 }, { wch: 18 },
      { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 26 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle');

    XLSX.writeFile(wb, `ReporteMaestro_${filtros.desde}_${filtros.hasta}.xlsx`);
  };

  const tarjetas = [
    { titulo: 'Activo (bancos)', valor: totales.caja, ayuda: 'Dinero que entro o salio del banco',
      Icono: Landmark, color: totales.caja >= 0 ? 'text-emerald-600' : 'text-red-600', fondo: 'bg-emerald-50' },
    { titulo: 'Ingreso reconocido', valor: totales.ingreso, ayuda: 'Lo que ToursRed gano de verdad',
      Icono: TrendingUp, color: totales.ingreso >= 0 ? 'text-blue-700' : 'text-red-600', fondo: 'bg-blue-50' },
    { titulo: 'Pasivo', valor: totales.pasivo, ayuda: 'Lo que se le debe a viajeros y agencias',
      Icono: Wallet, color: 'text-amber-700', fondo: 'bg-amber-50' },
    { titulo: 'Traspasos', valor: totales.traspaso, ayuda: 'Cambian de dueno sin mover caja',
      Icono: TrendingDown, color: 'text-gray-700', fondo: 'bg-gray-100' },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reporte Maestro de Movimientos Financieros</h1>
          <p className="text-gray-500 text-sm mt-1">
            Cada movimiento en sus tres capas: caja, pasivo e ingreso
          </p>
        </div>
        <button
          onClick={exportar}
          disabled={cargando || filtradas.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          Exportar a Excel
        </button>
      </div>

      {/* El aviso que vivia aqui decia que los gastos de operacion no estaban
          incluidos porque no habia donde capturarlos. Desde el 10-sep-2026 SI
          los hay: la migracion 20260910240000 agrego la tabla y el bloque 19 de
          la vista. Lo que queda no es un hueco del reporte sino una condicion
          real -- un gasto en BORRADOR todavia no tiene asiento -- y por eso se
          dice con el numero delante en vez de con un aviso fijo. */}
      <div className="mb-6 flex items-start gap-2.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-3 text-sm">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">Los gastos de operacion ya estan incluidos</span>{' '}
          en cuanto se REGISTRAN. Los que siguen en borrador no aparecen aqui, porque
          todavia no tienen asiento contable.{' '}
          <a href="/admin/gastos" className="underline font-medium">Ir a gastos de operacion</a>.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-xs">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-medium text-sm">
          <Filter size={15} />
          Filtros
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label htmlFor="f-desde" className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input id="f-desde" type="date" value={filtros.desde}
              onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor="f-hasta" className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input id="f-hasta" type="date" value={filtros.hasta}
              onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor="f-nat" className="block text-xs font-medium text-gray-600 mb-1">Naturaleza</label>
            <select id="f-nat" value={filtros.naturaleza}
              onChange={(e) => setFiltros((f) => ({ ...f, naturaleza: e.target.value as Filtros['naturaleza'], categoria: 'todas' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500">
              <option value="todas">Todas</option>
              <option value="ingreso">Entradas</option>
              <option value="egreso">Salidas</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-cat" className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
            <select id="f-cat" value={filtros.categoria}
              onChange={(e) => setFiltros((f) => ({ ...f, categoria: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500">
              <option value="todas">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{etiqueta(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-buscar" className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input id="f-buscar" type="text" placeholder="Descripcion, referencia, agencia..."
                value={filtros.busqueda}
                onChange={(e) => setFiltros((f) => ({ ...f, busqueda: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {tarjetas.map(({ titulo, valor, ayuda, Icono, color, fondo }) => (
          <div key={titulo} className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{titulo}</p>
                <p className={`text-2xl font-bold ${color}`}>{money(valor)}</p>
                <p className="text-xs text-gray-400 mt-1">{ayuda}</p>
              </div>
              <div className={`p-2 rounded-lg ${fondo}`}><Icono size={20} className={color} /></div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">
            {filtradas.length} {filtradas.length === 1 ? 'movimiento' : 'movimientos'}
          </span>
          <button onClick={cargar} disabled={cargando}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {cargando ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600" />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="text-center py-16">
            <BarChart2 size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sin movimientos en el periodo seleccionado</p>
            <p className="text-gray-400 text-sm mt-1">Ajusta los filtros o el rango de fechas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Categoria</th>
                  <th className="px-4 py-3 text-left">Descripcion</th>
                  <th className="px-4 py-3 text-left">Referencia</th>
                  <th className="px-4 py-3 text-left">Entidad</th>
                  <th className="px-4 py-3 text-right">Activo</th>
                  <th className="px-4 py-3 text-right">Pasivo</th>
                  <th className="px-4 py-3 text-right">Ingreso</th>
                  <th className="px-4 py-3 text-right">Traspaso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((f) => (
                  <tr key={`${f.origen_tabla}:${f.origen_id}:${f.categoria}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={12} className="text-gray-400 flex-shrink-0" />
                        {fecha(f.fecha)}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Tag size={11} className="text-gray-400" />
                        {etiqueta(f.categoria)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs truncate">{f.descripcion}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{f.referencia}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{f.entidad ?? '—'}</td>
                    <Importe n={f.caja} />
                    <Importe n={f.pasivo} />
                    <Importe n={f.ingreso} />
                    <Importe n={f.traspaso} neutro />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                  <td colSpan={5} className="px-4 py-3 text-sm text-gray-700">
                    Totales ({filtradas.length} movimientos)
                  </td>
                  <Importe n={totales.caja} />
                  <Importe n={totales.pasivo} />
                  <Importe n={totales.ingreso} />
                  <Importe n={totales.traspaso} neutro />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/** Una celda de importe. El cero se pinta como raya: en una tabla de cuatro
 *  columnas donde la mayoria de las filas solo mueve una o dos, un tablero
 *  lleno de "$0.00" esconde justo lo que importa. */
const Importe: React.FC<{ n: number; neutro?: boolean }> = ({ n, neutro }) => {
  if (n === 0) return <td className="px-4 py-3 text-right text-gray-300">—</td>;
  const color = neutro ? 'text-gray-600' : n > 0 ? 'text-emerald-700' : 'text-red-600';
  return (
    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${color}`}>
      {formatCurrencyMXN(n)}
    </td>
  );
};

export default AdminReporteMaestro;
